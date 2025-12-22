# M365 Copilot Analytics PoC

Microsoft Fabric を中心とした Copilot 利用データ分析基盤。M365 Copilot と Copilot Studio のデータを同一スキーマに正規化し、シナリオ分類・Assisted hours 算出を行い、Power BI で週次可視化します。

## 特徴

- **最小 Azure 構成**: Storage + Key Vault + Functions のみ (Fabric中心アーキテクチャ)
- **データレジデンシ**: Japan East 固定、OneLake Shortcut でコピーレス参照
- **プライバシー保護**: 会話本文は14日TTL、Silver/Gold は匿名化済み
- **二重モデル**: Public (部署粒度) / Admin (個人特定可、RLS制御)
- **週次可視化**: 日次収集、週次集計、Power BI 自動リフレッシュ

## アーキテクチャ

```
[データソース]
├─ M365 Copilot (Graph Interaction Export API)
├─ Copilot Studio (Dataverse → Power Automate → Storage CSV)
└─ Purview 監査ログ (O365 Management Activity API)
         ↓
[収集: Azure Functions (Japan East)]
├─ Graph Interaction Collector
├─ Entra User Collector (Copilotライセンス保有者限定)
└─ O365 Audit Collector (オプション)
         ↓
[格納: Azure Storage (raw, 14日TTL)]
         ↓ Shortcut参照
[変換: Microsoft Fabric Lakehouse]
├─ Bronze: raw参照 (本文含む)
├─ Silver: 正規化 (本文なし、512文字redacted)
├─ Gold: シナリオ集計 (Assisted hours)
└─ Secure: 個人情報 (UPN↔actor_id)
         ↓
[可視化: Power BI]
├─ Public: 部署/チーム粒度 (全員閲覧可)
└─ Admin: UPN表示可 (Entra SG RLS)
```

## セットアップ (5ステップ)

### ステップ 1: Azure リソースデプロイ

```bash
# リソースグループ作成
az group create --name rg-copilot-analytics-dev --location japaneast

# Bicep デプロイ
az deployment group create \
  --resource-group rg-copilot-analytics-dev \
  --template-file infra/bicep/main.bicep \
  --parameters infra/bicep/params.dev.json
```

詳細: [infra/README.md](infra/README.md)

### ステップ 2: Key Vault シークレット登録

```bash
# HASH_SALT (ランダム生成)
$salt = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
az keyvault secret set --vault-name <kv-name> --name hash-salt --value $salt

# COPILOT_SKU_IDS (Graph /subscribedSkus で取得)
az keyvault secret set --vault-name <kv-name> --name copilot-sku-ids --value "<sku-id-1>,<sku-id-2>"

# Azure OpenAI (シナリオ抽出用)
az keyvault secret set --vault-name <kv-name> --name azure-openai-endpoint --value "https://<your-openai>.openai.azure.com/"
az keyvault secret set --vault-name <kv-name> --name azure-openai-key --value "<your-api-key>"
```

### ステップ 3: Graph API 権限付与

Function App の Managed Identity に以下を付与:
- `AiEnterpriseInteraction.Read.All`
- `User.Read.All`

詳細: [infra/README.md#3-microsoft-graph-api-権限付与](infra/README.md)

### ステップ 4: Azure Functions デプロイ

```bash
cd functions
npm install
npm run build

# zip パッケージ作成
Compress-Archive -Path dist/*,host.json,package.json -DestinationPath deploy.zip -Force

# デプロイ
az functionapp deployment source config-zip \
  --resource-group rg-copilot-analytics-dev \
  --name <func-name> \
  --src deploy.zip
```

詳細: [functions/README.md](functions/README.md)

### ステップ 5: Fabric Workspace セットアップ

1. **Lakehouse 作成**:
   - Fabric Workspace → New → Lakehouse `copilot_analytics_lh`

2. **Shortcut 追加**:
   - Files → New shortcut → Azure Data Lake Storage Gen2
   - URL: `https://<storage-account>.dfs.core.windows.net/raw`
   - Shortcut 名: `raw`

3. **Notebooks インポート**:
   - Workspace → Import notebook → `fabric/notebooks/*.py`
   - Default Lakehouse: `copilot_analytics_lh` 設定

4. **初期データ投入**:
   - `seed_dim_scenario_weight.py` を実行 (シナリオ重み)

5. **Pipeline 設定**:
   - **日次**: 04:00 JST → `bronze_to_silver` → `cleanup_raw`
   - **週次**: 月曜 07:00 JST → `scenario_extract` → `weekly_gold_aggregate` → Power BI リフレッシュ

詳細: [fabric/README.md](fabric/README.md)

### ステップ 6: Power BI レポート作成

1. **Public モデル**:
   - Fabric Lakehouse 接続
   - テーブル: `gold.ai_scenario_fact` (actor_id 除外)
   - 全員閲覧可

2. **Admin モデル**:
   - テーブル: `gold.ai_scenario_fact` + `secure.dim_user_private`
   - RLS 設定: Entra SG `PBI-Copilot-Admin`

詳細: [docs/powerbi-design.md](docs/powerbi-design.md)

## ドキュメント

- [アーキテクチャ設計](docs/architecture.md) - 設計判断と理由
- [Lakehouse設計](docs/lakehouse-design.md) - スキーマDDL、フォルダ構造、TTL設計
- [Power BI設計](docs/powerbi-design.md) - 二重モデル、RLS、メジャー例
- [テスト戦略とRunbook](docs/testing-and-runbook.md) - 運用手順、トラブルシューティング

## 確認事項 (初回セットアップ前)

以下を事前に確定してください:

1. **Copilot SKU ID**: Graph `/subscribedSkus` で確認し `COPILOT_SKU_IDS` に設定
2. **Entra 属性**: `extensionAttribute10` に部署/チーム情報が入っているか確認
3. **Admin グループ**: Power BI RLS 用の Entra セキュリティグループ名
4. **Azure OpenAI**: Japan East/West リージョンでデプロイ済みか確認
5. **週次スケジュール**: 可視化更新の曜日・時刻 (デフォルト: 月曜 09:00 JST)

## ライセンス

MIT License (サンプルコード)

## サポート

- Issue: GitHub Issues
- ドキュメント: [docs/](docs/)
- Runbook: [docs/testing-and-runbook.md](docs/testing-and-runbook.md)
