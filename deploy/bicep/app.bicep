// ---------------------------------------------------------------------------
// Burien Station Plant Library — container apps (resource-group scope).
//
// Deployed as a SEPARATE stage after infra.bicep and after the images are
// pushed to ACR. Everything else (environment, identity, Key Vault, Cosmos,
// Storage, ACR) is referenced as an EXISTING resource — resource names are
// recomputed with the same formula/RG used by infra.bicep.
//
// Secrets are pulled from Key Vault at runtime via the user-assigned identity
// (no secret values pass through this template).
// ---------------------------------------------------------------------------

targetScope = 'resourceGroup'

@description('Short alphanumeric prefix used to derive resource names (must match infra.bicep).')
param namePrefix string

@description('Environment name (e.g. prod, dev) — must match infra.bicep.')
param environmentName string

@description('Deployment location.')
param location string = resourceGroup().location

@description('Resource tags applied to the container apps.')
param tags object = {}

// Central ACR (existing)
param acrName string
param acrResourceGroup string = resourceGroup().name

@description('Subscription id that contains the central ACR. Defaults to the current subscription.')
param acrSubscriptionId string = subscription().subscriptionId

// Cosmos / Storage config (must match infra.bicep)
param cosmosDatabaseName string
param classesContainer string
param instancesContainer string
param blobContainerName string

// Auth (non-secret)
param authDisabled bool
param entraTenantId string
param entraClientId string
param entraApiAudience string

@description('API scope the SPA requests (e.g. api://<clientId>/access_as_user).')
param entraApiScope string = ''

@description('Whether an entra-client-secret exists in Key Vault (set by the pipeline).')
param hasEntraSecret bool = false

@description('Whether a plantnet-api-key exists in Key Vault (set by the pipeline).')
param hasPlantnetKey bool = false

@description('Whether an openai-api-key exists in Key Vault (set by the pipeline).')
param hasOpenaiKey bool = false

@description('OpenAI model used for the identification fallback.')
param openaiModel string = 'gpt-4o'

// Images (set by the release pipeline; default placeholder for a dry run)
param backendImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param frontendImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param mcpImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Whether an mcp-api-keys secret exists in Key Vault (set by the pipeline).')
param hasMcpApiKeys bool = false

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

// MCP app sizing
param mcpCpu string
param mcpMemory string
param mcpMinReplicas int
param mcpMaxReplicas int
param mcpTargetPort int

// ---------------------------------------------------------------------------
// Names (identical formula to infra.bicep — same RG, so uniqueString matches)
// ---------------------------------------------------------------------------
var suffix = uniqueString(resourceGroup().id)
var storageName = toLower(take('${namePrefix}st${suffix}', 24))
var cosmosName = toLower(take('${namePrefix}-cosmos-${suffix}', 44))
var keyVaultName = take('${namePrefix}kv${suffix}', 24)
var envName = '${namePrefix}-cae-${environmentName}'
var uamiName = '${namePrefix}-uami-${environmentName}'
var backendName = '${namePrefix}-backend'
var frontendName = '${namePrefix}-frontend'
var mcpName = '${namePrefix}-mcp'

// ---------------------------------------------------------------------------
// Existing resources (created by infra.bicep)
// ---------------------------------------------------------------------------
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: envName
}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: uamiName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
  scope: resourceGroup(acrSubscriptionId, acrResourceGroup)
}

// ---------------------------------------------------------------------------
// Derived values (no app-to-app references → no dependency cycle)
// ---------------------------------------------------------------------------
var envDefaultDomain = caEnv.properties.defaultDomain
var backendFqdn = '${backendName}.${envDefaultDomain}'
var frontendFqdn = '${frontendName}.${envDefaultDomain}'
var kvUri = keyVault.properties.vaultUri // ends with '/'
var acrLoginServer = acr.properties.loginServer

var backendSecrets = concat(
  [
    {
      name: 'cosmos-key'
      keyVaultUrl: '${kvUri}secrets/cosmos-key'
      identity: uami.id
    }
    {
      name: 'storage-connection-string'
      keyVaultUrl: '${kvUri}secrets/storage-connection-string'
      identity: uami.id
    }
  ],
  hasEntraSecret
    ? [
        {
          name: 'entra-client-secret'
          keyVaultUrl: '${kvUri}secrets/entra-client-secret'
          identity: uami.id
        }
      ]
    : [],
  hasPlantnetKey
    ? [
        {
          name: 'plantnet-api-key'
          keyVaultUrl: '${kvUri}secrets/plantnet-api-key'
          identity: uami.id
        }
      ]
    : [],
  hasOpenaiKey
    ? [
        {
          name: 'openai-api-key'
          keyVaultUrl: '${kvUri}secrets/openai-api-key'
          identity: uami.id
        }
      ]
    : []
)

