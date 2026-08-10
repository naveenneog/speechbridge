<#
    SpeechBridge — predown hook (Windows / PowerShell)

    Removes the Microsoft Entra app registration created during provisioning.

    `azd down` only deletes ARM resources, and an app registration is not one — so without
    this, every deploy/destroy cycle leaves another orphan in the tenant. Clean-up should be
    as complete as set-up.
#>

$ErrorActionPreference = 'Continue'

$clientId = (azd env get-value AUTH_CLIENT_ID 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($clientId)) {
    Write-Host 'predown: no app registration recorded for this environment.'
    exit 0
}

$clientId = $clientId.Trim()
Write-Host "Removing Microsoft Entra app registration $clientId ..."

az ad app delete --id $clientId 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host '  removed'
    azd env set AUTH_CLIENT_ID '' 2>$null | Out-Null
}
else {
    Write-Warning "Could not delete app registration $clientId."
    Write-Warning 'It may already be gone, or your account may lack permission. Remove it manually with:'
    Write-Warning "    az ad app delete --id $clientId"
}

exit 0
