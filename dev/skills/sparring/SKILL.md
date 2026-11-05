---
name: sparring
description: "Work something through with one trusted partner from another model family: you own the work, they give a second opinion."
disable-model-invocation: true
---

# Sparring

Go back and forth with one partner on whatever the user names: a change, a plan, a theory, a reading of decompiled code. You own the work and the decision. They're a second trusted opinion: take it seriously, and don't defer to it.

## Pick the partner

Use the partner the user names. Otherwise use the strongest model from the family you aren't running on: `openai/gpt-6.1-sol#high` if you're Claude, `claude-agent/opus` if you're OpenAI. Set it with the subagent tool's `model` parameter; invoking this skill is the request to do so. If the model is rejected, look up its current ID. If the other family can't run, tell the user: a same-family partner has your blind spots.

## Set the mode

Read it from the request:

- **Review:** the partner judges something finished, and returns a verdict with findings ranked `blocker` (the intended case is wrong), `should` (a real bug callers will hit), `nit` (the rest).
- **Collaborate:** an open discussion. They challenge your reasoning, propose rivals, and build on what holds up.

## First round

Run checks first and include the results, so the partner spends its attention on what checks can't see. Their brief carries:

- the subject, and how to read it (repo path, base commit, the diff command, the files)
- the intent, and what's out of scope
- what you've already checked, and what you're unsure of
- that they read and run things, and leave the files to you

Stop editing the subject while they work, so the opinion matches what you have.

## Next rounds

Resume the same partner with the subagent tool's `sessionID`, so it remembers the earlier rounds. The conversation is the record; keep it there rather than in a file.

Judge each point yourself:

- **Agree:** make the smallest change that answers it. Prefer deleting or narrowing to adding.
- **Disagree:** say why, with evidence: `file:line`, a run, an output.
- **Out of scope or a nit:** decline in a line.

Agree only because you're convinced. If a round grew the change, cut before the next one.

## Stop

Plan on about three rounds. Go further while something real is still open or the stakes justify it (security, data loss, concurrency, anything hard to undo), or when the user asks.

- **Agreed:** neither of you has a real concern left about the current state.
- **Stuck:** a point is still disputed after two exchanges. Give the user both sides in 2-3 lines each, with your pick. Running out of rounds is not agreement.

Report what the partner changed, what you declined and why, and any concern still open.

Adapted from `sol-loop` in [tstack](https://github.com/t3dotgg/tstack).
