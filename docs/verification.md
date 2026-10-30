# Verification record

Delivery review date: **2026-10-30**. Checkout: `/home/arthur-nicolas/Projects/scabbers-cli`.

## Automated local checks

`npm run typecheck`, `npm test`, `npm run format:check` and `npm pack --dry-run` are the delivery checks. `npm test` builds first so runtime-process tests exercise the packaged JavaScript entry point.

The final suite contains **136 tests in 26 files** and covers:

- SQLite source uniqueness, independent connections, resource reservations and pinned SOUL revisions;
- restored XState snapshots/native session IDs, invalid transitions and persisted eligibility/evidence guards;
- timezone/overnight/DST boundaries, missed-shift backfill outside the present shift and cursor preservation after failed reads;
- real report-workflow bot admission, ordinary-bot exclusion, complete-thread Jira references and legacy triage markers;
- paginated Slack history/replies, durable per-page backfill cursor and fixed scan upper bounds;
- private decision author/channel/thread/version/time/receipt validation and persistent ten-minute reminder behavior;
- worker concurrency, excess queueing and protection against stale writes undoing pause/cancellation;
- Totem/SmartPOS/mixed-scope exclusion;
- real native CLI argument/protocol contracts using explicit process doubles and JEV's systemone response validation/two option orders/fail-closed behavior;
- Ink rendering and switching Support/Development/Config without another runtime, and arrow/Enter activation selection;
- validated settings editing, concurrent-edit protection and numeric-to-named weekday migration;
- menu-based per-day editing, hidden token persistence/replacement/removal, discard without secret writes and credential-file permissions;
- per-day and split support shifts, inclusive starts and exclusive ends;
- independent read-only Slack/Jira/GitLab health probes and sanitized failure results;
- a real child-process daemon reconnect, crash/restart and preservation of queued stage/session with remote processing disabled;
- a local Git fixture in an isolated worktree: passing baseline, newly failing defect regression, implementation, green tests, exactly one fresh-context review and final tested-content digest. LLM/JEV/Jira stages in this test are explicitly scripted fixtures;
- task/staging Git pushes to a **local bare repository**, unchanged master and recovery after a simulated lost GitLab MR response, without another commit or MR;
- refusal to overwrite an unsupported future SQLite schema version;
- canonical settings file edits, strict field/window validation, private atomic saves, one-time earlier-CLI settings import and live daemon reload/recovery from malformed JSON;
- external SOUL source loading, first-turn-only profile injection, isolation from later file edits, review of changed revisions, fresh-review snapshot consistency and recovery without rereading the external source for existing sessions;
- the SOUL skill writer and review path: real SQLite registration, canonical artifacts, no automatic activation, approval/defer behavior, tampered-artifact refusal and secret rejection;
- the configuration skill generator: Brazilian defaults, explicit Sunday/Codex preservation, schema validation, secret/overwrite refusal and private artifacts;
- Product handoff without an RFC or Report closure, rejection of closed duplicate destinations, live cancellation-option requirements and recovery after a lost cancellation response.

HTTP doubles and scripted stages are not described as live business integration or NOLA E2E proof.

## Actual read-only/protocol observations

| Capability              | Observation                                                                                                                     | Boundary                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Claude Code             | Installed 2.1.310; real local no-tool prompt and a second turn resumed the same native session with validated structured output | Chrome staging page read successfully with visible welcome text; no customer task executed                                |
| Codex CLI               | Installed 0.165.0; real local no-tool prompt and a second turn resumed the same native thread with validated structured output  | Desktop browser transport not established                                                                                 |
| Slack connector         | Read support channel and two complete threads                                                                                   | Discovered report-workflow source bot, reply-only Jira references and a real legacy triage marker; no messages sent       |
| Slack REST              | Existing SSM bot reference authenticated to workspace ARCCA, read channel history and a thread                                  | No permissions changed, no support admission activated                                                                    |
| JEV SSM reference       | Credential resolved privately                                                                                                   | Value never printed or persisted                                                                                          |
| JEV service             | Real systemone request for a **synthetic local modal fixture**, both option orders; form-v0.6 result A-candidate, score 0.99    | No actual card classified; score is a provisional eligibility score, not success probability                              |
| Slack app-level token   | Not present in checked process environment or legacy configuration reference                                                    | Socket Mode startup not proven; polling supported                                                                         |
| Native local edit       | Both real engine adapters created the expected TypeScript file in an empty temporary repository                                 | No business repository or remote state changed                                                                            |
| Browser bridge          | Both native transports exercised against staging; Codex read a login page; Claude read the staging home page                    | Browser connectivity confirmed for both engines; no complete application workflow E2E                                     |
| Jira / GitLab mutations | Adapter behavior checked with local/HTTP fixtures                                                                               | No real issues/MRs/branches/staging deployments modified                                                                  |
| NOLA staging E2E        | Not executed                                                                                                                    | Requires configured endpoints, exact revision/CI/deployment, native browser connection/login and navigation authorization |

