---
name: azure-rbac
description: "Helps users find the right Azure RBAC role for an identity with least privilege access, then generate CLI commands and Bicep code to assign it. Also provides guidance on permissions required to grant roles. WHEN: bicep for role assignment, what role should I assign, least privilege role, RBAC role for, role to read blobs, role for managed identity, custom role definition, assign role to identity, what role do I need to grant access, permissions to assign roles."
license: MIT
metadata:
  author: Microsoft
  version: "1.1.1"
---

# Azure RBAC Skill

Use the `azure__documentation` tool to find the minimal role definition that matches the desired permissions the user wants to assign to an identity. If no built-in role matches the desired permissions, use the `azure__extension_cli_generate` tool to create a custom role definition with the desired permissions. Then use the `azure__extension_cli_generate` tool to generate the CLI commands needed to assign that role to the identity. Finally, use the `azure__bicepschema` and `azure__get_azure_bestpractices` tools to provide a Bicep code snippet for adding the role assignment.

If the user is asking about the role necessary to set access, refer to Prerequisites for Granting Roles below.

## Prerequisites for Granting Roles

To assign RBAC roles to identities, you need a role that includes the `Microsoft.Authorization/roleAssignments/write` permission. The most common roles with this permission are:

- **User Access Administrator** — least privilege, recommended for role assignment only
- **Owner** — full access including role assignment
- **Custom Role** with `Microsoft.Authorization/roleAssignments/write`

## Workflow

1. **Identify the desired permissions** — ask the user what the identity needs to do (e.g., "read blobs", "deploy to App Service", "manage Key Vault secrets")
2. **Find the minimal built-in role** — use `azure__documentation` to search for built-in roles matching those permissions; prefer least-privilege
3. **If no built-in role fits** — use `azure__extension_cli_generate` to define a custom role with only the needed actions
4. **Generate CLI assignment** — use `azure__extension_cli_generate` to produce the `az role assignment create` command
5. **Generate Bicep** — use `azure__bicepschema` + `azure__get_azure_bestpractices` to produce a `Microsoft.Authorization/roleAssignments` resource block

## Common Role Assignments (reference)

| Scenario | Built-in Role | Role Definition ID |
|----------|---------------|-------------------|
| Read blobs | Storage Blob Data Reader | `2a2b9908-6ea1-4ae2-8e65-a410df84e7d1` |
| Write blobs | Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` |
| Read Key Vault secrets | Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` |
| Manage Key Vault | Key Vault Administrator | `00482a5a-887f-4fb3-b363-3b7fe8e74483` |
| Deploy to App Service | Website Contributor | `de139f84-1756-47ae-9be6-808fbbe84772` |
| Read all resources | Reader | `acdd72a7-3385-48ef-bd42-f606fba81ae7` |
| Full access (avoid) | Owner | `8e3af657-a8ff-443c-a75c-2fe8c4bcb635` |

## Bicep Template Pattern

```bicep
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, roleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal' // or 'User', 'Group'
  }
}
```

## Azure CLI Pattern

```bash
az role assignment create \
  --assignee <principal-id-or-upn> \
  --role "<role-name-or-id>" \
  --scope "/subscriptions/<sub-id>/resourceGroups/<rg-name>"
```

> **Note:** This skill requires the `azure__documentation`, `azure__extension_cli_generate`, `azure__bicepschema`, and `azure__get_azure_bestpractices` MCP tools to be installed and connected.
