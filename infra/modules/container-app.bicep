// Container Apps environment, registry, and the app itself.
//
// Container Apps rather than App Service: it uses the Consumption model, so it needs no
// App Service VM quota (which many corporate subscriptions set to zero), scales to zero
// when idle, and its image is built remotely by ACR — nobody deploying this needs Docker.

param containerAppsEnvironmentName string
param containerAppName string
param containerRegistryName string
param location string
param tags object = {}

@description('Resource ID of the user-assigned managed identity.')
param managedIdentityId string

@description('Client ID of that identity, so DefaultAzureCredential picks the right one.')
param managedIdentityClientId string

@description('Principal ID of that identity, for the AcrPull role assignment.')
param managedIdentityPrincipalId string

param logAnalyticsWorkspaceId string
param speechEndpoint string
param speechRegion string
param applicationInsightsConnectionString string

@description('Container image to run. Defaults to a placeholder; azd replaces it on deploy.')
param imageName string = ''

@description('Microsoft Entra application (client) ID protecting the site. Configured by the postprovision hook.')
param authClientId string = ''

@minValue(0)
@description('Scale to zero when idle. 1 keeps a warm instance and avoids cold start.')
param minReplicas int = 0

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // The managed identity pulls with RBAC; there is no admin password to leak.
    adminUserEnabled: false
  }
}

// Built-in AcrPull. Without it the app cannot pull its own image and fails to start with
// an authentication error that does not obviously point at a missing role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, managedIdentityPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      // Always configured, even before the first image exists: azd pushes an image and
      // updates the revision, and without this the pull fails with an UNAUTHORIZED that
      // looks like a registry problem rather than a missing credential.
      registries: [
        {
          server: registry.properties.loginServer
          identity: managedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          // A placeholder keeps `azd provision` working before the first image exists;
          // `azd deploy` then swaps in the real one.
          image: empty(imageName) ? 'mcr.microsoft.com/k8se/quickstart:latest' : imageName
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'SPEECH_ENDPOINT'
              value: speechEndpoint
            }
            {
              name: 'SPEECH_REGION'
              value: speechRegion
            }
            {
              // Tells DefaultAzureCredential which identity to use.
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
            {
              // Refuse to mint credentials for anyone the platform has not authenticated.
              name: 'ACCESS_MODE'
              value: 'authenticated'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: applicationInsightsConnectionString
            }
            {
              name: 'PORT'
              value: '8080'
            }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    acrPull
  ]
}

// Only configured once a client ID exists. The postprovision hook creates the app
// registration and re-runs provisioning, so `azd up` needs no manual portal work.
resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (!empty(authClientId)) {
  name: 'current'
  parent: app
  properties: {
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          openIdIssuer: '${az.environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            'api://${authClientId}'
          ]
        }
      }
    }
    platform: {
      enabled: true
    }
  }
}

output id string = app.id
output name string = app.name
output uri string = 'https://${app.properties.configuration.ingress.fqdn}'
output fqdn string = app.properties.configuration.ingress.fqdn
output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name

