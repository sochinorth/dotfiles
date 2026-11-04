# Workflow state is not project state

Tracked files say how the project is, git history says how it got that way, and
the project scratchpad holds what's in flight. Anything that exists only because
of the task at hand is workflow state: plans, TODOs, progress logs, checklists,
test manifests, sentinels, decision or event ledgers, handoff notes.

- The test: would it still be accurate and useful to someone reading the
  project after the task is done, who never knew it happened? If not, it's
  workflow state.
- Your context names two scratchpads. Workflow state goes in the project
  scratchpad, in a directory per task (`<project scratchpad>/<task>/`): it
  outlives the session, so a later session, or another model, picks the task
  up from there. The session scratchpad is for throwaway output (intermediate
  results, scripts, downloads) and is deleted with the session. Any other
  scratchpad or temp directory named elsewhere is replaced by these two.
- Never in `docs/`, the repository root (`PLAN.md`, `TODO.md`, `NOTES.md`...),
  or any other tracked file. Code comments included: no "added in step 3",
  "per the plan", "previously this did X".
- What outlives the task goes into the project as a statement of how things
  are now: the doc it affects, a comment where the code would otherwise
  surprise, the commit message for why it changed. Not as a dated entry or a
  log.
- Keep the project scratchpad groomed: delete a file once it stops being true
  or useful. When a task is done, move what's durable into the project as
  above, then delete its directory. Leftovers from earlier work: delete them if
  that work is clearly finished, otherwise ask. Leave `ses_*` directories
  alone: they're other sessions' scratchpads.
- When a scratchpad file matters to the user, give its full path.
- An explicit request, or a record the project deliberately keeps (its ADRs,
  its changelog), overrides this.
