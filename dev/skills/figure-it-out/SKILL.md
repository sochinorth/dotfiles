---
name: figure-it-out
description: "Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or an empirical investigation of a system you don't fully control. Scales rigor to the stakes, runs a hypothesis loop under real controls, and leaves a trail a human can audit after stepping away. Use for /figure-it-out or 'figure it out'."
disable-model-invocation: true
---

# Figure it out

When the task matches no narrower playbook, design one. The deliverable before any work is the workflow itself: phases that scale rigor to the stakes, run the scientific method under controls, and leave a trail someone can audit after stepping away. You run it as the root agent (the **root-agent** skill): orchestrate, don't do the legwork yourself.

## Phase A: Frame

Ground first, then commit. Don't start the run until you can state:

- The definition of done as a falsifiable predicate (the **prove-it-works** principle skill): the observation that would settle it, not "it works".
- Scope, quantified: rough units and effort, plus the blockers grounding surfaced.
- The rigor level, biased high. One-way doors and irreversible cost get more; reversible low-stakes steps get less. Rigor is gates, controls, and provenance, not "try harder". On a system you don't control, name the resources a run can burn (a cooldown, a quarantine, a rate limit) and treat spending one as irreversible.

Present the framing before a long run. Reversible work proceeds (the **never-block-on-human** principle skill); an irreversible step or a multi-hour run earns one checkpoint.

## Phase B: Design the workflow

Decompose into atomic units that each end in a check: a change that can land on its own, or a probe that ends in an observation. Sequence riskiest-unknown-first. Scaffold and verification come before features (the **foundational-thinking** principle skill).

- Build the check before the work and capture a baseline first, so each result reads as "old value vs new value" for a change, or "control vs treatment" for a probe.
- **In a probe, vary one factor per comparison, against a same-condition control.** A result with provider, endpoint, timing, and payload all moving at once identifies nothing. Hold everything but the one factor, and record enough provenance per attempt to rerun it exactly.
- For a one-way-door design decision, run the **architect** skill (it runs **arena**). For a fork in a theory, run **steelman**. Skip both where the shape is already concrete (the **laziness-protocol** principle skill).
- Decide what fans out. Parallelize only across seams that share no state (the **separate-before-serializing-shared-state** principle skill); dispatch facts to the **research** skill. Don't run two treatments that contend for the same irreversible resource at once.
- Write the designed phases down where the trail lives. That list is what the human reviews.

Then execute the design. Run each step under the Phase C loop, and add to the Phase D trail as each step lands rather than saving it for the end.

## Phase C: Run the loop

Each unit is an experiment. **Write the prediction before the run**, make the smallest change or probe, and measure against the predicate on the real artifact. Keep a change that advanced the predicate and revert one that didn't. Record a probe's result whichever way it came out. Finish each unit's check before starting the next (the **sequence-verifiable-units** principle skill).

- Verify by inspecting the artifact, never a self-report. When something passes too easily, suspect the measurement before the system.
- Have a partner judge delegated work when later units depend on it (the **sparring** skill). If a worker games the gate, reset and harden the contract. If the gate itself is wrong, fix the gate in its own change rather than routing around it.
- A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass, and a confound makes a result inconclusive however it came out. Don't hide a negative.

## Phase D: Keep the trail

The trail is workflow state: a task directory in the project scratchpad, not a repo file. Keep it lean (the way a `predictions.md` precedes `results.md`, and a `queue.md` holds unverified leads that die when they close). A fact that outlives the task graduates into the project; the churn stays behind and is deleted with the task.

## Phase E: Verify and hand back

Check the whole against the Phase A predicate on the real artifact, not just the harness. Before you trust a result, get the verdict from an agent that didn't produce it, on the other model family (the **interrogate** or **sparring** skill): whoever did the work doesn't grade it. Encode any recurring correction as a check or a script, not another line of instruction (the **encode-lessons-in-structure** principle skill).

**Reply:** the playbook you designed, the rigor level and why, the trail's path, what's verified against the predicate, and what's still open.

Adapted from `figure-it-out` in [pstack](https://github.com/cursor/plugins/tree/main/pstack).
