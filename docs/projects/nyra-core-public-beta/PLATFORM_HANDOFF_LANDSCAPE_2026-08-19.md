# Current Platform Landscape — Chat to Persistent Work to Operational Agent

Date: **2026-08-19**

## Executive finding

No current platform provides the complete Nyra target flow:

```text
ordinary chat
→ canonical provider-independent Work
→ Intent / ICF / architecture / files / evidence
→ selectable AI executor or reviewer
→ operational continuation
→ cross-provider handoff
→ independent Core closure
```

The closest current product for a normal user is **ChatGPT Projects + Work**. The strongest current execution bus for software is **GitHub Issues/Projects + coding agents**. Codex, Gemini CLI and Claude Code each support durable project context, but none automatically inherits the complete state of an arbitrary consumer chat as a governed Work.

## OpenAI: ChatGPT Projects + Work + Codex

### What works today

ChatGPT Projects can:

- contain related chats, files and project instructions;
- accept an existing ordinary ChatGPT chat moved into the Project;
- save selected chat responses as reusable Project sources;
- preserve Project memory across chats;
- start a Work chat from inside the Project using Project context.

Work is designed for longer multi-step work and finished deliverables. In the desktop app it can also use an authorized local folder or project.

### Important limitation

Codex remains a separate product view with separate history. It can work on a local folder, repository, terminal and developer tools, but it does not automatically inherit ChatGPT Project chats, Project sources or Work history.

Therefore:

```text
ordinary Chat → ChatGPT Project → Work
```

is currently supported as a relatively continuous flow.

But:

```text
ordinary Chat → ChatGPT Project → Codex
```

still requires an explicit bridge, such as:

- a canonical specification committed or saved in the repository/folder;
- a Work packet file;
- GitHub Issue/PR context;
- a Nyra MCP call that retrieves the authorized Work capsule.

### Project memory constraint

Current OpenAI documentation states that Work is unavailable in a Project configured with project-only memory. This creates a current trade-off between the most isolated Project memory mode and direct Work availability. Nyra should not depend on this product-specific behavior for authoritative privacy or continuity.

## GitHub Issues/Projects + coding agents

GitHub currently provides the strongest operational delegation surface for software:

- an Issue can be assigned to Copilot cloud agent;
- the agent works on the repository and opens a branch or pull request;
- third-party coding agents can also be selected where enabled;
- PR comments can request iterations;
- Linear issues can provide context to GitHub Copilot through the integration.

Limitations:

- it is task/issue-centric, not an ordinary-chat memory system;
- architecture and decisions must first be converted into repository docs or Issue content;
- it does not preserve generic Work, Intent, ICF, evidence and non-software artifacts as a single provider-independent authority;
- Issue assignment does not by itself provide Nyra-style closure.

GitHub should therefore be treated as an execution and evidence substrate, not the canonical owner of every Nyra Work.

## Gemini CLI

Gemini CLI currently provides strong local operational continuity:

- `GEMINI.md` hierarchical project context;
- durable memory files;
- saved project-specific session history;
- `/resume` session retrieval and search;
- local checkpoints that include project state and conversation state;
- MCP connectivity.

Limitations:

- continuity begins in the CLI/project directory;
- it does not automatically inherit a normal Gemini consumer-chat project as an executable Work;
- its memory and checkpoints remain provider-specific and are not a universal closure authority.

Gemini CLI is a strong candidate for the first Nyra manual multi-provider pilot because it can load a Nyra-generated Work capsule and connect to a remote Nyra MCP.

## Claude Projects + Claude Code

Claude Projects can keep chat history and project knowledge, including selected GitHub content. Claude Code can use repository memory files such as `CLAUDE.md` and operate on code through local or GitHub workflows.

Limitations:

- consumer Project context and Claude Code operational context are not a universal canonical Work;
- handoff generally depends on synchronized repository files, project instructions or a generated task packet;
- cross-provider evidence, leases and closure remain external concerns.

## Canonical Nyra conclusion

Nyra must integrate with current platform strengths without becoming subordinate to any of them:

```text
ChatGPT Project / Claude Project / Gemini chat
= human conversation and ideation surface

ChatGPT Work
= long multi-step deliverable agent

Codex / Gemini CLI / Claude Code / Copilot agents
= operational executors and reviewers

GitHub
= software source, branch, PR, CI and evidence substrate

Nyra Core
= canonical Work, Intent, ICF, task graph, files, leases,
  continuity capsule, provider handoff, evidence and closure authority
```

## Recommended immediate user workflow before Nyra bridge is complete

### For Work

```text
1. Create a ChatGPT Project named “Nyra Core — Public Beta”.
2. Move the relevant ordinary chat into the Project.
3. Save the canonical architecture/checkpoint response as a Project source.
4. Add the private continuity archive only when appropriate.
5. Start Work from inside the Project so it uses the Project context.
```

### For Codex

```text
1. Keep the canonical checkpoint in the repository or authorized local project folder.
2. Add a concise execution packet containing objective, constraints, acceptance criteria and exact next action.
3. Open the same repository/folder in Codex.
4. Instruct Codex to read the checkpoint before making changes.
5. Require tests, evidence and a bounded report back to Nyra/Core.
```

## Nyra product opportunity

The missing market capability is the explicit bridge that converts a normal conversational decision into a governed, portable and operational Work:

```text
Save to Nyra Work
→ normalize Intent and ICF
→ generate architecture and task graph
→ persist files and decisions
→ create provider-specific bounded capsule
→ launch or resume Work/Codex/Gemini/Claude
→ collect evidence
→ return to Universal Core
```

This gap is a central differentiator for the Nyra Core public beta and provider-neutral roadmap.