var backendBaseEnv = [
  { name: 'APP_ENV', value: environmentName }
  { name: 'LOG_LEVEL', value: 'INFO' }
  { name: 'CORS_ORIGINS', value: 'https://${frontendFqdn}' }
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
  { name: 'SCAN_BASE_URL', value: 'https://${frontendFqdn}/scan' }
]

var backendEnv = concat(
  backendBaseEnv,
  hasEntraSecret
    ? [
        { name: 'ENTRA_CLIENT_SECRET', secretRef: 'entra-client-secret' }
      ]
    : [],
  hasPlantnetKey
    ? [
        { name: 'PLANT_DOT_NET__API_KEY', secretRef: 'plantnet-api-key' }
      ]
    : [],
  hasOpenaiKey
    ? [
        { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
        { name: 'OPENAI_MODEL', value: openaiModel }
      ]
    : []
)

var mcpSecrets = concat(
  [
    {
      name: 'cosmos-key'
      keyVaultUrl: '${kvUri}secrets/cosmos-key'
      identity: uami.id
    }
  ],
  hasMcpApiKeys
    ? [
        {
          name: 'mcp-api-keys'
          keyVaultUrl: '${kvUri}secrets/mcp-api-keys'
          identity: uami.id
        }
      ]
    : []
)

var mcpEnv = concat(
  [
    { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
    { name: 'COSMOS_KEY', secretRef: 'cosmos-key' }
    { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
    { name: 'COSMOS_CLASSES_CONTAINER', value: classesContainer }
    { name: 'COSMOS_INSTANCES_CONTAINER', value: instancesContainer }
    { name: 'COSMOS_ALLOW_INSECURE', value: 'false' }
    { name: 'SCAN_BASE_URL', value: 'https://${frontendFqdn}/scan' }
  ],
  hasMcpApiKeys
    ? [
        { name: 'MCP_API_KEYS', secretRef: 'mcp-api-keys' }
      ]
    : []
)

// ---------------------------------------------------------------------------
// Container apps
// ---------------------------------------------------------------------------
module backendApp 'modules/containerApp.bicep' = {
  name: 'backendApp'
  params: {
    name: backendName
    location: location
    tags: tags
    environmentId: caEnv.id
    userAssignedIdentityId: uami.id
    acrLoginServer: acrLoginServer
    image: backendImage
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

module frontendApp 'modules/containerApp.bicep' = {
  name: 'frontendApp'
  params: {
    name: frontendName
    location: location
    tags: tags
    environmentId: caEnv.id
    userAssignedIdentityId: uami.id
    acrLoginServer: acrLoginServer
    image: frontendImage
    targetPort: frontendTargetPort
    external: true
    cpu: frontendCpu
    memory: frontendMemory
    minReplicas: frontendMinReplicas
    maxReplicas: frontendMaxReplicas
    envVars: [
      {
        name: 'BACKEND_URL'
        value: 'https://${backendFqdn}'
      }
      {
        // Upstream host used by nginx for SNI + the Host header (ACA routing).
        name: 'BACKEND_HOST'
        value: backendFqdn
      }
      {
        name: 'AUTH_DISABLED'
        value: authDisabled ? 'true' : 'false'
      }
      {
        name: 'ENTRA_CLIENT_ID'
        value: entraClientId
      }
      {
        name: 'ENTRA_TENANT_ID'
        value: entraTenantId
      }
      {
        name: 'ENTRA_API_SCOPE'
        value: entraApiScope
      }
    ]
  }
}

module mcpApp 'modules/containerApp.bicep' = {
  name: 'mcpApp'
  params: {
    name: mcpName
    location: location
    tags: tags
    environmentId: caEnv.id
    userAssignedIdentityId: uami.id
    acrLoginServer: acrLoginServer
    image: mcpImage
    targetPort: mcpTargetPort
    external: true
    cpu: mcpCpu
    memory: mcpMemory
    minReplicas: mcpMinReplicas
    maxReplicas: mcpMaxReplicas
    envVars: mcpEnv
    secrets: mcpSecrets
  }
}

output backendAppName string = backendApp.outputs.name
output frontendAppName string = frontendApp.outputs.name
output backendFqdn string = backendApp.outputs.fqdn
output frontendFqdn string = frontendApp.outputs.fqdn
output mcpAppName string = mcpApp.outputs.name
output mcpFqdn string = mcpApp.outputs.fqdn
