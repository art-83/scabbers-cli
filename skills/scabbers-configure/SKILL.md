---
name: scabbers-configure
description: Generate an importable Scabbers configuration JSON using connected identity and project integrations, verified local settings and Brazilian defaults. Use for first setup or preparing a configuration file; not for activating support or changing remote app permissions.
---

# Configure Scabbers

Create a valid, non-secret `settings.json` file so the user does not have to look up integration IDs manually. Also create a short discovery report distinguishing verified values, proposed defaults and unresolved prerequisites. Communicate in PT-BR; keep configuration identifiers and technical instructions in English.

Read [configuration discovery](references/discovery.md) for field mapping and the Brazil defaults. Locate the Scabbers project or installed package and use its current `configSchema` as the source of truth; do not add unsupported locale or time-format keys. The application exports `assets/settings.schema.json`; the generator adds its local `$schema` link for editor completion and validation.

Use connected plugins for read-only discovery: current Atlassian identity/site, current Slack profile/workspace/channel, and GitLab projects if a supported connection exists. Match the same person across services using verified email or explicit session evidence. Search by name only when the identity endpoint is unavailable; do not silently select an ambiguous match. Inspect only selected repositories and known private configuration references for local paths, test commands and staging endpoints. Existing explicit user choices take precedence over defaults.

Populate `paths` with the user-selected Arcca repository or workspace directories. Ask for these paths when absent; do not infer them from unrelated folders or invent a default. One parent workspace directory (for example `/home/arthur-nicolas/Projects/arcca`) is valid. Paths are ordered: Scabbers loads the first existing `<path>/SOUL.md`, or uses the first path as the creation destination if none exists. Relative paths resolve against settings.json. `paths` is independent of the detailed `repositories` entries used for development verification.

Generate configuration with `remoteEnabled: false`. Use `America/Sao_Paulo` as the proposed timezone when no verified timezone/user preference exists, Monday–Friday 9 AM–6 PM as a proposed work window, and three workers. Explain that Brazil has multiple timezones and the window is a configurable starting point, not an inferred company schedule. Honor requested AM/PM display but serialize times as `09:00` and `18:00`, because Scabbers requires 24-hour `HH:mm`. Use `schedule: {zone, shifts: [{day, start, end}]}` with day values `Monday` through `Sunday`; each entry has its own interval. An explicit Sunday selection remains Sunday. Preserve day-specific hours and multiple intervals rather than replacing them with the generic work window. Reuse the user's chosen engine; otherwise keep the application's engine default.

Never invent IDs, staging URLs, repository test commands or credential references. Keep unresolved optional sections absent/empty and list their exact missing fields in the report. A GitLab namespace/project path verified from the actual Git remote is a valid API project identifier; do not label it a verified numeric ID. Do not use production as staging. Do not read raw secret files, extract plugin/browser tokens, ask for pasted secrets, or place tokens/passwords in either artifact. Reuse only known environment variable names or explicitly configured SSM references. SOUL/history sources stay empty unless the user selected sources.

Write a discovery input with `config`, `evidence` and `unresolved`, then run:

```sh
node /absolute/path/to/scabbers-configure/scripts/generate-config.ts \
  --project /absolute/path/to/scabbers-package \
  --discovery /private/path/to/discovery.json \
  --output /private/path/to/settings.json
```

The helper uses the current compiled application schema, validates the timezone/window, rejects secrets, writes private files and refuses overwrites. Build the project first if its compiled schema is absent. The report is written beside the JSON as `.discovery.json`. Default to `~/.config/scabbers/settings.json` (respect `XDG_CONFIG_HOME`, `SCABBERS_SETTINGS` and isolated `SCABBERS_HOME` overrides). Keep personal artifacts outside the repository. Writing the canonical path makes it available to the CLI on its next read; valid running-runtime changes apply at idle stage boundaries. Do not run an additional import automatically, approve SOUL, activate processing, send messages or change Slack permissions as part of generation.

Return the settings link, a concise AM/PM summary and pending prerequisites. For the canonical location, the user can simply run `scabbers`. For a proposed file at another location, provide `scabbers --config /absolute/path/to/settings.json`; imports force remote processing off. Generation does not complete SOUL review or grant execution permissions.
