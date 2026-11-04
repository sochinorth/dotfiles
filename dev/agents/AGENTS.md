# Workflow state is not project state

Tracked files say how the project is, git history says how it got that way, and
`.wip/` holds what's in flight. Anything that exists only because of the task at
hand is workflow state: plans, TODOs, progress logs, checklists, test manifests,
sentinels, decision or event ledgers, handoff notes, scratch output.

- The test: would this still be accurate and useful to someone reading the
  project after the task is done, who never knew it happened? If not, it's
  workflow state.
- Workflow state goes in `.wip/<task>/` at the repository root, one directory
  per task. `.wip/` is ignored globally; if `git check-ignore -q .wip` fails,
  add it to `.git/info/exclude`, never to a tracked `.gitignore`.
- Never in `docs/`, the repository root (`PLAN.md`, `TODO.md`, `NOTES.md`...),
  or any other tracked file. Code comments included: no "added in step 3",
  "per the plan", "previously this did X".
- What outlives the task goes into the project as a statement of how things
  are now: the doc it affects, a comment where the code would otherwise
  surprise, the commit message for why it changed. Not as a dated entry or a
  log.
- Keep `.wip/` groomed: delete a file once it stops being true or useful. When
  a task is done, move what's durable into the project as above, then delete
  its directory. Leftovers from earlier work: delete them if that work is
  clearly finished, otherwise ask.
- An explicit request, or a record the project deliberately keeps (its ADRs,
  its changelog), overrides this.
