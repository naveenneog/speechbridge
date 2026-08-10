// User-assigned managed identity for the web app.
//
// User-assigned rather than system-assigned so the role assignment can be created in the
// same deployment: the principal ID exists before the app that uses it, which avoids the
// chicken-and-egg problem that makes system-assigned identities need a second pass.

param name string
param location string
param tags object = {}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

output id string = identity.id
output name string = identity.name
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId

