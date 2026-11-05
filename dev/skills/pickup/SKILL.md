---
name: pickup
description: "Take over work from an earlier session, from its handoff note or transcript, without redoing it or trusting it blindly."
disable-model-invocation: true
---

# Pickup

You own the resume point.

## Find the trail

Look for `handoff.md` under the project scratchpad, or use the path the user gives. With several, take the one matching the user's request, or ask. Without a note, ask which session to read: `opencode session list` names them, and a session's scratchpad holds its log under `transcripts/<sessionID>/`.

## Read it two ways

- **Decisions** (what was chosen, what the user wanted, what was ruled out): trust these. Don't re-open them unless new evidence demands it.
- **Claims** (what works, what's done, what's true of the code): check these against the live repo: branch, `git log`, `git diff`, and the check that proves each one. A claim in a note is a report, not proof.

Skip re-running work whose result you can confirm more cheaply.

## Take over

Say where the earlier session stopped, what held up and what didn't, and your resume point. Then carry on, loading any skills the note suggests.

Once you've taken over, delete the note. What matters from it now lives in this session.

Adapted from `session-pickup` in [pstack](https://github.com/cursor/plugins/tree/main/pstack).
