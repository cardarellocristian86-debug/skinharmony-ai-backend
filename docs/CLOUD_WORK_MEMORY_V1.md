# Cloud Work Memory v1

The MCP uses PostgreSQL as the primary persistent store when `DATABASE_URL` is configured. Every row is keyed by the authenticated `tenant_id`; callers cannot provide or override the tenant.

`memory_document_upsert` is a governed, idempotent write tool. It derives a stable document id from tenant and source path, verifies SHA-256, redacts credentials again on the server and never stores raw Codex databases, Keychain entries or `.env` files. Existing `search` and `fetch` remain compatible and prefer PostgreSQL, then validated research and packaged read-only memory.

The local sync command is:

```sh
npm run memory:cloud:sync -- /Users/cristiancardarello/skinharmony-codex/SHARED_MEMORY
```

It syncs only curated text folders, keeps a local checksum manifest under `~/.skinharmony/cloud-memory-sync`, and queues failed writes for retry. Code remains protected by Git/GitHub; large build artifacts remain on the external disk. Local files must be removed only after the cloud status and checksum manifest confirm the upload.

Production requirements:

- configure `DATABASE_URL` on the Render MCP service;
- keep `DATABASE_SSL=true` for an external PostgreSQL URL;
- deploy and verify `/healthz` reports `cloud_memory.persistent=true`;
- run the initial sync, restart the service, then verify `memory_cloud_status`, `search` and `fetch`.
