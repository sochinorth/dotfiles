---
name: interrogate
description: "Send several adversaries, each down a different avenue, to break a change or design. Only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design, each attacking from a different direction. A finding survives only when a run proves it. Report the findings and leave the fixing for afterwards.

## Frame

The scope is what the user names. Otherwise it's the current branch's diff from its merge base with trunk, through the working tree. Say the intent in your own words, from the user's message and the commits. Ask when it's unclear, because a failure only counts against the intent.

## Pick the avenues

Read the scope and choose the avenues most likely to break this particular thing, one adversary each. Good starting points:

- inputs and edge cases
- callers, and what grep won't show: wire formats, other programs reading the same bytes, ordering
- crashes, retries, and concurrency
- the premise: the belief the whole change rests on

Two to four is usually right. Mix model families with the subagent tool's `model` parameter (`claude-agent/opus`, `openai/gpt-6.1-sol#high`); invoking this skill is the request to set it. If a model is rejected, look up its current ID, or fill the seat from the other family and say so.

## Fan out

Launch the adversaries together in the background, each a `general` subagent in its own git worktree, with the scope's uncommitted changes copied in. Follow any project rules about what may run: where live testing needs care, adversaries stick to offline checks. Each gets the scope, the intent, its avenue, and this brief:

> Break this change along your avenue, and follow anything better you find on the way. Prove each finding with a run against the real code: a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Report only what you ran; style, naming, and risks that need a future change to matter belong elsewhere. No findings is a valid result.

## Verify

Rerun each finding's command yourself. Keep a finding when the output shows the failure and the failure breaks the intent. Merge findings that share a root cause.

## Report

- **Intent:** your restatement.
- **Findings:** for each, the command, its output, how it breaks the intent, and the avenue that found it. Say "no verified findings" when none survive.
- **Dropped:** per adversary, how many findings didn't reproduce, and why.

Remove the worktrees when you're done, keeping any repro the user will need by moving it to the session scratchpad.

Rebuilt from `interrogate` in [pstack](https://github.com/cursor/plugins/tree/main/pstack).
