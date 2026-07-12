# Tenant Owner Approvals

The approval service is a security boundary, not a UI boolean. Authentication middleware must derive `subject`, `tenant_id`, `role`, and authentication method from a verified IdP token. Client input must never supply or override those fields.

## Lifecycle

1. An owner or operator creates a request containing tenant, action, payload and plan.
2. The service canonicalizes and hashes the payload, then stores an immutable request and audit event.
3. Eligible approvers approve. Enterprise requires two distinct approvers using SSO or passkey.
4. Quorum creates a signed, opaque `owner_confirmation_id` and token scoped to tenant, action, request and payload hash.
5. The execution gateway atomically consumes the token once. Reuse, expiry, revocation, payload substitution and cross-tenant use fail closed.

## API

Mount `approvalRouter` behind verified Auth0/SSO authentication:

```text
GET  /approval/requests
POST /approval/requests
POST /approval/requests/:id/approve
POST /approval/requests/:id/revoke
POST /approval/confirmations/consume
GET  /approval/audit
```

## Plans

- Basic: one owner approval.
- Pro: owner or delegated approver, audit export.
- Enterprise: two distinct strong-auth approvers, SSO required, audit export.

## Production requirements

Replace `MemoryApprovalStore` with a transactional persistent adapter enforcing unique consumption of `jti`. Keep signing keys in a KMS/HSM, support `kid` rotation, encrypt records at rest, apply retention policies, rate limits, CSRF protection for browser sessions, webhook signatures, append-only audit export, and tenant-aware observability. Never log tokens, authorization headers or raw sensitive payloads.
