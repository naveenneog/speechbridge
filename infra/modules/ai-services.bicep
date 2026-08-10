// Azure AI Services account for Speech.
//
// Two settings here carry the whole security design:
//   customSubDomainName — Microsoft Entra authentication does not work on regional
//                         Cognitive Services endpoints, only on a custom subdomain.
//   disableLocalAuth    — turns off API keys entirely, so there is no key to leak.

@description('Name of the AI Services account.')
param name string

param location string
param tags object = {}

@description('Subdomain for the account. Required for Microsoft Entra authentication.')
param customSubDomainName string

@description('S0 is required: the free tier permits one concurrent recognition and caps TTS.')
@allowed([
  'S0'
])
param sku string = 'S0'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: sku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: customSubDomainName
    publicNetworkAccess: 'Enabled'
    // No keys. The app authenticates with a managed identity instead.
    disableLocalAuth: true
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

output id string = account.id
output name string = account.name
output endpoint string = account.properties.endpoint

