# GitHub App tenant onboarding

## Purpose

This runbook connects a customer's selected GitHub repositories to Nyra and
Universal Core without granting the customer access to the proprietary Core
repository, Render account, GitHub App private key or another tenant.

The trust path is horizontal:

`customer AI -> authenticated MCP tenant -> Universal Core -> one-use ticket -> GitHub worker -> customer repository`

The AI requests work. Universal Core authorizes the exact effect. The GitHub
worker is the only component that holds the App credential and performs the
provider operation.

## Non-negotiable isolation rules

- Never give a customer the GitHub App private key or a generated installation
  token.
- Never place either credential in chat, an MCP argument, a repository, a log,
  a Work record or a Core receipt.
- Never reuse the owner's installation id for a customer tenant.
- Bind one authenticated tenant to explicit installation and repository ids on
  the server. Caller-supplied tenant, installation or repository authority is
  invalid.
- A customer installation may operate only on repositories selected by that
  customer. It does not provide account-wide GitHub access.
- The proprietary `cardarellocristian86-debug/skinharmony-ai-backend`
  installation remains owner-only and cannot be selected by customer tenants.
- GitHub access does not bypass Work Identity, persisted Intent, DTT/session
  binding, Core policy, branch protection, required checks or independent
  approval.
- Revocation, tenant mismatch, repository drift, missing credentials or an
  unavailable Core must fail closed.

## Customer onboarding

1. Send the customer the GitHub App installation URL, never a credential.
2. The customer signs in to GitHub and chooses their account or organization.
3. The customer selects **Only select repositories** and chooses the minimum
   repository set needed for the service.
4. Record the installation id returned by GitHub through an authenticated
   administrator flow.
5. Verify from GitHub that the installation owner and exact repository ids
   match the intended customer.
6. Create a server-side binding containing the authenticated `tenant_id`, App
   installation id and exact repository allowlist. The customer cannot edit
   this binding through MCP.
7. Run negative checks for a foreign tenant, a non-selected repository, the
   proprietary Core repository, an unprotected branch and an expired or revoked
   installation.
8. Run one read-only verification, then one bounded draft-PR flow. Do not enable
   merge until required checks, independent approval and fresh protection
   readback pass.
9. Store only non-secret installation metadata in audit records. Keep the App
   private key exclusively in the protected GitHub worker environment.

## MCP and AI behavior

ChatGPT, Codex and other MCP-compatible AI clients authenticate to the tenant;
they do not authenticate directly as the GitHub App. MCP resolves the tenant
from trusted authentication and sends a request-bound Work/DTT context to Core.
No public tool schema may accept a private key, GitHub token, installation id,
provider URL or tenant override.

The same App may serve multiple customers because GitHub creates an independent
installation for each customer account or organization. Isolation is based on
the tuple `tenant + installation + repository`, not on the AI vendor or chat
session.

## Offboarding and incident response

1. Revoke the tenant binding and all active Core tickets.
2. Suspend or uninstall the customer's GitHub App installation.
3. Verify that new installation-token exchange and repository readback fail.
4. Quarantine any action with an uncertain external outcome; never retry it
   blindly.
5. Rotate the App private key only for credential compromise or scheduled key
   rotation. A customer offboarding normally requires no global key rotation.

Removing one customer installation must not interrupt the owner installation or
any other tenant installation.
