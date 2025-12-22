// M365 Copilot Analytics - 最小 Azure 構成 (Japan East 固定)
// Storage (raw コンテナ) + Key Vault + Function App (MI)

targetScope = 'resourceGroup'

@description('デプロイ先リージョン (Japan East 固定)')
param location string = 'japaneast'

@description('リソース接頭語 (例: copilot-analytics)')
param prefix string = 'copilot-analytics'

@description('環境名 (dev/stg/prd)')
param environment string = 'dev'

@description('Storage アカウント名 (3-24文字、英小文字数字のみ)')
param storageAccountName string = 'stcopan${environment}${uniqueString(resourceGroup().id)}'

@description('Key Vault 名 (3-24文字)')
param keyVaultName string = 'kv-${prefix}-${environment}'

@description('Function App 名')
param functionAppName string = 'func-${prefix}-${environment}'

@description('Function App SKU (Y1=消費プラン、EP1=Premium)')
@allowed(['Y1', 'EP1'])
param functionAppSku string = 'Y1'

// Storage Account
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    networkAcls: {
      defaultAction: 'Allow' // PoC: Allow、本番: Deny + Private Endpoint
    }
  }

  resource blobService 'blobServices' = {
    name: 'default'

    resource rawContainer 'containers' = {
      name: 'raw'
      properties: {
        publicAccess: 'None'
      }
    }
  }
}

// Storage Lifecycle Management (14日TTL)
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  name: 'default'
  parent: storage
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'delete-raw-after-14days'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['raw/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 14
                }
              }
            }
          }
        }
      ]
    }
  }
}

// Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // RBAC モデル
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
    networkAcls: {
      defaultAction: 'Allow' // PoC: Allow、本番: Deny + Private Endpoint
      bypass: 'AzureServices'
    }
  }
}

// App Service Plan (Consumption or Premium)
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${functionAppName}-plan'
  location: location
  sku: {
    name: functionAppSku
    tier: functionAppSku == 'Y1' ? 'Dynamic' : 'ElasticPremium'
  }
  kind: 'functionapp'
  properties: {
    reserved: false // Windows
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionAppName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${az.environment().suffixes.storage}'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'RAW_CONTAINER'
          value: 'raw'
        }
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storage.name
        }
        // Key Vault 参照 (シークレットは後で手動登録)
        {
          name: 'HASH_SALT'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVault.name}${az.environment().suffixes.keyvaultDns}/secrets/hash-salt)'
        }
        {
          name: 'COPILOT_SKU_IDS'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVault.name}${az.environment().suffixes.keyvaultDns}/secrets/copilot-sku-ids)'
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVault.name}${az.environment().suffixes.keyvaultDns}/secrets/azure-openai-endpoint)'
        }
        {
          name: 'AZURE_OPENAI_KEY'
          value: '@Microsoft.KeyVault(SecretUri=https://${keyVault.name}${az.environment().suffixes.keyvaultDns}/secrets/azure-openai-key)'
        }
      ]
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}

// RBAC: Function App MI → Key Vault Secrets User
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// RBAC: Function App MI → Storage Blob Data Contributor
resource storageBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe') // Storage Blob Data Contributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Outputs
output storageAccountName string = storage.name
output storageAccountId string = storage.id
output keyVaultName string = keyVault.name
output keyVaultId string = keyVault.id
output functionAppName string = functionApp.name
output functionAppPrincipalId string = functionApp.identity.principalId
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
