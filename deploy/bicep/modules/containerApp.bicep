// Reusable Container App module (used for both backend and frontend).
// The app runs under a user-assigned managed identity that already has AcrPull
// on the registry and access to the Key Vault secrets it references.

@description('Container App name.')
param name string

@description('Deployment location.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Resource id of the Container Apps managed environment.')
param environmentId string

@description('Resource id of the user-assigned managed identity for ACR pull + KV access.')
param userAssignedIdentityId string

@description('ACR login server (e.g. myregistry.azurecr.io). Empty to skip registry config.')
param acrLoginServer string = ''

@description('Container image reference to run.')
param image string

@description('Ingress target port.')
param targetPort int

@description('Whether ingress is external (public).')
param external bool = true

@description('vCPU cores (string so fractional values like "0.5" are preserved).')
param cpu string

@description('Memory (e.g. "1.0Gi").')
param memory string

param minReplicas int = 1
param maxReplicas int = 3

@description('Environment variables. Each item is { name, value } or { name, secretRef }.')
param envVars array = []

@description('Container App secrets. Each item is a Key Vault reference: { name, keyVaultUrl, identity }.')
param secrets array = []

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: external
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: empty(acrLoginServer)
        ? []
        : [
            {
              server: acrLoginServer
              identity: userAssignedIdentityId
            }
          ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: envVars
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