The Claude adapter also uses documented absolute `Edit(//path/**)` permissions, which cover native Write operations, and its bounded local-write smoke passed. The Claude schema smoke test exposed a real compatibility issue: the installed CLI rejected the default JSON Schema 2020-12 dialect. The adapter now emits draft-7, and the repeated live no-tool check passed.

## Package installation

The built npm tarball was installed into an isolated temporary global prefix with production dependencies only. Its installed `scabbers --doctor` command executed successfully, detected both installed native engines and reported `remoteEnabled: false`. No global user installation or shell initialization file was changed.

## Preserved state

The original autonomous-bugfix worktree, Python scripts, ledger and configuration were read as references. No legacy file was modified, no old unit/timer was reinstalled or restarted, and no credentials were copied into this repository. Smoke-test daemons use temporary private state and are stopped after verification. Default application state remains remote-disabled.

Native browser validation: an isolated Codex CLI invocation loaded the installed first-party cua_repl server and read the staging login page after native authorization was corrected. Claude initially navigated but encountered a native domain-permission refusal; the final SDK host-callback run successfully read the staging home page, including the visible welcome text. Browser tools were automatically approved only in the browser stage, with native checks retained. The tests did not fill fields, submit forms or exercise a complete application workflow. A signed-in-looking page is an observation, not independent verification of application authentication. Browser tests cover exact staging scope, saved diagnostics and browser access serialization.

The Claude SDK browser path has regression coverage for automatic native Chrome tool approvals, rejection of unrelated tools and native session preservation. It does not persist site grants; non-browser stages retain the previous CLI contract. Live site authorization must still be verified separately from local tests.

A subsequent real Claude check reused its staging tab, captured the home page, opened the side menu and clicked **Comunicados**. A second capture and tab metadata confirmed the internal route `/announcements` and the heading **Comunicados**. Native tool calls, screenshots and structured evidence were saved in private local state, outside the repository. No records were created, modified or deleted. This validates screenshot and internal navigation tool calling; the issue-to-deployment workflow remains untested end to end.

The SOUL source resolver defaults to the selected settings directory, regardless of workspace `paths`, while preserving explicit `soulFile` overrides. An isolated invocation of the actual skill helper verified private source creation beside settings.json, preservation of unrelated workspace profiles and no automatic proposal activation.

Fresh-base verification uses real local bare remotes: upstream changes made after cloning appear in new detached analysis worktrees, while dirty source files and the user branch remain unchanged. Retries and post-JEV branch creation preserve the pinned revision even after upstream advances. Explicit `main` bases work; unavailable remotes block new preparation despite cached refs. The development fixture asserts that investigation runs in the detached worktree before eligibility.

Plaintext logging verification covers private file permissions, per-run timestamps, credential redaction, split private-key output, daily rotation and 30-day cleanup boundaries. It preserves unrelated files, symlinks, run state and approved profiles. A failed text sink leaves SQLite diagnostics available and recovers on a later write. A real CLI subprocess reads logs without creating a runtime socket/PID or requiring settings; process-runner fixtures also verify final unterminated stderr output. These tests use private temporary directories and do not start the user's runtime.

Development feature coverage includes paginated board discovery, cross-project ancestors, deep subtasks, orphan ownership, inaccessible explicit references, cycle/token-loop detection, serialized discovery recovery, sibling deduplication, scope versions, opt-outs, active/mixed families, completed context, fresh scope checks after waits, project/type workflow mappings and global member locks. HTTP fixtures verify the actual enhanced Jira search and board/filter contract. Separate feature-JEV tests verify both option orders and minimized evidence. A local Git fixture exercises the feature path through pinned analysis, member synthesis, feature eligibility, failing acceptance tests, implementation, one review and final green checks without publication. Retry tests cover access retry, new-attempt approval invalidation, Pause and rejection of old human validation. Product answers are applied to the full feature plan before eligibility is reconsidered. No real Jira/Slack mutations, feature JEV calls or customer feature implementation were performed by this verification.

