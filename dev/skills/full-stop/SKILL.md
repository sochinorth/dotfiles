---
name: full-stop
description: "Take a task end to end with nobody watching: do it, prove it, get it reviewed, and stop just short of trunk."
disable-model-invocation: true
---

# Full stop

The user has left. Your updates go unread until later, so you own the work from here to a change that's ready to merge. To improve one number instead of reaching a goal, use the `hillclimb` skill.

## Before you start

Write the exit condition as something a command or a run can check: tests green, repro fixed, this output produced. Don't loosen it to declare victory. If you can't write one, that's the one thing worth asking about.

Work on a branch or in a worktree, leaving trunk and any remote alone.

## The work

Make the smallest change that meets the condition. Fix the case that happened. Verify each piece before building on it, and revert whatever a failed check refutes.

Fan out where the work splits cleanly; the `root-agent` skill covers how. Background subagents keep you going: their completion notices wake you, so while any are running you can end your turn. Ending your turn with none running ends the run.

Discoveries that serve the goal are yours to handle: flaky checks, broken tooling, related bugs in the way. A plateau means try another approach. A real dead end means stop and say so, rather than spin.

## Proof

Proof is evidence you observed in this run: command output, a reproduction, a before and after. Use the most direct kind available:

- Reproduce the original failure, apply the fix, and watch the same reproduction pass.
- Run the checks the project runs.
- Exercise real behavior, on the real thing, where a mocked test can't show it.

The project's rules about how to test still apply, including any that call for care around live systems. When a change can't be proven, it isn't done: say that in the report.

## Review

When the change holds, run the `sparring` skill in review mode on it. For a change where breakage would be costly, run `interrogate` too. Fix what's real, and re-prove anything the fixes touched.

## Deciding alone

Decide everything reversible yourself with sensible defaults, and list each decision for the report. Stop and ask only for something irreversible or outside this task: deleting data, touching production, changing things outside the repo, pushing, merging. Use a question tool if you have one, with the context and your pick, so the session shows it's waiting. If you don't, or nobody can answer, take the safe path and put the question first in your report.

## Stop

Leave the branch committed and unmerged, in the project's commit style. Report, in the `sitrep` skill's voice:

- whether the exit condition holds, and the evidence
- the branch and what's on it
- what sparring changed
- each decision you made for the user
- anything unproven, and what's left

Adapted from `full-stop` and `full-send` in [tstack](https://github.com/t3dotgg/tstack), with the exit-condition rule from pstack's Autonomous run playbook.
