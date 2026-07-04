<#
.SYNOPSIS
    One-time creation of the EntraID (Azure AD) App Registration for the
    Burien Station Plant Library, plus a client secret and an exposed API scope.

.DESCRIPTION
    Creates (or reuses) a single-tenant app registration used by both the SPA
    frontend and the FastAPI backend:
      * exposes an API scope (access_as_user) with identifier api://<appId>
      * registers SPA redirect URIs for local + deployed frontends
      * creates a service principal
      * generates a client secret

    Outputs everything you need (App/Client Id, Object Id, Tenant Id, Client
    Secret) to the console and to deploy/appreg-output.json.

    Uses the Azure CLI (az). Sign in first with:  az login

.EXAMPLE
    pwsh ./deploy/scripts/Create-AppRegistrations.ps1 `
        -DisplayName "Burien Station Plant Library" `
        -RedirectUris "http://localhost:5173","https://my-frontend.azurecontainerapps.io"
#>
[CmdletBinding()]
param(
    [string]$DisplayName = "Burien Station Plant Library",

    [string[]]$RedirectUris = @("http://localhost:5173"),

    [ValidateSet("AzureADMyOrg", "AzureADMultipleOrgs")]
    [string]$SignInAudience = "AzureADMyOrg",

    [string]$OutputFile = "$PSScriptRoot/../appreg-output.json"
)

$ErrorActionPreference = "Stop"

function Require-Az {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is required. Install it and run 'az login' first."
    }
    $account = az account show 2>$null | ConvertFrom-Json
    if (-not $account) {
        throw "Not signed in. Run 'az login' (and 'az account set --subscription <id>') first."
    }
    return $account
}

$account = Require-Az
$tenantId = $account.tenantId
Write-Host "Tenant: $tenantId" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Create or reuse the app registration
# ---------------------------------------------------------------------------
$existing = az ad app list --display-name $DisplayName --query "[0]" | ConvertFrom-Json
if ($existing) {
    Write-Host "Reusing existing app registration '$DisplayName' ($($existing.appId))" -ForegroundColor Yellow
    $appId = $existing.appId
} else {
    Write-Host "Creating app registration '$DisplayName'..." -ForegroundColor Green
    $created = az ad app create `
        --display-name $DisplayName `
        --sign-in-audience $SignInAudience | ConvertFrom-Json
    $appId = $created.appId
}

# Object id of the application object
$appObjectId = az ad app show --id $appId --query id -o tsv

# ---------------------------------------------------------------------------
# Expose an API scope: api://<appId>/access_as_user
# ---------------------------------------------------------------------------
$identifierUri = "api://$appId"
$scopeId = [guid]::NewGuid().ToString()

$apiManifest = @{
    identifierUris = @($identifierUri)
    api            = @{
        oauth2PermissionScopes = @(
            @{
                id                      = $scopeId
                adminConsentDisplayName = "Access the Plant Library API"
                adminConsentDescription = "Allows the app to access the Plant Library API as the signed-in user."
                userConsentDisplayName  = "Access the Plant Library API"
                userConsentDescription  = "Allows the app to access the Plant Library API on your behalf."
                value                   = "access_as_user"
                type                    = "User"
                isEnabled               = $true
            }
        )
    }
} | ConvertTo-Json -Depth 10

$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value $apiManifest -Encoding utf8
# PATCH the application via Microsoft Graph to set identifierUri + scope.
az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
    --headers "Content-Type=application/json" `
    --body "@$tmp" | Out-Null
Remove-Item $tmp -Force

# ---------------------------------------------------------------------------
# SPA redirect URIs (for MSAL in the React frontend)
# ---------------------------------------------------------------------------
$spaBody = @{ spa = @{ redirectUris = $RedirectUris } } | ConvertTo-Json -Depth 5
$tmp2 = New-TemporaryFile
Set-Content -Path $tmp2 -Value $spaBody -Encoding utf8
az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
    --headers "Content-Type=application/json" `
    --body "@$tmp2" | Out-Null
Remove-Item $tmp2 -Force

# ---------------------------------------------------------------------------
# Service principal (enterprise app)
# ---------------------------------------------------------------------------
$sp = az ad sp show --id $appId 2>$null | ConvertFrom-Json
if (-not $sp) {
    Write-Host "Creating service principal..." -ForegroundColor Green
    $sp = az ad sp create --id $appId | ConvertFrom-Json
}
$spObjectId = $sp.id

# ---------------------------------------------------------------------------
# Client secret
# ---------------------------------------------------------------------------
Write-Host "Creating client secret..." -ForegroundColor Green
$secret = az ad app credential reset `
    --id $appId `
    --display-name "plant-library-secret" `
    --years 1 `
    --query password -o tsv

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
$result = [ordered]@{
    tenantId              = $tenantId
    appId                 = $appId       # a.k.a. client id
    applicationObjectId   = $appObjectId
    servicePrincipalId    = $spObjectId  # enterprise app object id
    apiAudience           = $identifierUri
    apiScope              = "$identifierUri/access_as_user"
    clientSecret          = $secret
    spaRedirectUris       = $RedirectUris
}

$result | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputFile -Encoding utf8

Write-Host ""
Write-Host "==================== App Registration ready ====================" -ForegroundColor Cyan
$result.GetEnumerator() | ForEach-Object {
    if ($_.Key -eq "clientSecret") {
        Write-Host ("{0,-22}: {1}" -f $_.Key, "<hidden - see $OutputFile>")
    } else {
        Write-Host ("{0,-22}: {1}" -f $_.Key, ($_.Value -join ", "))
    }
}
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Saved full output (including the secret) to: $OutputFile" -ForegroundColor Yellow
Write-Host "Store the client secret securely (pipeline secret ENTRA_CLIENT_SECRET / Key Vault)." -ForegroundColor Yellow
Write-Host "Do NOT commit appreg-output.json." -ForegroundColor Yellow
