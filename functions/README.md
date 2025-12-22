# Azure Functions - Copilot Analytics

M365 Copilot と Entra ユーザーデータを日次で収集し、Azure Storage (raw コンテナ) に格納する。

## 機能
- **ingestGraphInteractions**: M365 Copilot の会話データ (Graph Interaction Export API) を収集
- **syncUsers**: Copilot ライセンス保有者を収集 (extensionAttribute10 含む)

## ローカル開発

### 1. 依存関係インストール
```bash
cd functions
npm install
```

### 2. local.settings.json 作成
```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "STORAGE_ACCOUNT_NAME": "<storage-account-name>",
    "RAW_CONTAINER": "raw",
    "HASH_SALT": "<random-salt>",
    "COPILOT_SKU_IDS": "<sku-id-1>,<sku-id-2>",
    "AZURE_OPENAI_ENDPOINT": "https://<your-openai>.openai.azure.com/",
    "AZURE_OPENAI_KEY": "<your-api-key>"
  }
}
```

### 3. ビルド & 実行
```bash
npm run build
npm start
```

### 4. 手動トリガー (HTTP 経由)
```bash
# 本番では Timer トリガーのみ使用
```

## デプロイ

### 1. ビルド
```bash
npm run build
```

### 2. zip パッケージ作成
```bash
Compress-Archive -Path dist/*,host.json,package.json -DestinationPath deploy.zip -Force
```

### 3. デプロイ
```bash
az functionapp deployment source config-zip \
  --resource-group rg-copilot-analytics-dev \
  --name <function-app-name> \
  --src deploy.zip
```

### 4. 環境変数確認
```bash
az functionapp config appsettings list \
  --resource-group rg-copilot-analytics-dev \
  --name <function-app-name>
```

## Graph API 権限

Function App の Managed Identity に以下を付与:
- `AiEnterpriseInteraction.Read.All` (M365 Copilot interaction)
- `User.Read.All` (ユーザー情報)

詳細は `infra/README.md` 参照。

## 出力先

Storage `raw` コンテナ:
```
raw/
├─ graph_interactions/date=2025-01-15/page_000.json
├─ users/date=2025-01-15/licensed_users.json
└─ ...
```

TTL 14日後自動削除 (Storage Lifecycle Management)。
