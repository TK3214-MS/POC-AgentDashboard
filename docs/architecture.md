# アーキテクチャ設計

## 1. 全体像

**Microsoft Fabric 中心 + 最小 Azure 構成**による Copilot 分析基盤。M365 Copilot と Copilot Studio の利用データを同一スキーマに正規化し、週次で Power BI 可視化する。

```
[データソース]
├─ M365 Copilot (Graph Interaction Export API)
├─ Copilot Studio (Dataverse → Power Automate → Storage CSV)
└─ Purview 監査ログ (Office 365 Management Activity API)
         ↓
[収集層: Azure Functions (Timer日次)]
├─ Graph Interaction Collector
├─ Entra User Collector (Copilotライセンス保有者限定)
└─ O365 Audit Collector (オプション)
         ↓
[格納層: Azure Storage Account (Japan East)]
├─ raw コンテナ (14日TTL)
│   ├─ graph_interactions/date=YYYY-MM-DD/*.json
│   ├─ users/date=YYYY-MM-DD/*.json
│   ├─ copilot_studio_transcript/date=YYYY-MM-DD/*.csv
│   └─ o365_audit/date=YYYY-MM-DD/*.json
         ↓ (Shortcut参照のみ、コピーしない)
[変換層: Microsoft Fabric Lakehouse]
├─ Bronze: raw を Shortcut 参照 (TTL 14日、本文含む)
├─ Silver: 正規化イベント (本文なし、512文字redactedのみ)
├─ Gold: シナリオ集計 (Assisted hours算出)
└─ Secure: 個人特定情報 (UPN↔actor_id対応、例外抜粋)
         ↓
[可視化層: Power BI (週次更新)]
├─ Public モデル: 部署/チーム粒度のみ (個人特定不可)
└─ Admin モデル: UPN表示可 (Entra SG で RLS 制御)
```

## 2. 設計判断の根拠

### 2.1 Fabric 中心アーキテクチャ
- **理由**: OneLake で統合データレイク、Lakehouse で Bronze/Silver/Gold メダリオン、Notebook で PySpark 変換、Pipeline でオーケストレーションを一元管理。Azure 側は収集とシークレット管理のみに限定し、運用複雑性を最小化。
- **効果**: データガバナンス (Purview統合)、コスト最適化 (compute分離)、開発速度向上 (低コード Notebook)。

### 2.2 最小 Azure 構成 (Storage + Key Vault + Functions)
- **Storage**: raw データの着地点。Fabric Shortcut で参照し、コピーしないためデータレジデンシ (Japan East固定) とコスト削減を両立。
- **Key Vault**: salt (SHA-256ハッシュ用)、API キー、SKU ID をセキュア管理。Managed Identity で Functions と Fabric から参照。
- **Functions**: Timer トリガーで日次収集。Graph/O365 API のページング・リトライ・冪等性を実装し、Fabric 側の複雑性を排除。

### 2.3 Shortcut 方式 (Copy しない)
- **理由**: Fabric Lakehouse は Storage の `raw` コンテナを Shortcut として参照し、データをコピーしない。
- **効果**: ストレージコスト削減、データレジデンシ維持 (Japan East)、TTL 管理の一元化 (Storage Lifecycle Management)。

### 2.4 Bronze TTL 14日
- **理由**: 会話本文は監査・サポート以外で長期保存不要。14日で自動削除 (Storage Lifecycle or Fabric Notebook)。
- **効果**: プライバシー保護、ストレージコスト削減、GDPR/労務規制対応。

### 2.5 Silver/Gold に本文なし
- **理由**: Silver は正規化イベント (本文なし or 512文字redacted)、Gold は集計済み。actor_id をハッシュ化し、UPN は secure エリアのみ。
- **効果**: 一般ユーザー向け可視化で個人特定不可、管理者のみ secure 参照で労務規制対応。

