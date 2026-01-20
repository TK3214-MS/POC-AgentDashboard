# M365 Copilot Analytics PoC

[日本語](README.md) | **English**

Microsoft Fabric-centric Copilot usage data analytics platform. Normalizes M365 Copilot and Copilot Studio data into unified schema, performs scenario classification and Assisted hours calculation, with weekly Power BI visualization.

## Features

- **Minimal Azure Configuration**: Storage + Key Vault + Functions only (Fabric-centric architecture)
- **Data Residency**: Japan East fixed, OneLake Shortcut for copy-less reference
- **Privacy Protection**: Message content 14-day TTL, Silver/Gold anonymized
- **Dual Models**: Public (department granularity) / Admin (personal identification, RLS controlled)
- **Weekly Visualization**: Daily collection, weekly aggregation, Power BI auto-refresh
- **Admin Portal**: SvelteKit UI, Entra ID auth, KPI definition for ROI calculation & visualization (newly added)

## Architecture

```
[Data Sources]
├─ M365 Copilot (Graph Interaction Export API)
├─ Copilot Studio (Dataverse → Power Automate → Storage CSV)
└─ Purview Audit Logs (O365 Management Activity API)
         ↓
[Collection: Azure Functions (Japan East)]
├─ Graph Interaction Collector
├─ Entra User Collector (Copilot license holders only)
└─ O365 Audit Collector (Optional)
         ↓
[Storage: Azure Storage (raw, 14-day TTL)]
         ↓ Shortcut reference
[Transformation: Microsoft Fabric Lakehouse]
├─ Bronze: raw reference (includes content)
├─ Silver: Normalized (no content, 512-char redacted)
├─ Gold: Scenario aggregation (Assisted hours)
└─ Secure: Personal info (UPN↔actor_id)
         ↓
[Visualization: Power BI]
├─ Public: Department/team granularity (all users)
└─ Admin: UPN visible (Entra SG RLS)

[Admin Portal: Azure Static Web Apps] ← Newly added
├─ Admin Settings (schedule, configuration changes)
└─ KPI Management (Business Case Builder-style ROI calculation)
         ↓ via API
[Backend API: Azure Functions]
├─ Settings Management API (CRUD)
├─ KPI Management API (CRUD)
└─ Business Process API (agent associations)
         ↓
[Data Store: Azure Table Storage]
├─ SystemConfig: System settings
├─ KpiDefinition: Business flow definitions
└─ BusinessProcess: Agent×KPI associations
```

## Setup (5 Steps)

### Step 1: Deploy Azure Resources

```bash
# Create resource group
az group create --name rg-copilot-analytics-dev --location japaneast

# Bicep deployment
az deployment group create \
  --resource-group rg-copilot-analytics-dev \
  --template-file infra/bicep/main.bicep \
  --parameters infra/bicep/params.dev.json
```

Details: [infra/README.md](infra/README.md)

### Step 2: Register Key Vault Secrets

```bash
# HASH_SALT (random generation)
$salt = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
az keyvault secret set --vault-name <kv-name> --name hash-salt --value $salt

# COPILOT_SKU_IDS (get from Graph /subscribedSkus)
az keyvault secret set --vault-name <kv-name> --name copilot-sku-ids --value "<sku-id-1>,<sku-id-2>"

# Azure OpenAI (for scenario extraction)
az keyvault secret set --vault-name <kv-name> --name azure-openai-endpoint --value "https://<your-openai>.openai.azure.com/"
az keyvault secret set --vault-name <kv-name> --name azure-openai-key --value "<your-api-key>"
```

### Step 3: Grant Graph API Permissions

Grant following to Function App Managed Identity:
- `AiEnterpriseInteraction.Read.All`
- `User.Read.All`

