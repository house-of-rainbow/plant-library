// ---------------------------------------------------------------------------
// Burien Station Plant Library — infrastructure & ancillary services.
// (resource-group scope)
//
// Deploys everything EXCEPT the container apps:
//   * Log Analytics + Container Apps managed environment
//   * User-assigned managed identity (used by the apps for ACR pull + KV reads)
//   * Cosmos DB (serverless) + database + containers
//   * Storage account + blob container (plant images)
//   * Key Vault + secrets (cosmos key, storage connection string, entra secret)
//
// Images are pulled from a pre-existing central ACR (not deployed here). The
// container apps are deployed by a separate template (app.bicep) that
// references the resources below as existing.
// ---------------------------------------------------------------------------

targetScope = 'resourceGroup'

@description('Short alphanumeric prefix used to derive resource names.')
param namePrefix string

@description('Deployment location.')
param location string = resourceGroup().location

@description('Environment name (e.g. prod, dev).')
param environmentName string

@description('Resource tags applied to all resources.')
param tags object = {}

// Cosmos
param cosmosDatabaseName string
param classesContainer string
param instancesContainer string

// Storage
param blobContainerName string

@description('Optional EntraID client secret (injected from a pipeline secret). Stored in Key Vault when provided.')
@secure()
param entraClientSecret string = ''

// Central container registry (pre-existing; not deployed by this template).
@description('Name of the existing central Azure Container Registry.')
param acrName string

@description('Resource group that contains the central ACR. Defaults to this resource group.')
param acrResourceGroup string = resourceGroup().name

@description('Subscription id that contains the central ACR. Defaults to the current subscription.')
param acrSubscriptionId string = subscription().subscriptionId

@description('Grant the app managed identity AcrPull on the central ACR. Disable if registry access is managed centrally.')
param assignAcrPull bool = true

// ---------------------------------------------------------------------------
// Naming (recomputed identically in app.bicep — same formula, same RG)
// ---------------------------------------------------------------------------
var suffix = uniqueString(resourceGroup().id)
var storageName = toLower(take('${namePrefix}st${suffix}', 24))
var cosmosName = toLower(take('${namePrefix}-cosmos-${suffix}', 44))
var keyVaultName = take('${namePrefix}kv${suffix}', 24)
var lawName = '${namePrefix}-law-${environmentName}'
var envName = '${namePrefix}-cae-${environmentName}'
var uamiName = '${namePrefix}-uami-${environmentName}'
var backendName = '${namePrefix}-backend'
var frontendName = '${namePrefix}-frontend'

var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)

// ---------------------------------------------------------------------------
// Central Container Registry (existing — referenced only, for loginServer)
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
  scope: resourceGroup(acrSubscriptionId, acrResourceGroup)
}

// ---------------------------------------------------------------------------
// User-assigned managed identity (shared by the container apps)
// ---------------------------------------------------------------------------
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: uamiName
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Observability + Container Apps environment
// ---------------------------------------------------------------------------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cosmos DB (serverless, SQL API)
// ---------------------------------------------------------------------------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    minimalTlsVersion: 'Tls12'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource classesCol 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: classesContainer
  properties: {
    resource: {
      id: classesContainer
      partitionKey: {
        paths: [
          '/pk'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource instancesCol 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: instancesContainer
  properties: {
    resource: {
      id: instancesContainer
      partitionKey: {
        paths: [
          '/pk'
        ]
        kind: 'Hash'
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Storage (plant images)
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource imagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: {
    publicAccess: 'Blob'
  }
}

// ---------------------------------------------------------------------------
// Key Vault + secrets (consumed by the container apps as secret refs)
// Access-policy model so template-created secrets work with a Contributor
// deployer; the app identity gets get/list on secrets.
// ---------------------------------------------------------------------------
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: false
    enableSoftDelete: true
    accessPolicies: [
      {
        tenantId: tenant().tenantId
        objectId: uami.properties.principalId
        permissions: {
          secrets: [
            'get'
            'list'
          ]
        }
      }
    ]
  }
}

resource secretCosmosKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cosmos-key'
  properties: {
    value: cosmos.listKeys().primaryMasterKey
  }
}

resource secretStorageConn 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'storage-connection-string'
  properties: {
    value: storageConnectionString
  }
}

resource secretEntra 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(entraClientSecret)) {
  parent: keyVault
  name: 'entra-client-secret'
  properties: {
    value: entraClientSecret
  }
}

// ---------------------------------------------------------------------------
// Role assignments for the shared managed identity
//   * AcrPull on the central ACR (module scoped to the ACR's resource group)
//   * Key Vault secret access is granted via the access policy above
// ---------------------------------------------------------------------------
module acrPull 'modules/acrPull.bicep' = if (assignAcrPull) {
  name: 'uamiAcrPull'
  scope: resourceGroup(acrSubscriptionId, acrResourceGroup)
  params: {
    acrName: acrName
    principalId: uami.properties.principalId
  }
}

// ---------------------------------------------------------------------------
// Outputs consumed by the app deployment + release pipeline
// ---------------------------------------------------------------------------
output managedEnvironmentName string = caEnv.name
output managedEnvironmentId string = caEnv.id
output userAssignedIdentityId string = uami.id
output userAssignedIdentityClientId string = uami.properties.clientId
output keyVaultName string = keyVault.name
output cosmosAccountName string = cosmos.name
output storageAccountName string = storage.name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output backendAppName string = backendName
output frontendAppName string = frontendName
#disable-next-line outputs-should-not-contain-secrets
output customDomainVerificationId string = caEnv.properties.customDomainConfiguration == null ? '' : caEnv.properties.customDomainConfiguration.customDomainVerificationId
