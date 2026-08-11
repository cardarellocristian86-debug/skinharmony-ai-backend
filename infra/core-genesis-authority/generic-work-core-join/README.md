# Generic Work Core Join Genesis Signer

This stack installs the external signing authority required by Universal Core's
production `remote` signer mode. The Ed25519 private key is generated inside
AWS KMS and is non-exportable. Universal Core receives only an HTTPS endpoint,
a bearer credential reference, the logical key id, and public trust material.

It is deliberately separate from Nyra, MCP, Work Continuity, Universal Core,
and the application release path. It signs only the two domains implemented in
`src/handler.mjs`; it cannot authorize merges, deploys, secret changes, host
actions, or bootstrap release exceptions.

## Owner-only Genesis ceremony

1. Sign in to the dedicated AWS production account with an administrative role.
2. Review `template.yaml`, then deploy it with AWS SAM/CloudFormation in the
   selected production region. Supply two different principals:
   `GenesisLifecycleAdminRoleArn` for standing lifecycle operations and
   `GenesisPolicyCustodianRoleArn` for an MFA-bound break-glass policy update.
   Neither role is granted `kms:Sign`; only the Lambda signer role is. Do not
   expose the generated secret value.
3. Record the CloudFormation stack id, AWS account id, region, KMS key ARN,
   logical key id, API endpoint, template digest, and deployment event ids in
   the append-only infrastructure audit.
4. Run `npm run public-material` with temporary AWS credentials and the two
   public environment inputs. This emits only the SPKI public key and its
   fingerprint.
5. Build the canonical trust registry with exactly one active key and bind the
   same public registry to Universal Core and Core MCP.
6. An owner retrieves the generated bearer token directly from Secrets Manager
   and stores it in Render's secret configuration. Never paste it into chat,
   source control, logs, reports, or Work evidence.
7. Configure the exact sign and health URLs in the Universal Core allowlist.
8. Run the signed nonce probe. Production must remain fail-closed until the
   configured key id and fingerprint match and readiness is `true`.

## Deployment

```bash
npm ci
./scripts/validate.sh
sam build
sam deploy --guided \
  --stack-name skinharmony-production-generic-work-core-join-signer \
  --capabilities CAPABILITY_IAM
```

The stack outputs references only. It never outputs the bearer token or private
key. The KMS key, authentication secret and audit log group are retained across
stack deletion or replacement. Key decommissioning is a distinct break-glass
owner action with a 30-day pending deletion window.

The standing lifecycle role cannot modify key policy or grants. The policy
custodian can call only `kms:PutKeyPolicy`, and only in an MFA-authenticated
session. `kms:CreateGrant` is not granted by this stack. CloudTrail alerting and
the independent two-person break-glass ceremony remain deployment evidence.

Bearer rotation updates the Secrets Manager `AWSCURRENT` version first and the
Render caller secret in one governed operation. The signer reads `AWSCURRENT`
for every request, so a revoked token is not retained by a warm Lambda.

## Production bindings after deployment

Universal Core:

```text
CORE_GENERIC_WORK_CORE_JOIN_REQUIRED=true
CORE_GENERIC_WORK_CORE_JOIN_SIGNER_MODE=remote
CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_URL=<SignEndpoint>
CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_HEALTH_URL=<HealthEndpoint>
CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_ALLOWED_URLS_JSON=<exact two URLs>
CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_TOKEN=<Render secret; never report>
CORE_GENERIC_WORK_CORE_JOIN_ED25519_KEY_ID=<LogicalSignerKeyId>
CORE_GENERIC_WORK_CORE_JOIN_ED25519_TRUST_REGISTRY_JSON=<canonical public registry>
```

Core MCP receives the same public trust registry. Production must not contain
`CORE_GENERIC_WORK_CORE_JOIN_ED25519_PRIVATE_KEY`.
