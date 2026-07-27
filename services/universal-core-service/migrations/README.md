# Universal Core migrations

`0.16.0-agentic-efficiency.up.sql` is additive and uses the isolated
`agentic_governance` schema on the existing governance PostgreSQL connection.
It does not create a database or a service.

`0.16.0-agentic-efficiency.down.sql` is intentionally non-destructive. Rollback
disables the feature through the release flags and records that state while
retaining usage provenance, audit, capsule checkpoints and comparison evidence.
This permits restart recovery and avoids turning a code rollback into an audit
deletion.
