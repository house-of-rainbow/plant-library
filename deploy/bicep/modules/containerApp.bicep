// Reusable Container App module (used for both backend and frontend).
// The app is created with a system-assigned identity so it can pull images
// from ACR once the AcrPull role is granted by the parent template.

@description('Container App name.')
param name string

@description('Deployment location.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Resource id of the Container Apps managed environment.')
param environmentId string

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

@description('Secrets as an object map of name -> value.')
@secure()
param secrets object = {}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
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
              identity: 'system'
            }
          ]
      secrets: [
        for s in items(secrets): {
          name: s.key
          #disable-next-line use-secure-value-for-secure-inputs
          value: s.value
        }
      ]
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
output principalId string = app.identity.principalId
output fqdn string = app.properties.configuration.ingress.fqdn
