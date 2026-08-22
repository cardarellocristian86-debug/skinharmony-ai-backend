# Nyra Core Recovery Registry v1

This registry is consulted after an observed failure. It is not the normal
operating manual and it does not replace the Work’s next action.

| Observed state | Nyra local action | Core-guided continuation |
| --- | --- | --- |
| OAuth/connector reconnect required | Preserve Work and checkpoint; do not repeat an external action. | Reconnect once, then resume the same Work and ticket. |
| Unverified incident runbook | Reuse the exact incident fingerprint and existing evidence. | Evaluate the recorded recovery path; independently verify before reuse. |
| Current context missing or stale | Rebuild the compact local context from Intent, checkpoint, Gallery and Atlas references. | No Core/model call is needed unless policy or evidence is genuinely missing. |
| Software Atlas unavailable | Mark software context as `not_indexed`; do not scan the project automatically. | Create/select bounded software context only from a Work event and verified seed. |
| Policy, integrity or consequential action question | Keep the Work state and evidence intact. | Request the exact Universal Core decision/ticket for that bounded scope. |

Every recovery remains attached to the same tenant, project and Work. The
registry records a candidate and its evidence; it never treats an error message
as proof that a correction, release or deployment happened.
