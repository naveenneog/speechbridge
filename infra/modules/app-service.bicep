// Linux App Service running the Node server, plus Microsoft Entra authentication.
//
// App Service rather than Container Apps deliberately: this deploys from source with no
// Docker on the developer's machine, which keeps "one click" true for people who do not
// have a container runtime installed.

param appServicePlanName string
param appServiceName string
param location string
param tags object = {}

@allowed([
  'B1'
  'B2'
  'P0v3'
  'P1v3'
])
param sku string

@description('Resource ID of the user-assigned managed identity.')
param managedIdentityId string

@description('Client ID of that identity, so DefaultAzureCredential picks the right one.')
param managedIdentityClientId string

param speechEndpoint string
param speechRegion string
param applicationInsightsConnectionString string

@description('Microsoft Entra application (client) ID protecting the site. Empty disables Easy Auth, which the postprovision hook then configures.')
param authClientId string = ''

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: appServicePlanName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: appServiceName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: sku != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      // The client talks to Azure Speech over WebSocket directly, but App Service's
      // WebSocket support costs nothing to enable and avoids a surprise later.
      webSocketsEnabled: true
      appCommandLine: 'node dist/server/index.js'
      healthCheckPath: '/api/health'
      appSettings: [
        {
          name: 'SPEECH_ENDPOINT'
          value: speechEndpoint
        }
        {
          name: 'SPEECH_REGION'
          value: speechRegion
        }
        {
          // Tells DefaultAzureCredential which identity to use when several are attached.
          name: 'AZURE_CLIENT_ID'
          value: managedIdentityClientId
        }
        {
          // Refuse to mint credentials for anyone Easy Auth has not authenticated.
          name: 'ACCESS_MODE'
          value: 'authenticated'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsightsConnectionString
        }
        {
          // Build on deploy: App Service runs npm install and npm run build for us.
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
      ]
    }
  }
}

// Only configured when a client ID is supplied. The postprovision hook creates the app
// registration and calls back to set this, so `azd up` needs no manual portal work.
resource auth 'Microsoft.Web/sites/config@2024-04-01' = if (!empty(authClientId)) {
  name: 'authsettingsV2'
  parent: site
  properties: {
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            'api://${authClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: true
      }
    }
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
  }
}

output id string = site.id
output name string = site.name
output uri string = 'https://${site.properties.defaultHostName}'
output defaultHostName string = site.properties.defaultHostName
