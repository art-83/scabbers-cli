# Separate Development queue for tasks and epics

Status: **Done**

Implementation plan agreed during the current design discussion. This entry does not activate Jira polling, enqueue work or authorize publication. Bug Triage and Bug Fix remain intact.

## Decisions

- Add a **Development** tab and a distinct persisted queue. Reuse the existing development XState machine, processors and delivery controls rather than copying a second implementation.
- Poll Jira through controller code and the configured Jira token. The LLM receives collected evidence; it does not receive the token or perform polling.
- Use **Visão Unificada Nola**, board **28**, saved filter **10594**. Do not add an assignee or squad restriction: this is the shared board.
- The board's **To Do** column maps to status **10003 / To Do** and **1 / Open**. Status category alone would miss Open.
- Analyze related cards as a complete hierarchy, not as unrelated leaves. This is an arbitrary-depth tree, not a binary tree.
- Deliver an epic family together: **one branch per affected repository per epic**, with a common group plan, review and delivery evidence.
- An orphan Story or Task is its own delivery unit, with a branch per affected repository linked to that card. Do not manufacture an epic for it.
- Keep the current global worker limit. Three workers means at most three active worker stages across all queues, not three per tab. Native browser stages remain serialized.

## Verified Jira discovery

Read-only board configuration identified the saved filter and both To Do-column statuses. The Atlassian plugin successfully executed the query below and returned a first page with Stories, Tasks and an Ideia, with another page available. This was a query validation, not a complete backlog inventory or delivery test.

Some Stories returned by the board have Epic parents in **PNOLA**, although the board filter selects **Squads Nola**. Parent discovery therefore cannot be constrained to the board's project or its To Do statuses. Parent content is evidence and context; discovering it does not authorize editing all projects.

```jql
filter = 10594
AND status IN (10003, 1)
ORDER BY priority DESC, key ASC
```

This query reproduces the entire candidate column. The controller then distinguishes development work from bug/report/support routes; existing bug queues are not migrated or broadened. A card's presence in this query is not JEV approval or permission to implement it.

## Implementation sequence

### 1. Board-backed intake

Add board/filter selection and the resolved column-status mapping to validated settings and Config. Use Jira enhanced JQL search with complete pagination, persistent checkpoints and bounded backoff. Read the saved board filter rather than embedding a frozen copy of its project/type conditions.

Start with a read-only preview. Do not assume an initial broad scan grants permission to publish or implement every result. Surface excluded types and unsupported work instead of silently treating operational cards as features.

### 2. Complete hierarchy discovery

For each candidate, resolve its real parent chain to the relevant root, including parents outside the board/project. If the chain contains an Epic, use that Epic as the delivery owner. Otherwise keep a standalone Story/Task as its own owner; its subtasks remain part of that card's context.

Load children recursively using paginated parent queries until the family is complete. Cache already-read cards, track visited nodes and detect cycles. Maintain explicit completeness evidence. Inaccessible parents or children are blockers, not proof that a card is an orphan. Large families must be processed in resumable batches; hitting a limit must never silently discard descendants.

Read completed, active and out-of-board relatives as context. Do not reopen or overwrite already completed work. Any conflict with work already in progress requires an explicit resolution before implementation. Read dependency links as constraints without expanding traversal to every unrelated linked card.

### 3. Persist one delivery unit per epic or orphan

Persist root identity, membership, source revisions, discovery checkpoints, context, selected change scope and decisions in SQLite. Deduplicate siblings into their epic unit, and prevent both an epic and its children from starting overlapping deliveries. Use a root/member resource reservation in addition to repository/browser locks.

A new sibling or changed requirement during an active run must trigger scope revalidation; it must not silently alter a running plan. A completed delivery must not suppress later new work forever: distinguish the delivery's approved scope/version from the root's permanent identity.

### 4. Analyze the whole unit and evaluate JEV

Fetch the configured remote repository bases and pin detached analysis worktrees before technical investigation. Analyze the epic requirements and every relevant child, producing a coverage map, dependencies, acceptance criteria, repositories, bounded file plan and proposed failing checks. For large units, combine persisted partial analyses only after all required nodes are covered.

