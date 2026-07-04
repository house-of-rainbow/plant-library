// ---------------------------------------------------------------------------
// Burien Station Plant Library — core infrastructure (resource-group scope).
//
// Deploys: Log Analytics + Container Apps environment, Azure Container Registry,
// Cosmos DB (serverless), Storage (blob), and two Container Apps (backend +
// frontend). Apps are created with a placeholder image; the release pipeline
// pushes real images to ACR and updates the apps.
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

// Backend app sizing
param backendCpu string
param backendMemory string
param backendMinReplicas int
param backendMaxReplicas int
param backendTargetPort int

// Frontend app sizing
param frontendCpu string
param frontendMemory string
param frontendMinReplicas int
param frontendMaxReplicas int
param frontendTargetPort int

// Auth
param authDisabled bool
param entraTenantId string
param entraClientId string
param entraApiAudience string

@description('Optional EntraID client secret (injected from a pipeline secret, not config.json).')
@secure()
param entraClientSecret string = ''

// Placeholder image used until the release pipeline pushes real images.
param placeholderImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
var suffix = uniqueString(resourceGroup().id)
var acrName = toLower(take('${namePrefix}acr${suffix}', 50))
var storageName = toLower(take('${namePrefix}st${suffix}', 24))
var cosmosName = toLower(take('${namePrefix}-cosmos-${suffix}', 44))
var lawName = '${namePrefix}-law-${environmentName}'
var envName = '${namePrefix}-cae-${environmentName}'
var backendName = '${namePrefix}-backend'
var frontendName = '${namePrefix}-frontend'

var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

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
// Container Registry
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
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
// Secrets + environment for the backend container app
// ---------------------------------------------------------------------------
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

var backendSecrets = union(
  {
    'cosmos-key': cosmos.listKeys().primaryMasterKey
    'storage-connection-string': storageConnectionString
  },
  empty(entraClientSecret) ? {} : { 'entra-client-secret': entraClientSecret }
)

// Frontend is created first (no dependency on backend) so the backend can
// reference the frontend FQDN for CORS + scan links without a cycle.
module frontendApp 'modules/containerApp.bicep' = {
  name: 'frontendApp'
  params: {
    name: frontendName
    location: location
    tags: tags
    environmentId: caEnv.id
    acrLoginServer: acr.properties.loginServer
    image: placeholderImage
    targetPort: frontendTargetPort
    external: true
    cpu: frontendCpu
    memory: frontendMemory
    minReplicas: frontendMinReplicas
    maxReplicas: frontendMaxReplicas
    envVars: [
      {
        // Overwritten by the release pipeline with the backend FQDN.
        name: 'BACKEND_URL'
        value: 'http://localhost:8000'
      }
    ]
  }
}

var backendBaseEnv = [
  { name: 'APP_ENV', value: environmentName }
  { name: 'LOG_LEVEL', value: 'INFO' }
  { name: 'CORS_ORIGINS', value: 'https://${frontendApp.outputs.fqdn}' }
  { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
  { name: 'COSMOS_KEY', secretRef: 'cosmos-key' }
  { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
  { name: 'COSMOS_CLASSES_CONTAINER', value: classesContainer }
  { name: 'COSMOS_INSTANCES_CONTAINER', value: instancesContainer }
  { name: 'COSMOS_ALLOW_INSECURE', value: 'false' }
  { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
  { name: 'AZURE_STORAGE_CONTAINER', value: blobContainerName }
  { name: 'AZURE_STORAGE_PUBLIC_BASE_URL', value: storage.properties.primaryEndpoints.blob }
  { name: 'AUTH_DISABLED', value: authDisabled ? 'true' : 'false' }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
  { name: 'SCAN_BASE_URL', value: 'https://${frontendApp.outputs.fqdn}/scan' }
]

var backendEnv = empty(entraClientSecret)
  ? backendBaseEnv
  : concat(backendBaseEnv, [
      { name: 'ENTRA_CLIENT_SECRET', secretRef: 'entra-client-secret' }
    ])

module backendApp 'modules/containerApp.bicep' = {
  name: 'backendApp'
  params: {
    name: backendName
    location: location
    tags: tags
    environmentId: caEnv.id
    acrLoginServer: acr.properties.loginServer
    image: placeholderImage
    targetPort: backendTargetPort
    external: true
    cpu: backendCpu
    memory: backendMemory
    minReplicas: backendMinReplicas
    maxReplicas: backendMaxReplicas
    envVars: backendEnv
    secrets: backendSecrets
  }
}

// ---------------------------------------------------------------------------
// Allow both apps to pull from ACR via their managed identities.
// ---------------------------------------------------------------------------
resource backendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, backendName, 'AcrPull')
  scope: acr
  properties: {
    principalId: backendApp.outputs.principalId
    roleDefinitionId: acrPullRoleId
    principalType: 'ServicePrincipal'
  }
}

resource frontendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, frontendName, 'AcrPull')
  scope: acr
  properties: {
    principalId: frontendApp.outputs.principalId
    roleDefinitionId: acrPullRoleId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs consumed by the release pipeline
// ---------------------------------------------------------------------------
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output backendAppName string = backendApp.outputs.name
output frontendAppName string = frontendApp.outputs.name
output backendFqdn string = backendApp.outputs.fqdn
output frontendFqdn string = frontendApp.outputs.fqdn
output cosmosAccountName string = cosmos.name
output storageAccountName string = storage.name
output managedEnvironmentName string = caEnv.name
#disable-next-line outputs-should-not-contain-secrets
output customDomainVerificationId string = caEnv.properties.customDomainConfiguration == null ? '' : caEnv.properties.customDomainConfiguration.customDomainVerificationId
