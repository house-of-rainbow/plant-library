// Parameters for infra.bicep, sourced from config.json so all tunables live in
// one tracked file. The EntraID client secret is intentionally NOT in
// config.json — it is injected from a pipeline secret via an env var.

using './infra.bicep'

var config = loadJsonContent('../config.json')

param namePrefix = config.namePrefix
param location = config.location
param environmentName = config.environment
param tags = config.tags

param cosmosDatabaseName = config.cosmos.databaseName
param classesContainer = config.cosmos.classesContainer
param instancesContainer = config.cosmos.instancesContainer

param blobContainerName = config.storage.blobContainerName

param acrName = config.acr.name
param acrResourceGroup = config.acr.resourceGroup
param acrSubscriptionId = config.acr.subscriptionId

// Injected by the pipeline (secure). Empty locally.
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
param plantnetApiKey = readEnvironmentVariable('PLANT_DOT_NET__API_KEY', '')
param openaiApiKey = readEnvironmentVariable('OPENAI_API_KEY', '')
