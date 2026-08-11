// Grants the data-plane role the token broker needs on the AI Services account.
//
// This is what replaces the API key. Without it the app authenticates to Microsoft Entra
// successfully and is then refused by the data plane with
// `PermissionDenied - Principal does not have access to API/Operation`, which reads like a
// broken endpoint rather than a missing role.
//
// Cognitive Services User rather than Cognitive Services Speech User (ADR-0012): the broker
// calls /sts/v1.0/issueToken, and Speech User's data actions all sit beneath
// accounts/SpeechServices/... - none of them authorise the STS endpoint.

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

// Built-in role: Cognitive Services User (dataActions: Microsoft.CognitiveServices/*).
// Verified against the live tenant with `az role definition list`.
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiServicesName
}

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Deterministic name so redeploying is idempotent rather than a conflict.
  name: guid(account.id, principalId, cognitiveServicesUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesUserRoleId
    )
    principalId: principalId
    principalType: principalType
  }
}

output id string = assignment.id


