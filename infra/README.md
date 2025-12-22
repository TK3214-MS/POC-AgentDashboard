# インフラストラクチャ デプロイ手順

## 前提条件
- Azure CLI 最新版
- Azure サブスクリプション (Japan East リージョン利用可能)
- リソースグループ作成権限

## 1. デプロイ

### 1.1 リソースグループ作成
```bash
az group create \
  --name rg-copilot-analytics-dev \
  --location japaneast
```

### 1.2 Bicep デプロイ
```bash
az deployment group create \
  --resource-group rg-copilot-analytics-dev \
  --template-file infra/bicep/main.bicep \
  --parameters infra/bicep/params.dev.json
```

### 1.3 出力確認
```bash
az deployment group show \
  --resource-group rg-copilot-analytics-dev \
  --name main \
  --query properties.outputs
```

## 2. Key Vault シークレット登録

### 2.1 HASH_SALT (SHA-256 用ランダム文字列)
```bash
# ランダム生成 (PowerShell)
$salt = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})

az keyvault secret set \
  --vault-name <Key Vault名> \
  --name hash-salt \
  --value $salt
```

### 2.2 COPILOT_SKU_IDS (Copilot ライセンス SKU ID、カンマ区切り)
```bash
# 手順: Graph /subscribedSkus で SKU ID 確認後、カンマ区切りで設定
# 例: "c6801f39-4c65-45e1-a8e1-53b991d8dc8e,41fcdd7d-4733-4863-9cf4-c65dfbbf0916"

az keyvault secret set \
  --vault-name <Key Vault名> \
  --name copilot-sku-ids \
  --value "<SKU_ID1>,<SKU_ID2>"
```

### 2.3 Azure OpenAI (シナリオ抽出用)
```bash
az keyvault secret set \
  --vault-name <Key Vault名> \
  --name azure-openai-endpoint \
  --value "https://<your-openai>.openai.azure.com/"

az keyvault secret set \
  --vault-name <Key Vault名> \
  --name azure-openai-key \
  --value "<your-api-key>"
```

## 3. Microsoft Graph API 権限付与

Function App の Managed Identity に以下のアプリケーション権限を付与:

### 3.1 Enterprise Application 確認
```bash
az ad sp show --id <Function App Principal ID>
```

### 3.2 Graph API 権限付与 (Azure Portal 推奨)
1. Azure Portal → Entra ID → Enterprise applications
2. Function App の MI を検索
3. API permissions → Add permission → Microsoft Graph → Application permissions
4. 以下を追加:
   - `AiEnterpriseInteraction.Read.All` (M365 Copilot interaction 読み取り)
   - `User.Read.All` (ユーザー情報読み取り)
5. Grant admin consent

### 3.3 PowerShell で権限付与 (自動化用)
```powershell
# Microsoft Graph PowerShell SDK 必要
Connect-MgGraph -Scopes "Application.ReadWrite.All"

$sp = Get-MgServicePrincipal -Filter "displayName eq '<Function App名>'"
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"

# AiEnterpriseInteraction.Read.All
$role1 = $graphSp.AppRoles | Where-Object {$_.Value -eq "AiEnterpriseInteraction.Read.All"}
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graphSp.Id -AppRoleId $role1.Id

# User.Read.All
$role2 = $graphSp.AppRoles | Where-Object {$_.Value -eq "User.Read.All"}
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graphSp.Id -AppRoleId $role2.Id
```

## 4. デプロイ後の確認

### 4.1 Storage Lifecycle 確認
```bash
az storage account management-policy show \
  --account-name <Storage Account名> \
  --resource-group rg-copilot-analytics-dev
```

### 4.2 Key Vault アクセス確認
```bash
az keyvault secret list \
  --vault-name <Key Vault名> \
  --query "[].name"
```

### 4.3 Function App 起動確認
```bash
az functionapp show \
  --name <Function App名> \
  --resource-group rg-copilot-analytics-dev \
  --query state
```

## 5. クリーンアップ
```bash
az group delete \
  --name rg-copilot-analytics-dev \
  --yes --no-wait
```
