// SpeechBridge — Azure Solution Accelerator
//
// Provisions everything the demo needs, with no API keys anywhere. Local authentication is
// disabled on the AI Services account, so the web app reaches Speech using a user-assigned
// managed identity holding the Cognitive Services Speech User role.
//
// Deployed with:  azd up
// Scope is the subscription so azd can create (or reuse) the resource group.

targetScope = 'subscription'

@minLength(1)
@maxLength(24)
@description('Name of the environment. Used to derive names for all resources.')
param environmentName string

@minLength(1)
@description('Azure region for all resources. Must support Azure AI Speech.')
@allowed([
  'eastus'
  'eastus2'
  'westus2'
  'westus3'
  'northeurope'
  'westeurope'
  'swedencentral'
  'uksouth'
  'centralindia'
  'southeastasia'
  'australiaeast'
  'japaneast'
])
param location string

@description('Object ID of the user running the deployment. Granted Speech User so the app can also be run locally against this resource. Leave empty to skip.')
param principalId string = ''

@description('Keep a warm instance (1) or scale to zero when idle (0). Zero costs less; the first request after idle pays a cold start.')
@minValue(0)
@maxValue(1)
param minReplicas int = 1

@description('Existing Microsoft Entra application (client) ID used to protect the site. Leave empty and the postprovision hook creates one.')
param authClientId string = ''

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  solution: 'speechbridge'
}

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceToken}'
  }
}

module identity './modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    location: location
    tags: tags
    name: '${abbrs.managedIdentityUserAssignedIdentities}${resourceToken}'
  }
}

module ai './modules/ai-services.bicep' = {
  name: 'ai-services'
  scope: rg
  params: {
    location: location
    tags: tags
    // The custom subdomain is not cosmetic: Microsoft Entra authentication does not work
    // on regional Cognitive Services endpoints.
    name: '${abbrs.cognitiveServicesAccounts}${resourceToken}'
    customSubDomainName: '${abbrs.cognitiveServicesAccounts}${resourceToken}'
  }
}

// The app's identity needs data-plane access. This replaces the API key entirely.
module speechRoleForApp './modules/role-assignment.bicep' = {
  name: 'speech-role-app'
  scope: rg
  params: {
    principalId: identity.outputs.principalId
    principalType: 'ServicePrincipal'
    aiServicesName: ai.outputs.name
  }
}

// The deploying human, so `npm run dev` also works locally against the same resource.
module speechRoleForUser './modules/role-assignment.bicep' = if (!empty(principalId)) {
  name: 'speech-role-user'
  scope: rg
  params: {
    principalId: principalId
    principalType: 'User'
    aiServicesName: ai.outputs.name
  }
}

module web './modules/container-app.bicep' = {
  name: 'web'
  scope: rg
  params: {
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    containerAppsEnvironmentName: '${abbrs.appManagedEnvironments}${resourceToken}'
    containerAppName: '${abbrs.appContainerApps}${resourceToken}'
    containerRegistryName: '${abbrs.containerRegistryRegistries}${resourceToken}'
    managedIdentityId: identity.outputs.id
    managedIdentityClientId: identity.outputs.clientId
    managedIdentityPrincipalId: identity.outputs.principalId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    speechEndpoint: ai.outputs.endpoint
    speechRegion: location
    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    authClientId: authClientId
    minReplicas: minReplicas
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name
output SPEECH_ENDPOINT string = ai.outputs.endpoint
output SPEECH_REGION string = location
output AZURE_AI_SERVICES_NAME string = ai.outputs.name
output SERVICE_WEB_NAME string = web.outputs.name
output SERVICE_WEB_URI string = web.outputs.uri
output AZURE_CLIENT_ID string = identity.outputs.clientId
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = web.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = web.outputs.registryName
