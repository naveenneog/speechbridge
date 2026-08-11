<#
    Invite people from another organisation to use this deployment.

        npm run invite -- alice@microsoft.com bob@microsoft.com
        npm run invite -- --file people.txt
        npm run invite -- --notify alice@microsoft.com   # also send the Entra email

    Why this exists: the app registration is single-tenant, so Entra refuses anyone whose
    account lives elsewhere — the sign-in page says the account "does not exist in tenant …
    and needs to be added as an external user first". Many tenants also forbid multi-tenant
    registrations outright by application-management policy, so making the app multi-tenant
    is not an option you can rely on. Inviting people as B2B guests is the supported path,
    and it keeps access on a named list rather than "any work account anywhere".

    Requires `az login` and permission to invite guests (Guest Inviter, or User
    Administrator / Global Administrator).
#>

$ErrorActionPreference = 'Continue'

$emails = @()
$notify = $false

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        '--notify' { $notify = $true }
        '--file' {
            $i++
            $path = $args[$i]
            if (-not (Test-Path $path)) {
                Write-Error "No such file: $path"
                exit 2
            }
            $emails += Get-Content $path | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
        }
        default { $emails += $args[$i] }
    }
}

if ($emails.Count -eq 0) {
    Write-Host 'Usage: npm run invite -- <email> [<email> ...] [--file list.txt] [--notify]'
    exit 0
}

# Send people straight to the app; redeeming the invitation and landing on the site is one
# step rather than two.
$siteUri = $null
try {
    foreach ($line in @(& azd env get-values 2>$null)) {
        if ($line -match '^\s*SERVICE_WEB_URI\s*=\s*"?([^"]*)"?\s*$') { $siteUri = $Matches[1] }
    }
}
catch { }
if ([string]::IsNullOrWhiteSpace($siteUri)) { $siteUri = 'https://myapps.microsoft.com' }

Write-Host "Inviting $($emails.Count) guest(s), redirecting to $siteUri"
Write-Host ''

$failed = 0
foreach ($email in $emails) {
    $payload = @{
        invitedUserEmailAddress = $email
        inviteRedirectUrl       = $siteUri
        sendInvitationMessage   = $notify
    } | ConvertTo-Json

    $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) "invite-$([guid]::NewGuid()).json"
    $payload | Set-Content -Path $bodyFile -Encoding utf8

    $result = & az rest --method post --uri 'https://graph.microsoft.com/v1.0/invitations' `
        --body "@$bodyFile" --headers 'Content-Type=application/json' `
        --query '{status:status,redeem:inviteRedeemUrl}' -o json 2>&1
    $exit = $LASTEXITCODE
    Remove-Item $bodyFile -ErrorAction SilentlyContinue

    if ($exit -eq 0) {
        Write-Host "  invited  $email"
        if (-not $notify) {
            Write-Host "           (no email sent — share the site link, or re-run with --notify)"
        }
    }
    else {
        $failed++
        Write-Warning "  FAILED   $email"
        Write-Warning "           $result"
    }
}

Write-Host ''
if ($failed -gt 0) {
    Write-Warning "$failed invitation(s) failed. You need permission to invite guests"
    Write-Warning 'in this tenant (Guest Inviter, User Administrator, or Global Administrator).'
    exit 1
}

Write-Host 'Done. Invited users can now sign in with their own work account.'
Write-Host "Site: $siteUri"
