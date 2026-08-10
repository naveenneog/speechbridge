// Grants Cognitive Services Speech User on the AI Services account.
//
// This is what replaces the API key. Without it the app authenticates successfully to
// Microsoft Entra and is then refused by the data plane, which surfaces as a 401 on the
// token exchange rather than anything obviously permission-shaped.

@description('Object ID of the principal to grant access to.')
param principalId string

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param principalType string

@description('Name of the AI Services account to scope the assignment to.')
param aiServicesName string

// Built-in role: Cognitive Services Speech User.
// Verified against the live tenant with `az role definition list`.
var speechUserRoleId = 'f2dc8367-1007-4938-bd23-fe263f013447'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiServicesName
}

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Deterministic name so redeploying is idempotent rather than a conflict.
  name: guid(account.id, principalId, speechUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      speechUserRoleId
    )
    principalId: principalId
    principalType: principalType
  }
}

output id string = assignment.id

