---
name: research
description: "Investigate a question against primary sources and capture the findings as a Markdown memo in the project scratchpad. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a subagent."
---

Spin up a subagent with a fresh context window to do the research, so you keep working while it reads. Fan out several on distinct questions when the work splits cleanly.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it: a confident memo is still a claim until its own source is read.
2. Write the findings to a single Markdown memo. Cite each claim's source inline, label it with your confidence, and name what would overturn it. Mark anything you could not trace to a primary source as a guess.
3. Save it in the project scratchpad's task directory, and give the user its full path. It is workflow state, not a repo file; a fact that outlives the task graduates into the project later.

Adapted from `research` in [mattpocock/skills](https://github.com/mattpocock/skills).
