# Configuration and operation

Editable configuration lives in `~/.config/scabbers/settings.json`, respecting `XDG_CONFIG_HOME`. Set `SCABBERS_SETTINGS` for another file. An explicit `SCABBERS_HOME` without a settings override isolates `settings.json` inside that state directory for tests/portable instances. The optional `$schema` points to the generated `assets/settings.schema.json`, allowing completion and field validation in editors such as VS Code.

The CLI reads and validates the file whenever it loads settings. The runtime checks for edits and applies valid changes at an idle worker-stage boundary, rebuilding integrations without replacing native task sessions, changing pinned SOUL revisions or rerouting an existing task's private owner. Invalid JSON, unknown fields or invalid schedule values pause new scheduling and produce a visible field/path diagnostic until corrected. In-flight stages finish with their current settings. Editing configuration does not itself verify remote credentials or deploy readiness.

Runtime state lives in `SCABBERS_HOME` or `~/.local/state/scabbers`. SQLite contains run state/snapshots, source deduplication, history watermarks, native session IDs, locks, effect receipts, decisions/reminder deadlines, logs and approved profiles. It is no longer a second authoritative configuration source. Existing settings from the previous TypeScript CLI SQLite record are copied once only when the JSON file is absent; the old record is preserved and cannot override subsequent file edits. This does not import the old Python ledger. Set `"paths": ["/home/arthur-nicolas/Projects/arcca"]` to select Arcca repository/workspace directories. The external `SOUL.md` in the first listed directory containing that file is the profile source; when none exists, the first directory is the creation destination. Paths resolve relative to settings.json, and directories are not scanned recursively. The skills ask for paths when missing, and ask for the creation destination when several directories have no SOUL. Detailed `repositories` entries still define development projects and their test/staging contracts. For compatibility, an empty `paths` list uses the previous `soulFile` or settings-directory fallback. An execution loads the approved file content into a durable per-run snapshot. Its first native turn receives the profile, subsequent turns reuse native context, and a fresh independent review gets the same pinned content. New or changed unreviewed content is proposed for review before new tasks; running tasks keep their existing snapshot even across runtime recovery. Profile archives in SQLite and versioned files are audit/recovery records, not a substitute for the external source for new executions. Native conversation histories remain owned by each engine.

## First setup

Use `$scabbers-configure` to generate the settings file from connected identities and verified local sources. Its proposed Brazil defaults are Monday–Friday, 9 AM–6 PM, America/Sao_Paulo, three workers; explicit choices override them. AM/PM is used in the discovery report, while the JSON uses `HH:mm`. Then run `scabbers` or `scabbers --configure`. If settings already exist, Enter keeps them and skips manual configuration fields; SOUL evidence/review remains separate. Choose Claude or Codex, your real Slack member ID, ISO weekdays, HH:mm start/end, timezone, worker limit and NOLA web project roots. Enter actual staging endpoints and verified test argv; installed catalog skill paths can be discovered from the known NOLA plugin locations. Jira identity and project configuration can be entered interactively or through the JSON template. Use `$scabbers-soul` to synthesize a proposal from this chat or other explicitly selected evidence; it registers the real versioned profile without activating it. `scabbers --review-soul` displays that exact pending version for approval. The normal setup detects it before asking for manual history files. Alternatively select sanitized decision/history excerpts explicitly. Review the generated SOUL text and type `approve` only for the exact version you want. Empty sources leave profile setup pending. Repeating setup can propose another revision; existing tasks retain their pinned version.

The setup can reuse only the owner and AWS/SSM **references** from the preserved `~/.local/state/nola-autonomous-bugfix/config.json`. It never imports the old ledger, copies secrets, inherits execute authorization, modifies the legacy worktree or restarts old units.

Use the optional JSON import for repository, Jira, GitLab and installed skill configuration. Start from `assets/config.example.json`; replace every placeholder. The Friday example is a sample, not a default. The application has no hardcoded support day. Overnight windows and timezone daylight-saving transitions are supported.

The first schedule setup establishes the admission watermark. Thereafter the watermark advances only after a complete successful sweep. Each successfully processed page persists its cursor with a fixed scan upper bound. A failed page resumes from that cursor; the high watermark advances only after all pages complete. An invalid remote cursor restarts the bounded scan with persistent source deduplication. Backfill applies the configured schedule to received timestamps, not to the time of reconnection. Work already started continues after a shift ends. When changing historical schedules, review backlog boundaries explicitly; the current configuration is the schedule used for backfill.

## Credentials and identities

Never put tokens in repository files, SOUL, Slack replies or the JSON template.

