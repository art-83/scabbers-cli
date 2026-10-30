# Scabbers CLI

A local NOLA workbench for support triage and bounded development of **arccanet-backend**, **arccanet-frontend** and **arcca-pdv web**. TypeScript, XState, SQLite and Ink. One `scabbers` panel has **Support** and **Development** tabs; a separate local runtime keeps working when the panel detaches.

**Remote processing is off by default.** This delivery does not install services, activate support, publish branches, send Slack messages or deploy applications. Review configuration and the concrete activation screen before enabling it.

## Install and open

Use Node **24+**, Git and npm. Engine CLIs authenticate independently.

```sh
npm ci
npm run build
npm install --global .
scabbers
```

The first interactive launch asks for selected history excerpts, support windows/timezone, owner identity and engine. It proposes a versioned `SOUL.md` for explicit review. You can also use `scabbers --configure`. It reads only explicitly selected, bounded files; it does not scan your computer.

For development without global installation:

```sh
npm run dev
npm start
```

`Tab` / left / right switch Support, Development and Config; up / down select a run; `Enter` opens execution actions (return, pause, resume or cancel), selected with up/down and Enter; `q` detaches. `e` displays settings and the effects of automation activation; choose return or activate with arrows and Enter after reviewing. Setup and SOUL review use the same selection controls. In Config, Enter opens a private JSON draft in your terminal editor (`VISUAL`/`EDITOR` executable, default `nano`). Close the editor, then select Save, Edit or Discard with arrows and Enter. Invalid edits can be corrected before saving; concurrent external changes are preserved. Remote activation still uses its own review. Closing the panel does not start another copy of the runtime. `scabbers --stop` stops it explicitly.

```sh
scabbers --doctor
scabbers --status
scabbers --config /absolute/path/to/non-secret-config.json
```

Settings live in `~/.config/scabbers/settings.json` (or `SCABBERS_SETTINGS`). Edit that file directly; its `$schema` enables editor validation and completion. Valid changes reload when current worker stages finish; invalid edits pause new scheduling and show the field error. Config imports force remote processing **off**. A CLI started without a TTY prints status. See [configuration](docs/configuration.md), [architecture](docs/architecture.md), [verification](docs/verification.md) and [limits](docs/limits.md).

Generate settings with the included `$scabbers-configure` skill: it discovers integration IDs through connected plugins, applies proposed Brazilian defaults and writes a private JSON file plus a discovery report.

Generate a versioned SOUL from selected conversation evidence with `$scabbers-soul`. It writes an injectable `SOUL.md` in the first configured `paths` directory containing `SOUL.md` (or the first directory when creating one) and preserves versioned snapshots, manifests and evidence. New executions load the file and retain their snapshot for the native session; later edits affect only future executions after review. Run `scabbers --review-soul` to review and explicitly approve it; an existing proposal skips the manual history-file prompt.

## What runs

Support incrementally reads `#reports-support` (`C0BU8TX3NTW`) and complete threads. The known **Criar report** workflow bot is an explicit intake exception; other bots and Scabbers messages cannot create loops. Reports received inside configured shifts are backfilled after downtime, including outside the current shift. Existing identifiable triage is left alone. Objective Bug, Bug Crítico, Ticket, duplicate and cancellation plans use live Jira metadata, verified links/reasons and idempotent receipts. Product/information handoffs retain the Report open; ambiguous behavior goes to a private decision.

Development has a separate run, pinned SOUL version and native engine conversation. JEV decides eligibility from the versioned form and both option orders. The controller requires an actual failing regression before implementation, passing checks, one fresh-session review, findings resolution and final tests. Publication needs review of a concrete diff digest in the private thread; only the task branch and serialized `staging` integration can be pushed. The MR targets `master` as a draft. Expected revision, staging CI/deployment and endpoint readiness precede native-browser E2E; authenticated human validation remains mandatory before making the MR ready and advancing Jira.

**Totem, SmartPOS/noah-smart-pos and mixed flows involving them are excluded from autonomous development.** Their reports can be triaged and handed off. Staging is NOLA's existing developer test environment, with its own endpoints. Missing access or an unverified deployment is a checkpoint blocker, never evidence that staging does not exist or that a test passed.

## Verify

```sh
npm run typecheck
npm test
npm run format:check
npm pack --dry-run
```

Tests use private temporary directories, local Git repositories and explicit integration doubles. They do not contact business systems. Real engine/Slack/JEV protocol checks performed during implementation are recorded separately in [verification](docs/verification.md).

The header separates **Automation active/off** from integration health. Slack, Jira and GitLab show green only after successful read-only authentication and configured channel/project access checks; failed or unconfigured connections are red, and initial checks are yellow. Checks refresh in the background every minute even when automation is off. Config shows details and the last check time. Connection checks do not prove every workflow write permission. The JSON key `remoteEnabled` remains compatible with earlier settings.
