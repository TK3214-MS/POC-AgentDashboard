# M365 Copilot Analytics PoC

Microsoft Fabric を中心とした Copilot 利用データ分析基盤。M365 Copilot と Copilot Studio のデータを同一スキーマに正規化し、シナリオ分類・Assisted hours 算出を行い、Power BI で週次可視化します。

## 特徴

- **最小 Azure 構成**: Storage + Key Vault + Functions のみ (Fabric中心アーキテクチャ)
- **データレジデンシ**: Japan East 固定、OneLake Shortcut でコピーレス参照
- **プライバシー保護**: 会話本文は14日TTL、Silver/Gold は匿名化済み
- **二重モデル**: Public (部署粒度) / Admin (個人特定可、RLS制御)
- **週次可視化**: 日次収集、週次集計、Power BI 自動リフレッシュ
- **管理ポータル**: SvelteKit製UI、Entra ID認証、KPI定義でROI算出・可視化 (新規追加)

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

[管理ポータル: Azure Static Web Apps] ← 新規追加
├─ 管理設定画面（スケジュール・設定変更）
└─ KPI管理画面（Business Case Builder風ROI算出）
         ↓ API経由
[バックエンドAPI: Azure Functions]
├─ 設定管理API (CRUD)
├─ KPI管理API (CRUD)
└─ 業務プロセスAPI (エージェント関連付け)
         ↓
[データストア: Azure Table Storage]
├─ SystemConfig: システム設定
├─ KpiDefinition: 業務フロー定義
└─ BusinessProcess: エージェント×KPI関連付け
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

### ステップ 7: 管理ポータルセットアップ（新規）

管理者向けフロントエンド画面の構築：

```powershell
# 管理ポータルのセットアップ
cd admin-portal
npm install
npm run build

# Static Web Apps へデプロイ（GitHub Actions推奨）
# 詳細は admin-portal/README.md 参照
```

**主な機能**:
- **管理設定**: スケジュール設定（毎日/週1回/月1回等をシンプルに選択）、保持期間等をUI変更
- **KPI管理**: 業務フロー定義、時間コスト設定、エージェント関連付け
- **ROI算出**: Microsoft Business Case Builder風のUI

詳細: [admin-portal/README.md](admin-portal/README.md)

### ステップ 8: Copilot Studio データ収集（Power Automate）

Copilot Studio の会話データを Dataverse から Azure Storage に転送するフローを構築：

#### 8.1 Power Automate フロー作成

1. **Power Automate** (https://make.powerautomate.com) にアクセス
2. **＋ 作成** → **スケジュール済みクラウドフロー**
3. フロー名: `Copilot Studio to Azure Storage`
4. 実行間隔: **1日1回** (04:00 JST = 19:00 UTC 前日)

#### 8.2 トリガー設定

- **繰り返し**: 1日
- **開始時刻**: `2025-01-01T19:00:00Z` (JST 04:00)

#### 8.3 アクション追加

**1. Dataverse - 行を一覧表示**
- **テーブル名**: `ConversationTranscripts` (Copilot Studio会話履歴)
- **フィルタークエリ**: `createdon ge @{addDays(utcNow(), -1)}`  (前日分のみ)
- **列を選択**: `conversationid,createdon,title,content,userid,botid`

**2. 変数を初期化 - CSV行配列**
- **名前**: `csvRows`
- **種類**: Array
- **値**: `[]`

**3. Apply to each (各会話に対して)**
- **以前の手順から出力を選択**: `value` (Dataverseの行一覧)

   **3.1 配列変数に追加**
   - **名前**: `csvRows`
   - **値**: 
     ```
     @{items('Apply_to_each')?['conversationid']},@{items('Apply_to_each')?['createdon']},@{replace(items('Apply_to_each')?['title'], ',', ';')},@{replace(items('Apply_to_each')?['content'], ',', ';')},@{items('Apply_to_each')?['userid']},@{items('Apply_to_each')?['botid']}
     ```

**4. 作成 - CSV変換**
- **入力**: 
  ```
  conversationid,createdon,title,content,userid,botid
  @{join(variables('csvRows'), decodeUriComponent('%0A'))}
  ```

**5. Azure Blob Storage - BLOB の作成**
- **接続**: Azure Storage Account (認証: Managed Identity推奨)
- **ストレージアカウント名**: `<storage-account-name>`
- **フォルダーのパス**: `/raw/copilot_studio_transcript/date=@{formatDateTime(utcNow(), 'yyyy-MM-dd')}`
- **BLOB名**: `transcript_@{formatDateTime(utcNow(), 'yyyyMMddHHmmss')}.csv`
- **BLOB コンテンツ**: `@{outputs('作成')}`

#### 8.4 フロー保存・有効化

1. **保存**
2. **テスト** → **手動** で実行確認
3. **有効化**

#### 8.5 補足: Dataverse テーブル確認

Copilot Studio の会話データが Dataverse に格納されているか確認：

```powershell
# Power Platform CLI インストール (初回のみ)
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell

# 環境一覧取得
Get-AdminPowerAppEnvironment

# Dataverse テーブル確認
# Power Apps Maker Portal (https://make.powerapps.com) → データ → テーブル
# "ConversationTranscripts" または類似テーブル名を探す
```

**注意**: Copilot Studio の Dataverse 統合が有効化されていない場合、先に有効化が必要です（Copilot Studio 管理センター → 設定 → Dataverse統合）。

## ローカル開発環境

開発・テストを効率化するためのローカル実行手順。

### 前提条件

- Node.js 20.x 以上
- Azure Functions Core Tools 4.x
- Azure CLI
- Git

```powershell
# Node.js バージョン確認
node --version  # v20.x.x

# Azure Functions Core Tools インストール
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Azure CLI インストール（未インストールの場合）
winget install Microsoft.AzureCLI
```

### Azure Functions ローカル実行

```powershell
# リポジトリクローン
git clone <repository-url>
cd POC-AgentDashboard/functions

# 依存関係インストール
npm install

# ローカル設定ファイル作成
cp local.settings.json.template local.settings.json
```

**local.settings.json 編集**:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "STORAGE_ACCOUNT_NAME": "<開発用ストレージアカウント名>",
    "RAW_CONTAINER": "raw",
    "HASH_SALT": "<開発用ソルト値>",
    "COPILOT_SKU_IDS": "<SKU-ID>",
    "AZURE_OPENAI_ENDPOINT": "<開発用OpenAIエンドポイント>",
    "AZURE_OPENAI_KEY": "<開発用OpenAIキー>",
    "ALLOWED_ADMIN_GROUP_ID": "<開発用管理者グループID>",
    "NODE_ENV": "development"
  }
}
```

**Functions 起動**:

```powershell
# TypeScript ビルド（Watch モード）
npm run watch

