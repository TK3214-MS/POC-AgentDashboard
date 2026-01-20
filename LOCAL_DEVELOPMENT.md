# ローカル開発クイックスタート

**日本語** | [English](LOCAL_DEVELOPMENT.en.md)

## 1. 前提条件インストール

```powershell
# Node.js 確認
node --version  # v20以上

# Azure Functions Core Tools
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Azurite（ストレージエミュレーター）
npm install -g azurite
```

## 2. Functions ローカル実行

### ターミナル1: Azurite 起動

```powershell
cd functions
azurite --location ./azurite-data --debug ./azurite-debug.log
```

### ターミナル2: Functions 起動

```powershell
cd functions

# 初回のみ
npm install
cp local.settings.json.template local.settings.json
# local.settings.json を編集（必要に応じて）

# TypeScript Watch
npm run watch
```

### ターミナル3: Functions Host 起動

```powershell
cd functions
npm run start
```

→ `http://localhost:7071` で起動

## 3. Admin Portal ローカル実行

### ターミナル4: フロントエンド起動

```powershell
cd admin-portal

# 初回のみ
npm install

# 開発サーバー起動
npm run dev
```

→ `http://localhost:5173` で起動

**管理画面の設定機能**:
- **スケジュール設定**: CRON形式ではなく「毎日」「週1回」「月1回」等のシンプルな選択肢で設定可能
- **実行時刻指定**: プリセット選択またはカスタム時刻（0-23時）で指定
- UIで設定した値は内部的にCRON形式に変換されてAzure Table Storageに保存されます

## 4. サンプルデータ投入

```powershell
cd functions

# サンプルデータ生成
node scripts/generate-sample-data.js

# Azurite にアップロード（別ターミナル）
az storage container create --name raw --account-name devstoreaccount1 --connection-string "UseDevelopmentStorage=true"

az storage blob upload `
  --account-name devstoreaccount1 `
  --container-name raw `
  --name "graph_interactions/date=2025-01-01/sample.json" `
  --file ./sample-data/graph_interactions.json `
  --connection-string "UseDevelopmentStorage=true"

az storage blob upload `
  --account-name devstoreaccount1 `
  --container-name raw `
  --name "users/date=2025-01-01/sample.json" `
  --file ./sample-data/users.json `
  --connection-string "UseDevelopmentStorage=true"
```

## 5. 動作確認

### Functions API テスト

```powershell
# 設定一覧取得
Invoke-RestMethod -Uri "http://localhost:7071/api/config" -Method GET

# KPI一覧取得
Invoke-RestMethod -Uri "http://localhost:7071/api/kpi" -Method GET

# エージェント一覧取得
Invoke-RestMethod -Uri "http://localhost:7071/api/agents" -Method GET
```

### フロントエンド確認

1. ブラウザで `http://localhost:5173` にアクセス
2. サイドバーから「管理設定」または「KPI管理」を選択
3. データ操作をテスト

## トラブルシューティング

### Functions が起動しない

```powershell
# ポート確認
netstat -ano | findstr :7071

# プロセス終了
Stop-Process -Id <PID> -Force
```

### Azurite 接続エラー

```powershell
# Azurite プロセス確認
Get-Process azurite

# Azurite データリセット
Remove-Item -Recurse -Force ./azurite-data
azurite --location ./azurite-data
```

### TypeScript コンパイルエラー

```powershell
cd functions
npm run build  # エラー詳細確認
```

## VS Code デバッグ

1. `.vscode/launch.json` を確認
2. F5 キーで「Attach to Node Functions」を起動
3. ブレークポイント設定
4. API呼び出しで停止確認
