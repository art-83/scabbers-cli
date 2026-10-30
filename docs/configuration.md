# Configuration and operation

Editable configuration lives in `~/.config/scabbers/settings.json`, respecting `XDG_CONFIG_HOME`. Set `SCABBERS_SETTINGS` for another file. An explicit `SCABBERS_HOME` without a settings override isolates `settings.json` inside that state directory for tests/portable instances. The optional `$schema` points to the generated `assets/settings.schema.json`, allowing completion and field validation in editors such as VS Code.

The CLI reads and validates the file whenever it loads settings. The runtime checks for edits and applies valid changes at an idle worker-stage boundary, rebuilding integrations without replacing native task sessions, changing pinned SOUL revisions or rerouting an existing task's private owner. Invalid JSON, unknown fields or invalid schedule values pause new scheduling and produce a visible field/path diagnostic until corrected. In-flight stages finish with their current settings. Editing configuration does not itself verify remote credentials or deploy readiness.

Runtime state lives in `SCABBERS_HOME` or `~/.local/state/scabbers`. SQLite contains run state/snapshots, source deduplication, history watermarks, native session IDs, locks, effect receipts, decisions/reminder deadlines, logs and approved profiles. It is no longer a second authoritative configuration source. Existing settings from the previous TypeScript CLI SQLite record are copied once only when the JSON file is absent; the old record is preserved and cannot override subsequent file edits. This does not import the old Python ledger. Personal `SOUL.md` defaults to the selected settings directory, normally `~/.config/scabbers/SOUL.md`. Workspace `paths` no longer control its destination. An explicit `soulFile` override resolves relative to settings.json. The skill and CLI share this resolver; Config displays the absolute path. Each new run loads its approved snapshot. Existing sessions retain pinned content across file edits and recovery; new unreviewed content requires review. Versioned state remains in the private state directory. Explicitly move a selected older workspace source when migrating, preserving its bytes and approved versions.

## First setup

Use `$scabbers-configure` to generate the settings file from connected identities and verified local sources. Its proposed Brazil defaults are Monday–Friday, 9 AM–6 PM, America/Sao_Paulo, three workers; explicit choices override them. AM/PM is used in the discovery report, while the JSON uses `HH:mm`. Then run `scabbers` or `scabbers --configure`. If settings already exist, Enter keeps them and skips manual configuration fields; SOUL evidence/review remains separate. Choose Claude or Codex, your real Slack member ID, named per-day support shifts, HH:mm times, timezone, worker limit and NOLA web project roots. Enter actual staging endpoints and verified test argv; installed catalog skill paths can be discovered from the known NOLA plugin locations. Jira identity and project configuration can be entered interactively or through the JSON template. Use `$scabbers-soul` to synthesize a proposal from this chat or other explicitly selected evidence; it registers the real versioned profile without activating it. `scabbers --review-soul` displays that exact pending version for approval. The normal setup detects it before asking for manual history files. Alternatively select sanitized decision/history excerpts explicitly. Review the generated SOUL text and select its approval option with arrows and Enter only for the exact version you want. Empty sources leave profile setup pending. Repeating setup can propose another revision; existing tasks retain their pinned version.

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

Every configured repository needs an absolute source path, actual staging endpoint and trusted test argv. Set `baseBranch` to its remote base branch (`master` by default, or explicitly `main`). Before technical investigation the controller fetches that branch from `origin`, verifies the commit and creates a detached analysis worktree. After eligibility it creates the correction branch at the same commit. A failed fetch blocks preparation; it never falls back to stale local HEAD. Existing checkpoints keep their worktrees and pinned revision, without pull, reset or overwriting the user checkout. Commands run without a shell in a task worktree. Configure dependencies/test runtime in your repository environment; setup failures cannot count as the failing defect regression. Multi-repository deliveries require a `gitlabProjectId` for each repository.

`skillPaths` names the installed catalog `SKILL.md` files required by workflow stages. Marketplace installation is optional, but the capabilities named by the chosen workflow must be present. Missing skills block with their exact names; the controller does not invent replacement evidence.

Jira creates issues in the verified source Report's NOLA project and preserves compatible squad fields discovered in metadata. `routingFields` and `copyReportFields` can map additional required fields. Values are checked against available metadata options. Unmapped required fields, absent relationships or missing workflow transitions block instead of dropping traceability. The configured assignee is verified as an active Jira account. Assignment never bypasses JEV or scope checks.

## Publication and staging

The private publication decision points to a local `publication.diff` artifact and its digest. Approval applies only to the exact tested content. Changed content needs new final checks and review. The controller commits/pushes only `codex/scabbers-RUN_ID`, serializes staging integration by project, uses a detached integration worktree and opens a draft MR to `master`. There is no master merge, force push or production deployment path.

Use actual staging URLs; the example `.invalid` URLs are deliberately unusable placeholders. The controller requires the expected staging branch SHA, the latest pipeline in a successful state and the latest staging deployment matching that revision. Endpoint access is checked before E2E. A browser session must be logged in and connected. Claude uses the official `--chrome` path with its direct interactive account login (an API key or setup-token login does not authenticate the extension); Codex browser stages load the installed official app-managed browser MCP transport explicitly, with only Chrome exposed and native site permissions preserved. Read/edit stages retain their isolated configuration. There is no Playwright fallback.

A final human answer is accepted only in the authenticated private decision thread. Only then can the controller remove draft status, document validation and use an available Jira transition to Ready for Code Review.