Create a separate feature/family eligibility form and JEV rubric. The current bug rubric's not-Bug gate and defect-specific prompts must not be reused for Stories or Epics. JEV evaluates one bounded delivery for the selected epic family or orphan. Keep sanitized evidence, both alternative orders, response validation and fail-closed behavior. The initial scoring threshold needs calibration with the user-selected real cards; it is not a guarantee of correctness.

Missing requirements, no-auto opt-outs, unsupported products, uncovered provider changes, conflicting active work and restricted domains remain explicit blockers or human decisions. Do not silently split a family into multiple deliveries when it is too large; present the conflict for a decision.

### 5. Reuse the delivery machine

After eligibility and necessary answers, create one correction/implementation branch per repository at the pinned revision, associated with the epic or orphan card. Do not create an extra branch for every epic child.

Reuse the existing stages: failing acceptance/unit test before implementation, minimal bounded changes, green tests, one independent review, findings resolution, final checks, concrete publication approval, verified staging revision/CI/deployment, native-browser E2E and human validation. Adapt feature wording and evidence semantics without relaxing guards. Adding the new run kind must not accidentally bypass guards currently restricted to bug-development runs.

One multi-repository unit can have one MR per repository while remaining a single epic delivery. Jira comments and transitions must use verified project/type metadata; Epic workflow statuses cannot be assumed to match SNOLA Bug statuses. Record progress for the root and affected children without claiming unrelated/completed work was delivered. No automatic master/main merge or production deployment is added.

### 6. Add the separate UI and operations

Show **Bug Triage**, **Bug Fix**, **Development** and **Config**. Give Development its own list and source/root/children information, while sharing the global worker budget. Expose discovery progress, blocked access, partial-family status, JEV outcomes and existing execution controls. Preserve current run kinds, snapshots, native sessions and Bug Triage → Bug Fix handoff.

### 7. Verify before activation

Cover isolated cards; epic/story/subtask depth; cross-project parents; non-To Do parents; paginated children; duplicate siblings; cycles; inaccessible nodes; interruption/recovery; changed membership; mixed bug/feature families; opt-outs; JEV failure/rejection; feature tests failing for the requested behavior; shared-machine evidence guards; publication approval; staging/browser failure; human validation; and global concurrency.

Run the complete bug regression suite alongside the new scenarios. Validate the real board intake and resulting groups in read-only preview, then test user-selected units. Enable automatic intake only after confirming the preview. Any unresolved shared-machine retry behavior must be fixed and independently verified before relying on it for new deliveries.

## Acceptance criteria

- The new queue is demonstrably independent from Bug Fix while sharing the delivery implementation and global concurrency limit.
- The board query and complete hierarchy discovery match the verified Jira relationships, including cross-project ancestors.
- An epic has one delivery and one branch per repository; an orphan has its own delivery and branch.
- No incomplete family, stale scope, failed JEV response or missing approval can reach publication.
- Existing bug runs remain compatible and the original bug routing is preserved.

## Current validation evidence

Board/filter/column configuration and a first-page JQL query were verified read-only. No new intake was activated, no Jira card was modified and no real feature was submitted to JEV. The initial discovery evidence above predates implementation.

References: [Jira enhanced issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), [current shared state machines](../src/workflows/machines.ts), [worker pool](../src/runtime/worker-pool.ts), [existing delivery processor](../src/development/development-processor.ts).

## Implemented verification

The separate `feature` queue, Jira board metadata/search adapter, resumable family discovery, scope deduplication, per-member analysis, feature JEV rubric, shared delivery guards, feature progress documentation and Development tab are implemented. The structural review separates domain types and injected services. Unit/local-process coverage includes family graphs, failed access, changed scope, JEV contracts, one-branch ownership, failing acceptance tests, explicit retry attempts and shared workers. No real delivery or Jira mutation has been executed. The full suite passes 100 tests in 23 files; TypeScript and packaging checks pass. A real read-only first preview confirmed the current board/filter/status mapping and persisted a complete family plus an in-progress descendant checkpoint. The initial board inventory remains partial and resumes on the next invocation. No real delivery or feature-JEV request has run; user-selected staging E2E remains the next operational validation.
