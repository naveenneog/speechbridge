<#
    SpeechBridge — postprovision hook (Windows / PowerShell)

    Creates a Microsoft Entra app registration and switches on App Service built-in
    authentication, so `azd up` produces a site only your organisation can open.

    Why this runs as a hook rather than in Bicep: the redirect URI has to contain the
    site's hostname, which does not exist until the site is provisioned.

    If the deploying account lacks app-registration rights, this fails loudly but
    harmlessly — the app is configured with ACCESS_MODE=authenticated, so it refuses to
    mint Speech credentials for an unauthenticated caller. It fails closed, not open.
#>

$ErrorActionPreference = 'Continue'

<#
    Reads azd environment values in one call.

    Deliberately not using `$ErrorActionPreference = 'Stop'` around native commands: azd
    writes advisory notices (for example "your version of azd is out of date") to stderr,
    and under Stop, PowerShell promotes native stderr output to a terminating error. That
    killed this hook on its first line for anyone whose azd was not the newest build,
    silently skipping authentication setup.
#>
$azdValues = @{}
try {
    $raw = & azd env get-values 2>$null
    foreach ($line in @($raw)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
            $azdValues[$Matches[1]] = $Matches[2]
        }
    }
}
catch {
    Write-Warning "Could not read the azd environment: $_"
}

function Get-AzdEnv {
    param([string]$Name)
    $value = $azdValues[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return $value.Trim()
}

$subscriptionId = Get-AzdEnv 'AZURE_SUBSCRIPTION_ID'
$resourceGroup  = Get-AzdEnv 'AZURE_RESOURCE_GROUP'
$siteName       = Get-AzdEnv 'SERVICE_WEB_NAME'
$siteUri        = Get-AzdEnv 'SERVICE_WEB_URI'
$tenantId       = Get-AzdEnv 'AZURE_TENANT_ID'
$envName        = Get-AzdEnv 'AZURE_ENV_NAME'
$clientId       = Get-AzdEnv 'AUTH_CLIENT_ID'

if (-not $siteName -or -not $resourceGroup) {
    Write-Host 'postprovision: no web app in this environment yet; nothing to configure.'
    exit 0
}

Write-Host ''
Write-Host 'Configuring Microsoft Entra authentication for the site...'

$redirectUri = "$siteUri/.auth/login/aad/callback"

if (-not $clientId) {
    Write-Host "  creating app registration for $siteUri"
    try {
        $appId = az ad app create `
            --display-name "SpeechBridge ($envName)" `
            --sign-in-audience AzureADMyOrg `
            --web-redirect-uris $redirectUri `
            --enable-id-token-issuance true `
            --query appId -o tsv 2>$null

        if ([string]::IsNullOrWhiteSpace($appId)) { throw 'app registration returned no appId' }

        # The service principal is what actually appears in the tenant and grants sign-in.
        az ad sp create --id $appId 2>$null | Out-Null

        $clientId = $appId.Trim()
        azd env set AUTH_CLIENT_ID $clientId | Out-Null
        Write-Host "  created app registration $clientId"
    }
    catch {
        Write-Warning ''
        Write-Warning 'Could not create the Microsoft Entra app registration.'
        Write-Warning 'This usually means your account lacks application-registration rights.'
        Write-Warning ''
        Write-Warning 'The site is deployed but will REFUSE to work until authentication is set up,'
        Write-Warning 'because it will not mint Azure Speech credentials for an unauthenticated'
        Write-Warning 'caller. That is deliberate: it fails closed rather than exposing your'
        Write-Warning 'subscription to the internet.'
        Write-Warning ''
        Write-Warning 'To finish, ask an administrator to create an app registration with redirect URI:'
        Write-Warning "    $redirectUri"
        Write-Warning 'then run:'
        Write-Warning '    azd env set AUTH_CLIENT_ID <application-client-id>'
        Write-Warning '    azd provision'
        exit 0
    }
}
else {
    Write-Host "  using existing app registration $clientId"
    az ad app update --id $clientId --web-redirect-uris $redirectUri 2>$null | Out-Null
}

# Configure built-in authentication through ARM directly. `az containerapp auth` lives in an
# extension that may not be installed, so this uses core CLI only.
$authSettings = @{
    properties = @{
        platform          = @{ enabled = $true }
        globalValidation  = @{
            unauthenticatedClientAction = 'RedirectToLoginPage'
            redirectToProvider          = 'azureactivedirectory'
        }
        identityProviders = @{
            azureActiveDirectory = @{
                enabled      = $true
                registration = @{
                    clientId     = $clientId
                    openIdIssuer = "https://login.microsoftonline.com/$tenantId/v2.0"
                }
                validation   = @{
                    allowedAudiences = @("api://$clientId")
                }
            }
        }
        login             = @{ preserveUrlFragmentsForLogins = $false }
    }
}

$bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) "speechbridge-auth-$([guid]::NewGuid()).json"
$authSettings | ConvertTo-Json -Depth 10 | Set-Content -Path $bodyFile -Encoding utf8

$uri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroup" +
       "/providers/Microsoft.App/containerApps/$siteName/authConfigs/current?api-version=2024-03-01"

& az rest --method put --uri $uri --body "@$bodyFile" --headers "Content-Type=application/json" 2>&1 | Out-Null
$authExit = $LASTEXITCODE
Remove-Item $bodyFile -ErrorAction SilentlyContinue

# Check the exit code, not just exceptions: `az` reports failures on stderr without
# throwing, so trusting a try/catch here would print success over a failed call.
if ($authExit -eq 0) {
    Write-Host '  built-in authentication enabled'
    Write-Host ''
    Write-Host "SpeechBridge is ready: $siteUri"
    Write-Host 'Only signed-in users from your Microsoft Entra tenant can open it.'
    Write-Host ''
}
else {
    Write-Warning 'Could not enable built-in authentication.'
    Write-Warning 'The site stays fail-closed: it will not mint Speech credentials until this succeeds.'
    Write-Warning "Retry with:  pwsh ./scripts/postprovision.ps1"
}
