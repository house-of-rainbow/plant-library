// ---------------------------------------------------------------------------
// Custom-domain managed certificates for the Plant Library Container Apps.
//
// Provisions an Azure Container Apps *managed certificate* (ACME-issued and
// auto-renewed by Azure) for each custom domain, validated via CNAME. The
// release pipeline binds these certificates to the apps (SNI) after creation.
//
// Managed certificates are reused across runs: this template is idempotent, and
// once issued Azure renews the certificate automatically — no re-issue needed.
// ---------------------------------------------------------------------------

targetScope = 'resourceGroup'

@description('Name of the existing Container Apps managed environment.')
param environmentName string

@description('Location for the certificate resources.')
param location string = resourceGroup().location

@description('Domains to provision managed certificates for. Each: { dnsName, certificateName }.')
param domains array

resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource managedCerts 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = [
  for d in domains: {
    parent: caEnv
    name: d.certificateName
    location: location
    properties: {
      subjectName: d.dnsName
      domainControlValidation: 'CNAME'
    }
  }
]

output certificates array = [
  for (d, i) in domains: {
    dnsName: d.dnsName
    certificateName: d.certificateName
    certificateId: managedCerts[i].id
  }
]