Details: [infra/README.md#3-microsoft-graph-api-permissions](infra/README.md)

### Step 4: Deploy Azure Functions

```bash
cd functions
npm install
npm run build

# Create zip package
Compress-Archive -Path dist/*,host.json,package.json -DestinationPath deploy.zip -Force

# Deploy
az functionapp deployment source config-zip \
  --resource-group rg-copilot-analytics-dev \
  --name <func-name> \
  --src deploy.zip
```

Details: [functions/README.md](functions/README.md)

### Step 5: Setup Fabric Workspace

1. **Create Lakehouse**:
   - Fabric Workspace → New → Lakehouse `copilot_analytics_lh`

2. **Add Shortcut**:
   - Files → New shortcut → Azure Data Lake Storage Gen2
   - URL: `https://<storage-account>.dfs.core.windows.net/raw`
   - Shortcut name: `raw`

3. **Import Notebooks**:
   - Workspace → Import notebook → `fabric/notebooks/*.py`
   - Set Default Lakehouse: `copilot_analytics_lh`

4. **Seed Initial Data**:
   - Execute `seed_dim_scenario_weight.py` (scenario weights)

5. **Configure Pipeline**:
   - **Daily**: 04:00 JST → `bronze_to_silver` → `cleanup_raw`
   - **Weekly**: Monday 07:00 JST → `scenario_extract` → `weekly_gold_aggregate` → Power BI refresh

Details: [fabric/README.md](fabric/README.md)

### Step 6: Create Power BI Reports

1. **Public Model**:
   - Fabric Lakehouse connection
   - Tables: `gold.ai_scenario_fact` (exclude actor_id)
   - Accessible to all

2. **Admin Model**:
   - Tables: `gold.ai_scenario_fact` + `secure.dim_user_private`
   - RLS configuration: Entra SG `PBI-Copilot-Admin`

Details: [docs/powerbi-design.en.md](docs/powerbi-design.en.md)

### Step 7: Admin Portal Setup (New)

Build admin frontend UI:

```powershell
# Admin portal setup
cd admin-portal
npm install
npm run build

# Deploy to Static Web Apps (GitHub Actions recommended)
# See admin-portal/README.md for details
```

**Main Features**:
- **Admin Settings**: Schedule configuration (simple selection: daily/weekly/monthly), retention period, etc. via UI
- **KPI Management**: Business flow definition, time cost settings, agent associations
- **ROI Calculation**: Microsoft Business Case Builder-style UI

Details: [admin-portal/README.md](admin-portal/README.md)

### Step 8: Copilot Studio Data Collection (Power Automate)

Build flow to transfer Copilot Studio conversation data from Dataverse to Azure Storage:

#### 8.1 Create Power Automate Flow

1. Access **Power Automate** (https://make.powerautomate.com)
2. **+ Create** → **Scheduled cloud flow**
3. Flow name: `Copilot Studio to Azure Storage`
4. Run interval: **Once per day** (04:00 JST = 19:00 UTC previous day)

#### 8.2 Trigger Configuration

- **Recurrence**: 1 day
- **Start time**: `2025-01-01T19:00:00Z` (JST 04:00)

#### 8.3 Add Actions

**1. Dataverse - List rows**
- **Table name**: `ConversationTranscripts` (Copilot Studio conversation history)
- **Filter query**: `createdon ge @{addDays(utcNow(), -1)}` (previous day only)
- **Select columns**: `conversationid,createdon,title,content,userid,botid`

**2. Initialize variable - CSV row array**
- **Name**: `csvRows`
- **Type**: Array
- **Value**: `[]`

**3. Apply to each (for each conversation)**
- **Select an output from previous steps**: `value` (Dataverse row list)

   **3.1 Append to array variable**
   - **Name**: `csvRows`
   - **Value**: 
     ```
     @{items('Apply_to_each')?['conversationid']},@{items('Apply_to_each')?['createdon']},@{replace(items('Apply_to_each')?['title'], ',', ';')},@{replace(items('Apply_to_each')?['content'], ',', ';')},@{items('Apply_to_each')?['userid']},@{items('Apply_to_each')?['botid']}
     ```

**4. Compose - CSV conversion**
- **Inputs**: 
  ```
  conversationid,createdon,title,content,userid,botid
  @{join(variables('csvRows'), decodeUriComponent('%0A'))}
  ```

**5. Azure Blob Storage - Create blob**
- **Connection**: Azure Storage Account (auth: Managed Identity recommended)
- **Storage account name**: `<storage-account-name>`
- **Folder path**: `/raw/copilot_studio_transcript/date=@{formatDateTime(utcNow(), 'yyyy-MM-dd')}`
- **Blob name**: `transcript_@{formatDateTime(utcNow(), 'yyyyMMddHHmmss')}.csv`
- **Blob content**: `@{outputs('Compose')}`

#### 8.4 Save & Enable Flow

1. **Save**
2. **Test** → **Manually** to verify execution
3. **Turn on**

#### 8.5 Note: Verify Dataverse Table

Verify Copilot Studio conversation data stored in Dataverse:

```powershell
# Install Power Platform CLI (first time only)
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell

# Get environment list
Get-AdminPowerAppEnvironment

# Verify Dataverse table
# Power Apps Maker Portal (https://make.powerapps.com) → Data → Tables
# Look for "ConversationTranscripts" or similar table name
```

**Note**: If Copilot Studio Dataverse integration not enabled, enable it first (Copilot Studio admin center → Settings → Dataverse integration).

## Local Development Environment

Local execution procedures for efficient development and testing.

### Prerequisites

- Node.js 20.x or later
- Azure Functions Core Tools 4.x
- Azure CLI
- Git

```powershell
# Check Node.js version
node --version  # v20.x.x

# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Install Azure CLI (if not installed)
winget install Microsoft.AzureCLI
```

### Azure Functions Local Execution

```powershell
# Clone repository
git clone <repository-url>
cd POC-AgentDashboard/functions

# Install dependencies
npm install

# Create local settings file
cp local.settings.json.template local.settings.json
```

**Edit local.settings.json**:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "STORAGE_ACCOUNT_NAME": "<dev-storage-account-name>",
    "RAW_CONTAINER": "raw",
    "HASH_SALT": "<dev-salt-value>",
    "COPILOT_SKU_IDS": "<SKU-ID>",
    "AZURE_OPENAI_ENDPOINT": "<dev-openai-endpoint>",
    "AZURE_OPENAI_KEY": "<dev-openai-key>",
    "ALLOWED_ADMIN_GROUP_ID": "<dev-admin-group-id>",
    "NODE_ENV": "development"
  }
}
```

**Start Functions**:

```powershell
# TypeScript build (Watch mode)
npm run watch

