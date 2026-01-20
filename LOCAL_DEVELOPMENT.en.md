# Local Development Quick Start

[日本語](LOCAL_DEVELOPMENT.md) | **English**

## 1. Prerequisites Installation

```powershell
# Verify Node.js
node --version  # v20 or later

# Azure Functions Core Tools
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Azurite (storage emulator)
npm install -g azurite
```

## 2. Functions Local Execution

### Terminal 1: Start Azurite

```powershell
cd functions
azurite --location ./azurite-data --debug ./azurite-debug.log
```

### Terminal 2: Start Functions

```powershell
cd functions

# First time only
npm install
cp local.settings.json.template local.settings.json
# Edit local.settings.json (as needed)

# TypeScript Watch
npm run watch
```

### Terminal 3: Start Functions Host

```powershell
cd functions
npm run start
```

→ Starts at `http://localhost:7071`

## 3. Admin Portal Local Execution

### Terminal 4: Start Frontend

```powershell
cd admin-portal

# First time only
npm install

# Start dev server
npm run dev
```

→ Starts at `http://localhost:5173`

**Admin screen configuration features**:
- **Schedule Configuration**: Simple selection options like "Daily", "Weekly", "Monthly" instead of CRON format
- **Execution Time**: Preset selection or custom time (0-23 hours)
- UI-configured values are internally converted to CRON format and saved to Azure Table Storage

## 4. Sample Data Injection

```powershell
cd functions

# Generate sample data
node scripts/generate-sample-data.js

# Upload to Azurite (separate terminal)
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

## 5. Operation Verification

### Functions API Test

```powershell
# Get config list
Invoke-RestMethod -Uri "http://localhost:7071/api/config" -Method GET

# Get KPI list
Invoke-RestMethod -Uri "http://localhost:7071/api/kpi" -Method GET

# Get agent list
Invoke-RestMethod -Uri "http://localhost:7071/api/agents" -Method GET
```

### Frontend Verification

1. Access `http://localhost:5173` in browser
2. Select "Admin Settings" or "KPI Management" from sidebar
3. Test data operations

## Troubleshooting

### Functions Won't Start

```powershell
# Check port
netstat -ano | findstr :7071

# Terminate process
Stop-Process -Id <PID> -Force
```

### Azurite Connection Error

```powershell
# Verify Azurite process
Get-Process azurite

# Reset Azurite data
Remove-Item -Recurse -Force ./azurite-data
azurite --location ./azurite-data
```

### TypeScript Compile Error

```powershell
cd functions
npm run build  # Check error details
```

## VS Code Debug

1. Verify `.vscode/launch.json`
2. Start "Attach to Node Functions" with F5 key
3. Set breakpoints
4. Verify stops on API calls