### 2.6 二重セマンティックモデル (Public / Admin)
- **Public**: org_unit (部署/チーム) 粒度のみ。actor_id は集計済みで含まない。
- **Admin**: actor_id ↔ UPN 対応 (secure.dim_user_private) を参照。Entra セキュリティグループで RLS 制御。
- **効果**: 一般ユーザーは個人特定不可、管理者のみ詳細確認可でガバナンス要件を満たす。

### 2.7 週次可視化 / 日次収集
- **理由**: 可視化は週次で十分 (トレンド把握)。収集は日次で信頼性・再実行性を確保 (失敗時の再取得範囲を最小化)。
- **効果**: API レート制限回避、運用負荷軽減、データ鮮度と安定性のバランス。

## 3. セキュリティ設計

### 3.1 データ匿名化
- **actor_id**: `SHA-256(SALT + UPN.toLowerCase())`。SALT は Key Vault で管理。
- **org_unit**: Entra の `onPremisesExtensionAttributes.extensionAttribute10` を使用。
- **UPN 対応**: secure.dim_user_private に格納、管理者ロールのみ参照可。

### 3.2 例外抜粋 (secure.case_snippet)
- **用途**: 監査・品質改善・サポート目的のケース ID 紐付け。
- **制約**: 最大 5 ターン/512文字、匿名化済み、管理者ロールのみ参照可。

### 3.3 アクセス制御
- **Functions MI**: Graph `AiEnterpriseInteraction.Read.All` + `User.Read.All`、Key Vault Secrets User、Storage Blob Data Contributor。
- **Fabric Workspace**: Entra SG で Admin/Contributor/Viewer 分離。
- **Power BI RLS**: Admin モデルは Entra SG で制御、Public モデルは全員閲覧可。

## 4. スケーラビリティと拡張性

### 4.1 PoC → 本番移行
- **PoC**: 単一 Lakehouse、消費プラン Functions、週次更新。
- **本番**: Lakehouse 分離 (raw/curated)、Premium Functions (Durable)、Direct Lake + Incremental Refresh。

### 4.2 データソース追加
- **プラグイン構造**: Source Adapter インターフェース (`IIngestJob`) で Graph/Copilot Studio/O365 を統一。新規ソース追加時は同一パターンで実装。

### 4.3 シナリオ分類の改善
- **初期**: LLM (Azure OpenAI) で taxonomy 30-50カテゴリに分類。
- **拡張**: クラスタリング (UMAP + HDBSCAN) で新規シナリオ候補抽出、taxonomy を継続改善。

## 5. 運用設計

### 5.1 モニタリング
- **Functions**: Application Insights でタイマー実行、API エラー、リトライを追跡。
- **Fabric**: Pipeline 実行ログ、データ品質メトリクス (件数/ユニーク actor/空 org_unit) を可視化。

### 5.2 障害対応
- **Functions 失敗**: 日付範囲指定で手動再実行 (冪等性保証)。
- **Silver MERGE 失敗**: event_id 重複チェック、自動リトライ。
- **TTL 削除失敗**: 手動 Notebook 実行、Storage Lifecycle バックアップ。

### 5.3 データ品質
- **検証**: 日次で件数/actor数/org_unit空欄率をチェック、閾値超過でアラート。
- **監査**: secure.case_snippet への登録フローを UI 化 (Fabric Notebook + Power Apps)。

## 6. コスト最適化

- **Storage**: LRS (Japan East)、TTL 14日で最小化。
- **Functions**: 消費プラン (PoC)、Premium (本番、長時間実行対応)。
- **Fabric**: Capacity ベース、Notebook 実行時間を最適化 (partition pruning)。
- **Power BI**: Pro ライセンス (PoC)、Premium Per User or Capacity (本番)。

---

**次のステップ**: Lakehouse 設計 (フォルダ構造、テーブルスキーマ、Shortcut 設定) を定義し、IaC (Bicep) で Azure リソースを自動デプロイ可能にする。
