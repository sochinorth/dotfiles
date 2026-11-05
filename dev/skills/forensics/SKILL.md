---
name: forensics
description: "Find out what data says by querying it: traces, profiles, heap dumps, pcaps, logs, CSVs, databases, decompiler exports. Get it into a queryable shape before reading."
disable-model-invocation: true
---

# Forensics

You own the diagnosis from the data. The capture is a fixed dataset: read it, and leave re-running the system to other skills.

The evidence stays as it is. Open databases read-only, and transform copies, in the session scratchpad.

## 1. Get a queryable shape before you read

Identify the format and what produced it. If it's already queryable, like IDASQL or a SQLite database, query it where it is, read-only, instead of dumping it.

Otherwise load it into something you can query, usually SQLite, with one row per sample, frame, packet, event, or record: a small script does it, and you can rerun it. Check that the load kept everything: count rows against the source, and look at what failed to parse.

Parse large artifacts in a subagent, and keep the reduced findings in your own thread.

## 2. Learn the data's shape

Before asking your question, check what's there: columns, ranges, time span, nulls, duplicates, the biggest groups. A surprise here often changes the question.

## 3. Narrow with queries

Start from aggregates, then drill down. For time, find what holds the most and walk to the hot path. For a leak, follow the retention chain to its root. For a stall, find what's blocked and on what. For logs or traffic, find what changed: group by time, compare with a healthy window, and look at the first bad record, not the loudest.

## 4. Attribute it

Tie each finding to its source: file and line, function or address, host, table and row. If the data doesn't carry enough to do that, say so plainly. A hot frame with no symbol isn't a diagnosis yet.

## 5. Confirm or label

With a paired capture, compare before and after. Otherwise, call the finding the strongest hypothesis the data supports.

## Report

Give the artifact and format, the finding, its source, the queries that produced it (so they can be rerun), the scratchpad paths, and whether a paired capture confirmed it. Leave fixes for afterwards unless asked.

Extended from the Trace forensics playbook in [pstack](https://github.com/cursor/plugins/tree/main/pstack).
