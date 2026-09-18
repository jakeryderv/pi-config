---
name: diagnose-root
description: Investigate a confirmed bug with an unclear cause by reproducing it, isolating the failure, ranking hypotheses, and running falsification checks. Use for root-cause analysis, recurring failures, or bugs that resist an obvious fix; not for straightforward edits with an already established cause.
license: MIT (see LICENSE)
---

# Diagnose Root

Find an evidence-supported explanation before prescribing a fix. Do not mistake
a plausible story, a warning near the failure, or a passing retry for causation.

## Procedure

1. **Reproduce.** Establish expected versus observed behavior, the affected version
   and environment, and minimal triggering inputs. Inspect existing reports,
   relevant session history, logs, and tests before asking the user to repeat
   available information. Record the exact command or steps and their outcome.
2. **Isolate.** Trace the failing path using file search and Lens navigation where
   available. Compare a working case with the failing case and inspect recent
   changes. Narrow variables one at a time. Prefer read-only inspection and
   isolated fixtures; do not change the user's branch or worktree to investigate.
3. **Hypothesize.** List a small number of ranked explanations. For each, state
   supporting evidence, contrary evidence, and a check that could disprove it.
   Choose the most discriminating low-risk check, not merely one likely to pass.
4. **Test.** Run the checks and update the hypotheses from the results. Distinguish
   the triggering condition, underlying defect, and contributing factors; there
   may be more than one cause. Use controls or repeated runs for flaky behavior.
5. **Conclude.** Report the causal chain, evidence, remaining uncertainty, and the
   smallest proposed correction. Suggest a regression test that fails before
   the correction and passes afterward, plus nearby boundary cases.

## Boundaries

- If reproduction or access is blocked, say so. Report the best-supported
  hypothesis and the next discriminating check; do not manufacture certainty or
  keep investigating indefinitely without useful new evidence.
- Diagnosis alone does not authorize a fix. If fixing is already within the user's
  request, proceed only within that scope; otherwise present the proposed fix.
- Avoid destructive commands, production mutations, installs, and broad temporary
  instrumentation without approval. Get approval for repository changes needed
  solely to diagnose when they are outside the original request.
- Run long tests with the available background-command tool. Do not start agents
  or multi-model reviews unless the user explicitly authorizes delegation.
- Preserve unrelated changes. Do not automatically commit, create branches, or
  generate a bug registry. Keep findings in chat unless an artifact is requested.

## Output and Verification

Summarize: symptom → reproduction → evidence for/against hypotheses → likely or
confirmed cause → proposed fix → regression check. Include source locations and
exact check outcomes. Clearly distinguish executed checks from suggested ones.
If a fix is implemented under existing authorization, rerun the original failing
case and relevant regression tests before claiming resolution.

## Attribution

Adapted from bigpowers' [diagnose-root](https://github.com/danielvm-git/bigpowers/blob/e62dd02df1a87dd5afac96d9f4898e480e64c62d/skills/diagnose-root/SKILL.md).
This standalone adaptation removes mandatory bug files and lifecycle handoffs.
The upstream MIT notice is preserved in [LICENSE](LICENSE).