The structural review moved domain contracts into dedicated type files across feature discovery, configuration menus, browser diagnostics, runtime protocol, logging and the mascot. Feature behavior is grouped in injected services/models (`JiraCard`, `Hierarchy`, `FamilyPolicy`, `FeatureAnalysis`, `FeatureDelivery`, `FeatureIntake`). Formatting helpers and React components remain functions.

A read-only invocation of the new CLI against the actual Jira configuration confirmed Visão Unificada Nola, saved filter 10594 and status IDs 10003/1. Its bounded first batch produced one complete family, four explicit exclusions and an unfinished family checkpoint, with additional candidates queued. This confirms the real discovery transport and saved partial progress, not a complete board inventory or feature delivery. No runtime was started for that preview.

Engine-profile tests verify exact CLI model/effort arguments, Claude browser SDK options, native quota error classification, successful transient-retry handling, saved per-engine sessions, pinned profiles across configuration changes, both-engine exhaustion without loops and disabled fallback. Permission/authentication/budget errors cannot trigger handoff. A fresh-review handoff preserves the older implementation session, and a still-running native process blocks a switch. These use process doubles and temporary private state; no real usage limit was induced and no live model invocation was needed.

Panel-lifecycle tests start isolated IPC-owned runtimes and verify normal controller closure, abrupt parent death, refusal of a second panel, non-interactive status-only behavior and termination of managed subprocesses. Recovery still preserves queued workflow/native-session state. The singleton PID lock remains held while shutdown finishes. Engineering-scope tests distinguish product Epic statuses from active child work and enforce the maximum Ready for Code Review boundary in both validated mappings and the Jira adapter. Product Epic mappings cannot change their status. No live task implementation or Jira mutation was performed for these checks.

The shutdown registry includes both process-group children launched by ProcessRunner and non-detached native children launched by the Claude SDK. A separate fixture verifies the latter are stopped as well.

Assignee-scope regression tests verify mandatory owner JQL, missing/invalid identity rejection, backend result filtering, mixed-assignee family context with owner-only implementation, reassignment blocking, owner-specific checkpoint fingerprints and assignment checks at the Jira write boundary. Existing graph, workflow, lifecycle and engine-fallback checks continue to run.

### Jira image evidence (October 30, 2026)

The read-only attachment path downloaded both PNG attachments from the RFC epic through Jira with redirects disabled. Separate native Codex and Claude adapter invocations inspected both images and described the visible dropdown selection and multi-select filter with Reset/Filter controls. This validates visual input through both adapters, not a full feature delivery. No Jira/Slack writes, browser navigation or runtime startup were performed by this check.

Unit coverage includes private content-addressed storage, metadata provenance, corrupted-cache recovery, origin and redirect restrictions, bounded streaming, unsupported/invalid images, cancellation, image limits, Codex new/resumed turns, Claude Read instructions and the controller's epic-plus-current-child evidence handoff. Family fingerprints include attachment metadata so evidence changes invalidate an existing scope snapshot.

### Structured stage questions (October 30, 2026)

The History of Orders investigation stopped at the engine result boundary because `question` contained `{text, decisionContext, decision}` rather than the canonical string. Member-analysis repair was never reached. Both engine adapters now share a boundary reader that normalizes this known shape, promotes its validated context and proposal, and preserves technical data and observed evidence. Conflicting top-level and nested values, invalid recommendations and malformed text still fail validation. Codex receives the full result JSON Schema, including the question/decision fields, instead of a minimal example. Coverage includes native Codex, Claude CLI and Claude browser SDK responses.

### Product-name normalization and feature-plan checkpoints (October 30, 2026)

All three observed plans failed before JEV because display-name product labels did not match the policy's canonical identifiers. Known aliases now normalize through the shared eligibility schema and policy. Tests cover the actual labels, canonical values and typography variations while retaining excluded/mixed/unknown product and repository restrictions. End-to-end controller unit coverage verifies transition to eligibility without another nomenclature question and checkpoint reuse without another LLM call; an excluded plan stays at investigation with its candidate preserved for diagnosis.

### Read-only production logs and linked support evidence (October 30, 2026)

The new stdio MCP server completed a real authenticated CloudWatch log-group read with the configured AWS profile. That narrow prefix returned no groups; this does not establish the incident cause or absence of logs elsewhere. The tool has no write operations or arbitrary AWS command/endpoint input. Tests exercise bounded queries, redaction, denied/malformed responses, incomplete pagination, argument injection attempts, native adapter isolation and source-thread collection/provenance. A linked origin channel was accessible through the connected Slack plugin but unavailable to the bot (`not_in_channel`); manual reanalysis explicitly identifies that different evidence source rather than claiming the bot collected it.
