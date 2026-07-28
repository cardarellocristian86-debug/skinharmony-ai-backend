# Resource visibility scope v0.16

Branch exposure applies to stored and replayed results as well as to registry
discovery. A tenant match alone is not sufficient when ChatGPT and adjacent
software share a tenant.

## Canonical record binding

Every record that can contain a branch ID, domain-pack context, work content,
agent output, evidence, memory, trace, task, artifact or review must receive a
server-derived `resource_visibility_v1` binding:

```json
{
  "exposure_class": "chatgpt_horizontal",
  "origin_client_type": "chatgpt",
  "origin_audience": "chatgpt_connector",
  "allowed_client_types": ["chatgpt", "codex", "api_agent", "admin"],
  "allowed_audiences": [
    "chatgpt_connector",
    "codex_internal",
    "api_agent",
    "admin_control_room"
  ],
  "branch_ids": ["ai_evaluation_intelligence"],
  "domain_pack_id": "generic",
  "policy_snapshot": "sha256:...",
  "visibility_digest": "sha256:...",
  "created_at": "..."
}
```

The caller cannot supply, broaden or replace this binding. Core derives it from
the authenticated key/preset or the verified short-lived MCP client assertion.
Client and audience must be a canonical pair.

## Read rule

A record is readable only when all of the following are true:

1. tenant matches;
2. the visibility binding is complete and its digest is valid;
3. client and audience are a canonical pair;
4. both client and audience are allowed;
5. every bound branch is visible to the authenticated context;
6. required entitlements are present.

ChatGPT additionally requires `exposure_class=chatgpt_horizontal`. The
`owner_root` role and the `admin:tenant` scope do not bypass this rule. Admin
visibility requires the explicit server-side Admin Control Room preset or a
verified admin client assertion.

Legacy or unclassified records are hidden from ChatGPT and adjacent software.
They may be inspected only through the explicit Admin Control Room path for
migration or incident review.

## Response projection

- Never return server-known hidden IDs as `denied_branches`.
- Return only caller-requested denied identifiers, or a count and bounded error.
- ChatGPT receives a generic/horizontal domain-pack projection with no vertical
  IDs, even when the backend service key is bound to a wider pack.
- Search, list, replay and recent-record endpoints apply the same visibility
  predicate before pagination. Filtering after pagination is insufficient.
- Free-text fields from non-visible records are never returned and are not
  replaced by a superficial branch-name redaction.

## Incremental rollout

A persisted capability that has not implemented and tested
`resource_visibility_v1` is classified `codex_internal` or unavailable to
ChatGPT. It cannot remain `chatgpt_horizontal` merely because its tool name is
generic.

Required end-to-end tests seed horizontal, adjacent, admin and legacy records,
invoke every ChatGPT-visible read surface with an authenticated ChatGPT
`owner_root` identity, serialize the complete response and assert that no
vertical ID, label, domain pack or record content is present.
