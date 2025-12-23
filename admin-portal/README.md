# 管理ポータル セットアップガイド

## 概要

M365 Copilot Analytics 管理者向けフロントエンド。各種設定をUIから変更し、KPI定義でROI算出・トラッキングを可能にします。

## アーキテクチャ

```
[フロントエンド: SvelteKit]
├─ 管理設定画面 (スケジュール等)
└─ KPI管理画面 (Business Case Builder風)
         ↓ API呼び出し
[バックエンド: Azure Functions]
├─ 設定管理API (CRUD)
├─ KPI管理API (CRUD)
├─ 業務プロセスAPI (CRUD)
└─ エージェント一覧API
         ↓
[データストア: Azure Table Storage]
├─ SystemConfig: 設定値
├─ KpiDefinition: 業務フロー定義
└─ BusinessProcess: エージェント関連付け
```

## セットアップ手順

### 1. Azure リソースデプロイ

```powershell
# Bicep デプロイ（Static Web Apps + Table Storage 追加）
az deployment group create `
  --resource-group rg-copilot-analytics-dev `
  --template-file infra/bicep/main.bicep `
  --parameters infra/bicep/params.dev.json
```

デプロイ後、以下のリソースが作成されます：
- Azure Static Web Apps
- Azure Storage（Table Storage有効化）
- Azure Functions（CORS設定済み）

### 2. Key Vault シークレット登録

管理者グループIDを登録：

```powershell
# 管理者用 Entra セキュリティグループのオブジェクトIDを取得
$adminGroupId = az ad group show --group "Copilot-Analytics-Admins" --query id -o tsv

# Key Vault に登録
az keyvault secret set `
  --vault-name <kv-name> `
  --name allowed-admin-group-id `
  --value $adminGroupId
```

### 3. Functions デプロイ

```powershell
cd functions

# 依存関係インストール
npm install

# ビルド
npm run build

# デプロイパッケージ作成
Compress-Archive -Path dist/*,host.json,package.json,node_modules -DestinationPath deploy.zip -Force

# デプロイ
az functionapp deployment source config-zip `
  --resource-group rg-copilot-analytics-dev `
  --name <func-name> `
  --src deploy.zip
```

### 4. Static Web Apps Entra ID 認証設定

Azure Portal で設定：

1. **Static Web Apps → 認証**
2. **+ 追加** → **Microsoft**
3. **アプリ登録の作成**:
   - 名前: `copilot-analytics-admin-portal`
   - リダイレクトURI: `https://<swa-name>.azurestaticapps.net/.auth/login/aad/callback`
4. **保存**

### 5. フロントエンドビルド & デプロイ

#### GitHub Actions デプロイ（推奨）

`.github/workflows/azure-static-web-apps.yml` を作成：

```yaml
name: Deploy Static Web App

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - uses: actions/checkout@v3

      - name: Build And Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/admin-portal"
          output_location: "build"
```

**デプロイトークン取得**:

```powershell
az staticwebapp secrets list `
  --name <swa-name> `
  --resource-group rg-copilot-analytics-dev `
  --query properties.apiKey -o tsv
```

GitHub リポジトリ → Settings → Secrets → `AZURE_STATIC_WEB_APPS_API_TOKEN` に登録。

#### 手動デプロイ（開発用）

```powershell
cd admin-portal

# 依存関係インストール
npm install

# ビルド
npm run build

# SWA CLI でデプロイ
npx @azure/static-web-apps-cli deploy `
  --app-location ./build `
  --deployment-token <deployment-token>
```

### 6. 環境変数設定（オプション）

Static Web Apps → 構成 → アプリケーション設定:

```
FUNCTION_API_URL = https://<func-name>.azurewebsites.net
```

※ Bicep デプロイ時に自動設定済み

## 使い方

### 管理設定画面

1. **ブラウザで管理ポータルにアクセス**: `https://<swa-name>.azurestaticapps.net`
2. **Entra ID でサインイン**
3. **サイドバー → 管理設定**
4. **設定項目を編集**:
   - スケジュール設定（CRON形式）
   - データ保持期間
   - 機能有効化フラグ

### KPI管理画面

1. **サイドバー → KPI管理**
2. **業務フロー追加**:
   - 名前: 例「カスタマーサポート対応」
   - 所要時間: 30分/回
   - 時間コスト: 3000円/時
   - カテゴリ: 顧客サポート
3. **エージェント関連付け**:
   - ドロップダウンから抽出済みエージェント名を選択
   - 利用回数・支援時間を入力（または自動集計）
4. **ROI確認**:
   - 合計コスト削減効果を自動算出
   - Business Case Builder風のサマリー表示

## API エンドポイント

### 設定管理

- `GET /api/config` - 全設定取得
- `GET /api/config/{key}` - 特定設定取得
- `POST /api/config` - 設定作成
- `PUT /api/config/{key}` - 設定更新
- `DELETE /api/config/{key}` - 設定削除

### KPI定義

- `GET /api/kpi` - 全KPI取得
- `GET /api/kpi/{id}` - 特定KPI取得
- `POST /api/kpi` - KPI作成
- `PUT /api/kpi/{id}` - KPI更新
- `DELETE /api/kpi/{id}` - KPI削除

### 業務プロセス

- `GET /api/business-process` - 全プロセス取得
- `GET /api/business-process/kpi/{kpiId}` - 特定KPIのプロセス取得
- `POST /api/business-process` - プロセス作成
- `PUT /api/business-process/{kpiId}/{processId}` - プロセス更新
- `DELETE /api/business-process/{kpiId}/{processId}` - プロセス削除

### エージェント

- `GET /api/agents` - エージェント名一覧取得

## セキュリティ

- **認証**: Entra ID（Static Web Apps ビルトイン認証）
- **認可**: 特定セキュリティグループのみアクセス可能
- **API保護**: Functions は `x-ms-client-principal` ヘッダーで認証検証
- **CORS**: Functions は Static Web Apps のオリジンのみ許可

## トラブルシューティング

### 認証エラー

**症状**: `Unauthorized` エラー

**対処**:
1. Entra ID アプリ登録のリダイレクトURI確認
2. Key Vault の `allowed-admin-group-id` がユーザーのグループIDと一致しているか確認
3. Functions の CORS 設定確認

### API 呼び出しエラー

**症状**: `CORS error` または `Network error`

**対処**:
1. Functions の CORS 設定に Static Web Apps の URL が含まれているか確認
2. ブラウザの開発者ツールで実際のエラー内容を確認
3. Functions の Application Insights でログ確認

### ローカル開発

```powershell
# Functions ローカル実行
cd functions
npm run start

# フロントエンド ローカル実行（別ターミナル）
cd admin-portal
npm run dev
```

ブラウザで `http://localhost:5173` にアクセス。API は `http://localhost:7071` にプロキシされます。

## 今後の拡張

- [ ] Fabric Lakehouse からエージェント名を自動抽出
- [ ] ROI自動算出バッチ処理（週次）
- [ ] ダッシュボード追加（Power BI Embedded）
- [ ] ロール管理（閲覧者/編集者/管理者）
- [ ] 監査ログ（変更履歴追跡）

## ライセンス

MIT License