# Start Functions in separate terminal
npm run start
```

Functions start at `http://localhost:7071`.

**Verify operation**:

```powershell
# Health check (e.g., config API)
Invoke-RestMethod -Uri "http://localhost:7071/api/config" -Method GET -Headers @{"x-ms-client-principal" = "eyJ1c2VyRGV0YWlscyI6ImRldkBleGFtcGxlLmNvbSIsInVzZXJJZCI6ImRldi11c2VyLWlkIn0="}
```

### Admin Portal Local Execution

```powershell
cd admin-portal

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend starts at `http://localhost:5173`, API calls automatically proxied to `http://localhost:7071` (vite.config.ts configuration).

**Verify operation**:
1. Access `http://localhost:5173` in browser
2. Operate in Admin Settings or KPI Management screen
3. Test with local Storage or Mock API

### Azure Blob Storage Emulator (Azurite)

Emulate Azure Storage for local development:

```powershell
# Install Azurite
npm install -g azurite

# Start Azurite (Blob, Queue, Table)
azurite --location ./azurite-data --debug ./azurite-debug.log

# Verify in separate terminal
az storage blob list --account-name devstoreaccount1 --container-name raw --connection-string "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
```

**Update Functions local.settings.json**:

```json
"AzureWebJobsStorage": "UseDevelopmentStorage=true",
"STORAGE_ACCOUNT_NAME": "devstoreaccount1"
```

### Debug (VS Code)

Create `.vscode/launch.json`:

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

Start debugging with F5 key.

### Test Data Injection

```powershell
# Create Graph Interactions sample data
cd functions
node scripts/generate-sample-data.js

# Upload to Azurite
az storage blob upload --account-name devstoreaccount1 --container-name raw --name "graph_interactions/date=2025-01-01/sample.json" --file ./sample-data/graph_interactions.json --connection-string "UseDevelopmentStorage=true"
```

## Documentation

- [Architecture Design](docs/architecture.en.md) - Design decisions and rationale
- [Lakehouse Design](docs/lakehouse-design.en.md) - Schema DDL, folder structure, TTL design
- [Power BI Design](docs/powerbi-design.en.md) - Dual models, RLS, measure examples
- [Testing Strategy and Runbook](docs/testing-and-runbook.en.md) - Operations procedures, troubleshooting
- [Admin Portal](admin-portal/README.md) - Frontend build & deployment procedures
- [Local Development](LOCAL_DEVELOPMENT.en.md) - Local environment setup & debug procedures ← Newly added

## Pre-Setup Checklist

Confirm the following before initial setup:

1. **Copilot SKU ID**: Verify via Graph `/subscribedSkus`, set in `COPILOT_SKU_IDS`
2. **Entra Attributes**: Verify department/team info in `extensionAttribute10`
3. **Admin Group**: Entra Security Group name for Power BI RLS
4. **Azure OpenAI**: Verify deployed in Japan East/West region
5. **Weekly Schedule**: Visualization refresh day/time (default: Monday 09:00 JST)

## License

MIT License (sample code)

## Support

- Issues: GitHub Issues
- Documentation: [docs/](docs/)
- Runbook: [docs/testing-and-runbook.en.md](docs/testing-and-runbook.en.md)