| Integration       | Environment or supported reference                                      |
| ----------------- | ----------------------------------------------------------------------- |
| Slack bot         | `SCABBERS_SLACK_BOT_TOKEN`, or `slack.tokenParameter` in AWS SSM        |
| Slack Socket Mode | `SCABBERS_SLACK_APP_TOKEN`, or `slack.appTokenParameter` in AWS SSM     |
| Jira              | `SCABBERS_JIRA_TOKEN`; `jira.email` and real `jira.accountId` in config |
| GitLab            | `SCABBERS_GITLAB_TOKEN`; real project IDs in config                     |
| JEV               | `TYPESAFE_API_KEY`, or `jevKeyParameter` in AWS SSM                     |
| Claude / Codex    | Their own supported authentication; never copied between engines        |

SSM reads use configured AWS profile/region and decryption in a private subprocess. Failures produce sanitized diagnostics. Engine processes receive a minimal environment containing their own auth settings, not Scabbers Slack/Jira/GitLab/JEV credentials.

The Slack app's UI being configured does not establish that an app-level token exists locally. The runtime attempts Socket Mode when a supported credential is available; otherwise paginated history/thread polling remains available. The existing app has channel events, bot membership and relevant scopes. Live DM events and interactive buttons still require matching app subscriptions/interactivity. Free-text private replies work through polling without those events.

A workflow question includes a stable decision code. Reply in its **private run thread** with `DECISION_UUID: your answer`. Buttons carry decision ID, version and option. The controller verifies author, DM channel, root thread, current decision, timestamp and duplicate receipt. Plain “yes” in an unrelated thread does not grant permission. Reminders use persisted ten-minute deadlines and stop after answer, pause or cancellation. Authentication happens directly in the browser; “ready” means retry verification, not assume access.

## Repository and Jira setup

Every configured repository needs an absolute source path, actual staging endpoint and trusted test argv. Commands run without a shell in a task worktree. Configure dependencies/test runtime in your repository environment; setup failures cannot count as the failing defect regression. Multi-repository deliveries require a `gitlabProjectId` for each repository.

`skillPaths` names the installed catalog `SKILL.md` files required by workflow stages. Marketplace installation is optional, but the capabilities named by the chosen workflow must be present. Missing skills block with their exact names; the controller does not invent replacement evidence.

Jira creates issues in the verified source Report's NOLA project and preserves compatible squad fields discovered in metadata. `routingFields` and `copyReportFields` can map additional required fields. Values are checked against available metadata options. Unmapped required fields, absent relationships or missing workflow transitions block instead of dropping traceability. The configured assignee is verified as an active Jira account. Assignment never bypasses JEV or scope checks.

## Publication and staging

The private publication decision points to a local `publication.diff` artifact and its digest. Approval applies only to the exact tested content. Changed content needs new final checks and review. The controller commits/pushes only `codex/scabbers-RUN_ID`, serializes staging integration by project, uses a detached integration worktree and opens a draft MR to `master`. There is no master merge, force push or production deployment path.

Use actual staging URLs; the example `.invalid` URLs are deliberately unusable placeholders. The controller requires the expected staging branch SHA, the latest pipeline in a successful state and the latest staging deployment matching that revision. Endpoint access is checked before E2E. A browser session must be logged in and connected. Claude uses the official `--chrome` path with its direct interactive account login (an API key or setup-token login does not authenticate the extension); Codex CLI has no verified public desktop-browser transport and blocks that step. There is no Playwright fallback.

A final human answer is accepted only in the authenticated private decision thread. Only then can the controller remove draft status, document validation and use an available Jira transition to Ready for Code Review.

The Config tab edits a private temporary copy of settings.json in a terminal editor (`VISUAL` or `EDITOR` executable, default `nano`). Closing the editor validates the JSON and schema, then offers Save, Edit or Discard using arrows and Enter. Invalid content stays in the draft until corrected or discarded. Saving uses atomic replacement and refuses to overwrite external edits made since the draft opened. Enabling remote processing requires the activation review. Runtime reload waits for active stages to finish.

Support shifts use English weekday enum values and individual intervals. Multiple entries may use the same day for split shifts. Start is inclusive, end is exclusive; an end earlier than start continues into the following day. Equal start/end is invalid. Existing numeric-day settings are read compatibly and saved in the new format on the next save.

```json
{
  "schedule": {
    "zone": "America/Sao_Paulo",
    "shifts": [
      { "day": "Monday", "start": "08:00", "end": "12:00" },
      { "day": "Friday", "start": "14:00", "end": "20:00" }
    ]
  }
}
```

These intervals are an example, not an inferred change to the user's actual roster.