The Config tab lists general preferences, support shifts, SOUL directories and integrations. Select a row with arrows and Enter; all changes are made through CLI fields and menus, without launching an external editor. Connection details and hidden token entry are separate for Slack, Jira and GitLab. Finish with Done and choose Save or Discard. Saves validate the schema and refuse to overwrite changes made outside the menu while it was open. Advanced structured fields accept JSON input. Automation activation remains a separate review; settings reload at idle stage boundaries.

Tokens pasted in Config are stored in local `credentials.json` under `SCABBERS_HOME` (default `~/.local/state/scabbers`) with permissions `0600`. Settings contain `credentialKeys` references only. This storage is plaintext on disk and protected by filesystem permissions, not encryption. Local credential references take precedence over environment variables, with environment/SSM fallback only when no local reference is selected. Removing a local reference restores that fallback; it does not revoke the token at its provider. Saving or replacing a token changes its reference so running integrations reload and health checks refresh without a process restart. Tokens are never returned in status/doctor output or menus.

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

Browser settings are available under Config > Browser. `browser.executable` and `browser.profileDirectory` choose an existing Chrome/Chromium installation/profile; `browser.testOrigin` is the read-only diagnostic target, not an access grant. The old Scabbers-only approved-origin list is migrated to a diagnostic target and removed on the next save. Native engine/browser permissions govern site access; Scabbers does not maintain or modify a parallel approval store. Codex browser stages load only the installed first-party browser transport and the documented `browser_use` policy from the user's config.toml; Claude browser stages use user settings. Normal approval and managed policy checks remain in force. No global configuration file is edited automatically.

E2E scope is still limited to the configured staging endpoints of the task, with deployment readiness and final human validation required. Other hosts, subdomains, ports and redirect destinations are not part of that scope. Both engines open/reuse Chrome or Chromium with its existing profile, without copying cookies or enabling remote debugging. Native browser stages are serialized and use a shared local lock.

The Browser menu includes **Test saved browser settings (read-only)**. It opens the saved test target (or a configured staging endpoint) and reads visible page information without clicking application controls or submitting data. Its status/summary is stored in the local state database and shown in Config; retries retain the native diagnostic session. A login page confirms browser access only, not application login. A native refusal stays blocked: use the engine's normal site-permission UI to approve the exact staging site where appropriate, then retry. No hidden-terminal prompt, automatic permission-store edit or global allow-all is used.

Claude browser stages use the official Agent SDK with the installed Claude CLI. Native Chrome tool calls are preauthorized within serialized browser stages, so routine tool approvals do not interrupt E2E checks. Other tools remain denied by the host. The extension still enforces its own site permissions and explicit native denials remain effective; this preauthorization never writes persistent site grants or enables bypass mode. Non-browser stages retain their restricted CLI permissions.

## Diagnostic log storage

Plaintext diagnostics are written beside the state database in `logs/scabbers-YYYY-MM-DD.log`, with directory permissions `0700` and file permissions `0600`. No additional configuration is required. `SCABBERS_HOME` relocates this storage along with runtime state. `scabbers --logs` reads the newest daily file without starting a daemon. Config and runtime status report the directory, 30-day retention and text-storage errors.

Logs record visible stage/engine activity, tool names or commands where exposed by the native protocol, test output and failures. Prompts, hidden reasoning and full tool inputs/results are not dumped. Individual messages are limited to 16,000 characters with an explicit truncation marker. Common credential formats and secret assignments are redacted before persistence, including private-key output split across an execution's messages. This is best-effort redaction; review diagnostics before sharing.

Retention removes only owned daily log files and expired SQLite diagnostic rows. Cleanup runs on startup, log viewing and activity, preserving execution snapshots and profile evidence. It requires Scabbers to run; no scheduled system service is installed. Text-storage failures preserve SQLite diagnostics and surface a Config warning. Previous unbounded `runtime.log` files are not modified or reused.

## Development Jira intake

`development.enabled` controls the separate feature queue; global `remoteEnabled` must also be true. Defaults are disabled, board `28`, column `To Do` and polling every 60 seconds. The board's saved filter and column statuses are resolved through Jira metadata, so Open is included when the board maps it to To Do. The runtime completes a read-only preview before its first automatic scan. `scabbers --preview-development` advances that preview without starting the runtime; add `--refresh` to discard its previous scan checkpoint. Preview and intake perform no Jira writes. Delivery stages have their own progress comments and explicit publication approvals.

```json
{
  "development": {
    "enabled": true,
    "boardId": 28,
    "column": "To Do",
    "pollSeconds": 60,
    "transitions": {}
  }
}
```

Workflow mappings are optional and keyed by `PROJECT/Issue Type`. Each configured entry requires `claim`, `documented` and `validated` target status names, checked through Jira's available transitions at mutation time. Without a mapping, the card keeps its status and receives progress comments. Discovering cross-project ancestors does not authorize changing unrelated or completed cards.

Feature families use the current shared delivery machine and a distinct feature eligibility rubric. Native sessions, root/member identities, requirements fingerprints and partial analysis/discovery are preserved. Scope changes block existing attempts rather than changing their approved plan. Very large analyses exceed explicit context/JEV budgets and require an owner scope decision; no descendants are silently dropped.

After installing this runtime change, restart the background process manually to load it. Reopening only the panel does not upgrade an already running runtime.
