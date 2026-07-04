// Parameters for app.bicep, sourced from config.json. Images and the presence
// of the EntraID secret are injected by the release pipeline via env vars.

using './app.bicep'

var config = loadJsonContent('../config.json')

param namePrefix = config.namePrefix
param environmentName = config.environment
param location = config.location
param tags = config.tags

param acrName = config.acr.name
param acrResourceGroup = config.acr.resourceGroup
param acrSubscriptionId = config.acr.subscriptionId

param cosmosDatabaseName = config.cosmos.databaseName
param classesContainer = config.cosmos.classesContainer
param instancesContainer = config.cosmos.instancesContainer
param blobContainerName = config.storage.blobContainerName

param authDisabled = config.auth.authDisabled
param entraTenantId = config.auth.entraTenantId
param entraClientId = config.auth.entraClientId
param entraApiAudience = config.auth.entraApiAudience
param entraApiScope = config.auth.entraApiScope

param backendCpu = config.backend.cpu
param backendMemory = config.backend.memory
param backendMinReplicas = config.backend.minReplicas
param backendMaxReplicas = config.backend.maxReplicas
param backendTargetPort = config.backend.targetPort

param frontendCpu = config.frontend.cpu
param frontendMemory = config.frontend.memory
param frontendMinReplicas = config.frontend.minReplicas
param frontendMaxReplicas = config.frontend.maxReplicas
param frontendTargetPort = config.frontend.targetPort

// Injected by the pipeline. Images default to a placeholder for a dry run.
param backendImage = readEnvironmentVariable('BACKEND_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')
param frontendImage = readEnvironmentVariable('FRONTEND_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')
param hasEntraSecret = !empty(readEnvironmentVariable('ENTRA_CLIENT_SECRET', ''))
param hasPlantnetKey = !empty(readEnvironmentVariable('PLANT_DOT_NET__API_KEY', ''))
