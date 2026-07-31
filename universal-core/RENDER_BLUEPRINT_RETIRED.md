# Legacy Render Blueprint retired

`universal-core/render.yaml` was intentionally removed. It previously
declared the same production Render service (`skinharmony-universal-core`) as
the governed JavaScript service and could make the last Blueprint sync win.

The only authoritative production Blueprint is
[`../../render-universal-core.yaml`](../../render-universal-core.yaml). It
deploys `services/universal-core-service`, contains the host-native governance
configuration, and is paired with `render-core-mcp.yaml` through explicit
`fromService` bindings.

The material under `universal-core/` remains historical/research source. It
must not be attached to the production Render service or reintroduced as a
second Blueprint. Any future standalone experiment needs a distinct,
non-production Render service name and an explicit tenant-scoped review.
