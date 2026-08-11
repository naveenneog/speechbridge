#!/bin/sh
# SpeechBridge — postprovision hook (macOS / Linux)
#
# Creates a Microsoft Entra app registration and switches on App Service built-in
# authentication, so `azd up` produces a site only your organisation can open.
#
# Why this runs as a hook rather than in Bicep: the redirect URI has to contain the site's
# hostname, which does not exist until the site is provisioned.
#
# If the deploying account lacks app-registration rights, this fails loudly but harmlessly
# — the app runs with ACCESS_MODE=authenticated, so it refuses to mint Speech credentials
# for an unauthenticated caller. It fails closed, not open.

set -e

azd_env() { azd env get-value "$1" 2>/dev/null || true; }

SUBSCRIPTION_ID=$(azd_env AZURE_SUBSCRIPTION_ID)
RESOURCE_GROUP=$(azd_env AZURE_RESOURCE_GROUP)
SITE_NAME=$(azd_env SERVICE_WEB_NAME)
SITE_URI=$(azd_env SERVICE_WEB_URI)
TENANT_ID=$(azd_env AZURE_TENANT_ID)
ENV_NAME=$(azd_env AZURE_ENV_NAME)
CLIENT_ID=$(azd_env AUTH_CLIENT_ID)
ALLOWED_TENANTS=$(azd_env ALLOWED_TENANT_IDS)

# A registration limited to one organisation cannot admit users from another, however the
# app is configured. Multi-tenant is required the moment an allowlist names a second tenant
# — and the app's ALLOWED_TENANT_IDS is what stops that meaning "everyone".
if [ -n "$ALLOWED_TENANTS" ]; then
  SIGN_IN_AUDIENCE="AzureADMultipleOrgs"
  ISSUER="https://login.microsoftonline.com/organizations/v2.0"
else
  SIGN_IN_AUDIENCE="AzureADMyOrg"
  ISSUER="https://login.microsoftonline.com/${TENANT_ID}/v2.0"
fi

if [ -z "$SITE_NAME" ] || [ -z "$RESOURCE_GROUP" ]; then
  echo "postprovision: no web app in this environment yet; nothing to configure."
  exit 0
fi

echo ""
echo "Configuring Microsoft Entra authentication for the site..."

REDIRECT_URI="${SITE_URI}/.auth/login/aad/callback"

if [ -z "$CLIENT_ID" ]; then
  echo "  creating app registration for ${SITE_URI}"
  CLIENT_ID=$(az ad app create \
    --display-name "SpeechBridge (${ENV_NAME})" \
    --sign-in-audience "$SIGN_IN_AUDIENCE" \
    --web-redirect-uris "$REDIRECT_URI" \
    --enable-id-token-issuance true \
    --query appId -o tsv 2>/dev/null || true)

  if [ -z "$CLIENT_ID" ]; then
    echo ""
    echo "WARNING: Could not create the Microsoft Entra app registration."
    echo "This usually means your account lacks application-registration rights."
    echo ""
    echo "The site is deployed but will REFUSE to work until authentication is set up,"
    echo "because it will not mint Azure Speech credentials for an unauthenticated caller."
    echo "That is deliberate: it fails closed rather than exposing your subscription."
    echo ""
    echo "To finish, ask an administrator to create an app registration with redirect URI:"
    echo "    ${REDIRECT_URI}"
    echo "then run:"
    echo "    azd env set AUTH_CLIENT_ID <application-client-id>"
    echo "    azd provision"
    exit 0
  fi

  # The service principal is what actually appears in the tenant and grants sign-in.
  az ad sp create --id "$CLIENT_ID" >/dev/null 2>&1 || true
  azd env set AUTH_CLIENT_ID "$CLIENT_ID" >/dev/null
  echo "  created app registration ${CLIENT_ID}"
else
  echo "  using existing app registration ${CLIENT_ID}"
  az ad app update --id "$CLIENT_ID" --web-redirect-uris "$REDIRECT_URI" >/dev/null 2>&1 || true
  az ad app update --id "$CLIENT_ID" --sign-in-audience "$SIGN_IN_AUDIENCE" >/dev/null 2>&1 || true
fi

# Configure built-in authentication through ARM directly. `az containerapp auth` lives in an
# extension that may not be installed, so this uses core CLI only.
BODY_FILE=$(mktemp)
cat > "$BODY_FILE" <<JSON
{
  "properties": {
    "platform": { "enabled": true },
    "globalValidation": {
      "unauthenticatedClientAction": "RedirectToLoginPage",
      "redirectToProvider": "azureactivedirectory"
    },
    "identityProviders": {
      "azureActiveDirectory": {
        "enabled": true,
        "registration": {
          "clientId": "${CLIENT_ID}",
          "openIdIssuer": "${ISSUER}"
        },
        "validation": {
          "allowedAudiences": ["api://${CLIENT_ID}"]
        }
      }
    },
    "login": { "preserveUrlFragmentsForLogins": false }
  }
}
JSON

URI="https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.App/containerApps/${SITE_NAME}/authConfigs/current?api-version=2024-03-01"

if az rest --method put --uri "$URI" --body "@${BODY_FILE}" --headers "Content-Type=application/json" >/dev/null; then
  echo "  built-in authentication enabled"
  echo ""
  echo "SpeechBridge is ready: ${SITE_URI}"
  echo "Only signed-in users from your Microsoft Entra tenant can open it."
  echo ""
else
  echo "WARNING: Could not enable built-in authentication."
  echo "The site stays fail-closed and will not mint credentials until this succeeds."
fi

rm -f "$BODY_FILE"


