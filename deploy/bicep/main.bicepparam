// Parameters for main.bicep, sourced from config.json so all tunables live in
// one tracked file. The EntraID client secret is intentionally NOT in
// config.json — it is injected from a pipeline secret via an env var.

using './main.bicep'

var config = loadJsonContent('../config.json')

param namePrefix = config.namePrefix
param location = config.location
param environmentName = config.environment
param tags = config.tags

param cosmosDatabaseName = config.cosmos.databaseName
param classesContainer = config.cosmos.classesContainer
param instancesContainer = config.cosmos.instancesContainer

param blobContainerName = config.storage.blobContainerName

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

param authDisabled = config.auth.authDisabled
param entraTenantId = config.auth.entraTenantId
param entraClientId = config.auth.entraClientId
param entraApiAudience = config.auth.entraApiAudience

// Injected by the pipeline (secure). Empty locally.
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
