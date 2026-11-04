# Workflow state is not project state

Tracked files say how the project is; git history says how it got that way.
What exists only because of the task at hand is workflow state: plans, TODOs,
progress notes, checklists, test manifests, decision logs, scratch output. It
goes in your session's scratchpad, not in the project.

- The test: would it still be accurate and useful to someone reading the
  project after the task is done, who never knew it happened? If not, it's
  workflow state. That rules out `PLAN.md`, `TODO.md` and the like, notes under
  `docs/`, and code comments such as "added in step 3", "per the plan",
  "previously this did X".
- The scratchpad is deleted with the session. What should outlive the task goes
  into the project as a statement of how things are now: the doc it affects, a
  comment where the code would otherwise surprise, the commit message for why it
  changed. Not as a dated entry or a log.
- When a scratchpad file matters to the user, give its full path.
- An explicit request, or a record the project deliberately keeps (its ADRs, its
  changelog), overrides this.