# 別ターミナルで Functions 起動
npm run start
```

Functions は `http://localhost:7071` で起動します。

**動作確認**:

```powershell
# ヘルスチェック（例: 設定API）
Invoke-RestMethod -Uri "http://localhost:7071/api/config" -Method GET -Headers @{"x-ms-client-principal" = "eyJ1c2VyRGV0YWlscyI6ImRldkBleGFtcGxlLmNvbSIsInVzZXJJZCI6ImRldi11c2VyLWlkIn0="}
```

### 管理ポータル ローカル実行

```powershell
cd admin-portal

# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev
```

フロントエンドは `http://localhost:5173` で起動し、API呼び出しは自動的に `http://localhost:7071` にプロキシされます（vite.config.ts設定）。

**動作確認**:
1. ブラウザで `http://localhost:5173` にアクセス
2. 管理設定またはKPI管理画面で操作
3. ローカルStorageまたはMock APIでテスト

### Azure Blob Storage エミュレーター（Azurite）

ローカル開発で Azure Storage を模倣：

```powershell
# Azurite インストール
npm install -g azurite

# Azurite 起動（Blob, Queue, Table）
azurite --location ./azurite-data --debug ./azurite-debug.log

# 別ターミナルで確認
az storage blob list --account-name devstoreaccount1 --container-name raw --connection-string "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
```

**Functions local.settings.json を更新**:

```json
"AzureWebJobsStorage": "UseDevelopmentStorage=true",
"STORAGE_ACCOUNT_NAME": "devstoreaccount1"
```

### デバッグ（VS Code）

`.vscode/launch.json` を作成：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to Node Functions",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "preLaunchTask": "func: host start"
    }
  ]
}
```

F5 キーでデバッグ開始。

### テストデータ投入

```powershell
# Graph Interactions サンプルデータ作成
cd functions
node scripts/generate-sample-data.js

# Azurite にアップロード
az storage blob upload --account-name devstoreaccount1 --container-name raw --name "graph_interactions/date=2025-01-01/sample.json" --file ./sample-data/graph_interactions.json --connection-string "UseDevelopmentStorage=true"
```

## ドキュメント

- [アーキテクチャ設計](docs/architecture.md) - 設計判断と理由
- [Lakehouse設計](docs/lakehouse-design.md) - スキーマDDL、フォルダ構造、TTL設計
- [Power BI設計](docs/powerbi-design.md) - 二重モデル、RLS、メジャー例
- [テスト戦略とRunbook](docs/testing-and-runbook.md) - 運用手順、トラブルシューティング
- [管理ポータル](admin-portal/README.md) - フロントエンド構築・デプロイ手順
- [ローカル開発](LOCAL_DEVELOPMENT.md) - ローカル環境セットアップ・デバッグ手順 ← 新規追加

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
