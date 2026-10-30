# Verification record

Delivery review date: **2026-10-30**. Worktree: `/home/arthur-nicolas/.codex/worktrees/1376/scabbers-cli`.

## Automated local checks

`npm run typecheck`, `npm test`, `npm run format:check` and `npm pack --dry-run` are the delivery checks. `npm test` builds first so runtime-process tests exercise the packaged JavaScript entry point.

The final suite contains **50 tests in 15 files** and covers:

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
- validated JSON editing through a private draft, discard/retry, concurrent-edit protection and numeric-to-named weekday migration;
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
| Claude Code             | Installed 2.1.310; real local no-tool prompt and a second turn resumed the same native session with validated structured output | No browser or customer task executed                                                                                      |
| Codex CLI               | Installed 0.165.0; real local no-tool prompt and a second turn resumed the same native thread with validated structured output  | Desktop browser transport not established                                                                                 |
| Slack connector         | Read support channel and two complete threads                                                                                   | Discovered report-workflow source bot, reply-only Jira references and a real legacy triage marker; no messages sent       |
| Slack REST              | Existing SSM bot reference authenticated to workspace ARCCA, read channel history and a thread                                  | No permissions changed, no support admission activated                                                                    |
| JEV SSM reference       | Credential resolved privately                                                                                                   | Value never printed or persisted                                                                                          |
| JEV service             | Real systemone request for a **synthetic local modal fixture**, both option orders; form-v0.6 result A-candidate, score 0.99    | No actual card classified; score is a provisional eligibility score, not success probability                              |
| Slack app-level token   | Not present in checked process environment or legacy configuration reference                                                    | Socket Mode startup not proven; polling supported                                                                         |
| Native local edit       | Both real engine adapters created the expected TypeScript file in an empty temporary repository                                 | No business repository or remote state changed                                                                            |
| Browser bridge          | Claude native flag/host path documented; Codex CLI lacks verified standalone transport                                          | No browser actions or login flow tested remotely                                                                          |
| Jira / GitLab mutations | Adapter behavior checked with local/HTTP fixtures                                                                               | No real issues/MRs/branches/staging deployments modified                                                                  |
| NOLA staging E2E        | Not executed                                                                                                                    | Requires configured endpoints, exact revision/CI/deployment, native browser connection/login and navigation authorization |

The Claude adapter also uses documented absolute `Edit(//path/**)` permissions, which cover native Write operations, and its bounded local-write smoke passed. The Claude schema smoke test exposed a real compatibility issue: the installed CLI rejected the default JSON Schema 2020-12 dialect. The adapter now emits draft-7, and the repeated live no-tool check passed.

## Package installation

The built npm tarball was installed into an isolated temporary global prefix with production dependencies only. Its installed `scabbers --doctor` command executed successfully, detected both installed native engines and reported `remoteEnabled: false`. No global user installation or shell initialization file was changed.

## Preserved state

The original autonomous-bugfix worktree, Python scripts, ledger and configuration were read as references. No legacy file was modified, no old unit/timer was reinstalled or restarted, and no credentials were copied into this repository. Smoke-test daemons use temporary private state and are stopped after verification. Default application state remains remote-disabled.
