---
name: grill-me
description: Stress-test a proposed design or plan through focused questions, code inspection, and documentation checks. Use when the user asks to be grilled, challenged on assumptions, or helped to resolve design tradeoffs before implementation; not for every routine coding task.
license: MIT (see LICENSE)
---

# Grill Me

Help the user reach a defensible design, not an exhaustive questionnaire. Scale
scrutiny to the cost and reversibility of the decision.

## Procedure

1. Restate the goal, constraints, and proposed approach briefly. Separate known
   facts, assumptions, decisions already made, and unresolved choices.
2. Investigate facts yourself. Use repository search and Lens navigation for code;
   use Context7 or primary documentation for API behavior. Inspect the relevant
   version rather than asking the user to confirm something discoverable.
3. Identify the few assumptions most likely to invalidate the design. Consider
   correctness, failure modes, security, operational cost, migration, and simpler
   alternatives only where relevant. Do not turn every concern into a blocker.
4. Ask about decisions that require the user's judgment. Prefer one consequential
   question at a time; group tightly coupled choices when useful. Use
   `ask_user_question` when available, with distinct options, tradeoffs, and a
   recommended choice. Otherwise ask in ordinary chat and wait.
5. For claims about external APIs, fetch the actual documentation. Cite the URL
   and relevant version; label unsupported assumptions as uncertain. If inspection
   cannot settle an important question, propose a small falsifiable experiment.
6. Update the working design as answers arrive. Explain contradictions and
   tradeoffs directly, without repeatedly reopening settled choices unless new
   evidence changes them.
7. Stop when the material decisions are resolved, the user asks to stop, or the
   remaining uncertainty is explicitly accepted. Summarize the recommended
   design, rejected alternatives, open risks, and the smallest next step.

## Boundaries

- This is a design discussion, not permission to implement. Get confirmation
  before moving into code changes or other direction-setting work.
- Do not invent requirements, demand arbitrary quality scores, or force a
  particular architecture, branching strategy, or project lifecycle.
- Default to direct investigation. Delegate only when the user explicitly
  authorizes delegation; invoking this skill alone does not authorize it.
- Keep notes in the conversation unless the user requests an artifact. Follow
  existing project conventions rather than creating a mandatory `specs/` tree.

## Verification

Before concluding, check that recommendations follow from the stated constraints,
material factual claims have evidence, and unresolved risks are visible. A useful
result may be a simpler design or a decision not to build anything.

## Attribution

Adapted from bigpowers' [grill-me](https://github.com/danielvm-git/bigpowers/blob/e62dd02df1a87dd5afac96d9f4898e480e64c62d/skills/grill-me/SKILL.md).
This standalone adaptation removes upstream lifecycle gates and tool assumptions.
The upstream MIT notice is preserved in [LICENSE](LICENSE).
