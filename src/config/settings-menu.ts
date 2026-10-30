import type { SettingsSection } from "./types/settings-section.js";
import type { Prompts } from "./types/settings-prompts.js";
import type { Field } from "./types/settings-field.js";
import { readFileSync } from "node:fs";
import { Configuration } from "./configuration.js";
import { configSchema, type Config } from "./types/config.js";
import { migrateBrowser } from "./types/browser.js";
import { migrateSchedule, weekdays } from "./types/schedule.js";
import { Store } from "../storage/store.js";
import { CredentialStore } from "../integrations/credential-store.js";
import { choose, text, secret } from "../tui/prompts.js";

export const settingsSections = [
  "engine",
  "models",
  "workers",
  "schedule",
  "paths",
  "slack",
  "jira",
  "gitlab",
  "browser",
  "development",
  "advanced",
] as const;

export function settingsItems(
  path: string,
): { key: SettingsSection; label: string }[] {
  const config = configSchema.parse(
    migrateBrowser(migrateSchedule(JSON.parse(readFileSync(path, "utf8")))),
  );
  return [
    { key: "engine", label: `Engine: ${config.engine}` },
    { key: "models", label: "Models, reasoning effort and quota fallback" },
    { key: "workers", label: `Concurrent workers: ${config.workers}` },
    {
      key: "schedule",
      label: `Support schedule: ${config.schedule?.shifts.map((shift) => `${shift.day} ${shift.start}–${shift.end}`).join(", ") || "not configured"}`,
    },
    {
      key: "paths",
      label: `Workspace directories: ${config.paths.length} configured`,
    },
    { key: "slack", label: "Slack · connection and authentication" },
    { key: "jira", label: "Jira · connection and authentication" },
    { key: "gitlab", label: "GitLab · connection and authentication" },
    {
      key: "development",
      label: `Development intake · ${config.development.enabled ? "enabled" : "off"} · Jira board ${config.development.boardId}`,
    },
    {
      key: "browser",
      label: "Browser · native engine permissions and connection check",
    },
    {
      key: "advanced",
      label: "Advanced settings · repositories, skills and AWS",
    },
  ];
}

export async function configureSetting(
  path: string,
  section: SettingsSection,
  prompts: Prompts = { choose, text, secret },
  credentials = new CredentialStore(),
  checkBrowser?: () => Promise<string>,
  previewDevelopment?: () => Promise<string>,
): Promise<boolean> {
  const original = readFileSync(path, "utf8");
  const store = new Store(":memory:");
  const configuration = new Configuration(store, path);
  const pendingTokens = new Map<keyof Config["credentialKeys"], string>();
  const removedTokens = new Set<keyof Config["credentialKeys"]>();
  try {
    const config = configuration.get();
    const before = structuredClone(config);
    const input = async (
      label: string,
      current: unknown = "",
      kind?: Field["kind"],
    ): Promise<unknown> => {
      const shown =
        typeof current === "string" ? current : JSON.stringify(current);
      const value = await prompts.text(
        `${label} [${shown ?? "not configured"}] (Enter keeps current; - clears): `,
      );
      if (!value) return current;
      if (value === "-") return undefined;
      return kind === "json"
        ? JSON.parse(value)
        : kind === "number"
          ? Number(value)
          : value;
    };
    const fields = async (
      label: string,
      target: Record<string, unknown>,
      definitions: Field[],
    ): Promise<void> => {
      for (;;) {
        const selected = await prompts.choose(label, [
          ...definitions.map((field) => ({
            label: `${field.label}: ${typeof target[field.key] === "object" ? JSON.stringify(target[field.key]) : (target[field.key] ?? "not configured")}`,
            value: field.key,
          })),
          ...(label === "Browser settings" && checkBrowser
            ? [
                {
                  label: "Test saved browser settings (read-only)",
                  value: "check-browser",
                },
              ]
            : []),
          { label: "Done", value: "done" },
        ]);
        if (selected === "done") return;
        if (selected === "check-browser" && checkBrowser) {
          const summary = await checkBrowser();
          await prompts.choose(summary, [{ label: "Return", value: "return" }]);
          continue;
        }
        const field = definitions.find((item) => item.key === selected)!;
        try {
          const value = await input(field.label, target[field.key], field.kind);
          if (value === undefined) delete target[field.key];
          else target[field.key] = value;
        } catch {
          await prompts.choose("Invalid field value; no change applied", [
            { label: "Return", value: "return" },
          ]);
        }
      }
    };
    if (section === "engine") {
      config.engine = (await prompts.choose(
        "Engine",
        [
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ],
        config.engine,
      )) as Config["engine"];
    } else if (section === "models") {
      for (;;) {
        const selected = await prompts.choose("Models and effort", [
          { label: "Codex model and effort", value: "codex" },
          { label: "Claude model and effort", value: "claude" },
          { label: "Automatic fallback on usage quota", value: "fallback" },
          { label: "Done", value: "done" },
        ]);
        if (selected === "done") break;
        if (selected === "fallback") {
          config.fallback.enabled =
            (await prompts.choose(
              "Switch engines automatically only for recognized usage limits?",
              [
                { label: "Enabled", value: "yes" },
                { label: "Disabled", value: "no" },
              ],
              config.fallback.enabled ? "yes" : "no",
            )) === "yes";
          await fields("Fallback order and cooldown", config.fallback, [
            {
              key: "order",
              label: "Engine preference order (JSON array)",
              kind: "json",
            },
            {
              key: "cooldownSeconds",
              label: "Quota cooldown seconds",
              kind: "number",
            },
          ]);
        } else {
          const engine = selected as Config["engine"];
          await fields(`${engine} model`, config.engines[engine], [
            {
              key: "model",
              label: "Model ID or native alias (- uses native default)",
            },
          ]);
          const levels =
            engine === "claude"
              ? ["low", "medium", "high", "xhigh", "max"]
              : ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
          const effort = await prompts.choose(
            "Reasoning effort (availability depends on the selected model)",
            [
              { label: "Native model default", value: "default" },
              ...levels.map((level) => ({ label: level, value: level })),
            ],
            config.engines[engine].effort ?? "default",
          );
          if (effort === "default") delete config.engines[engine].effort;
          else Object.assign(config.engines[engine], { effort });
        }
      }
    } else if (section === "workers") {
      config.workers = Number(
        await prompts.choose(
          "Concurrent workers",
          Array.from({ length: 16 }, (_, i) => ({
            label: String(i + 1),
            value: String(i + 1),
          })),
          String(config.workers),
        ),
      );
    } else if (section === "paths") {
      const value = await prompts.text(
        `Workspace directories, comma separated [${config.paths.join(", ")}] (Enter keeps current): `,
      );
      if (value)
        config.paths = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    } else if (section === "browser") {
      await fields(
        "Browser settings",
        config.browser as unknown as Record<string, unknown>,
        [
          {
            key: "testOrigin",
            label: "Read-only check target (HTTPS origin; not an access grant)",
          },
          {
            key: "executable",
            label: "Chrome/Chromium executable (optional; auto-detected)",
          },
          {
            key: "profileDirectory",
            label: "Existing browser profile directory (optional)",
          },
        ],
      );
    } else if (section === "development") {
      for (;;) {
        const action = await prompts.choose("Development Jira intake", [
          { label: "Read-only board/family preview", value: "preview" },
          {
            label: config.development.enabled
              ? "Disable automatic Jira intake"
              : "Enable automatic intake for the configured board",
            value: "toggle",
          },
          { label: "Board, polling and workflow mappings", value: "settings" },
          { label: "Done", value: "done" },
        ]);
        if (action === "done") break;
        if (action === "preview") {
          if (!previewDevelopment)
            throw new Error(
              "Preview unavailable; use scabbers --preview-development",
            );
          await prompts.choose(await previewDevelopment(), [
            { label: "Return", value: "return" },
          ]);
        }
        if (action === "toggle")
          config.development.enabled = !config.development.enabled;
        if (action === "settings")
          await fields("Development intake settings", config.development, [
            { key: "boardId", label: "Jira board ID", kind: "number" },
            { key: "column", label: "Candidate column" },
            {
              key: "workflowStatuses",
              label:
                "Engineering workflow statuses (JSON array; maximum Ready for Code Review)",
              kind: "json",
            },
            { key: "pollSeconds", label: "Polling seconds", kind: "number" },
            {
              key: "transitions",
              label: "Verified project/type workflow mappings (JSON)",
              kind: "json",
            },
          ]);
      }
    } else if (section === "schedule") {
      config.schedule ??= { zone: "America/Sao_Paulo", shifts: [] };
      for (;;) {
        const action = await prompts.choose("Support schedule", [
          { label: `Timezone: ${config.schedule.zone}`, value: "zone" },
          ...config.schedule.shifts.map((shift, i) => ({
            label: `${shift.day} ${shift.start}–${shift.end}`,
            value: String(i),
          })),
          { label: "Add interval", value: "add" },
          { label: "Done", value: "done" },
        ]);
        if (action === "done") break;
        if (action === "zone") {
          config.schedule.zone = String(
            await input("Timezone", config.schedule.zone),
          );
          continue;
        }
        const index = action === "add" ? -1 : Number(action);
        const previous = config.schedule.shifts[index];
        if (
          previous &&
          (await prompts
            .choose("Interval", [
              { label: "Edit", value: "edit" },
              { label: "Remove", value: "remove" },
              { label: "Return", value: "return" },
            ])
            .then((value) => {
              if (value === "remove") config.schedule!.shifts.splice(index, 1);
              return value !== "edit";
            }))
        )
          continue;
        const day = (await prompts.choose(
          "Weekday",
          weekdays.map((name) => ({ label: name, value: name })),
          previous?.day ?? "Friday",
        )) as (typeof weekdays)[number];
        const start = String(
          await input("Start HH:mm", previous?.start ?? "09:00"),
        );
        const end = String(await input("End HH:mm", previous?.end ?? "18:00"));
        const shift = { day, start, end };
        if (index < 0) config.schedule.shifts.push(shift);
        else config.schedule.shifts[index] = shift;
      }
    } else if (
      section === "slack" ||
      section === "jira" ||
      section === "gitlab"
    ) {
      const tokenName =
        section === "slack"
          ? "SCABBERS_SLACK_BOT_TOKEN"
          : section === "jira"
            ? "SCABBERS_JIRA_TOKEN"
            : "SCABBERS_GITLAB_TOKEN";
      const definitions: Field[] =
        section === "slack"
          ? [
              { key: "channel", label: "Report channel ID" },
              { key: "user", label: "Owner Slack member ID" },
              {
                key: "reportBotIds",
                label: "Report bot IDs (JSON array)",
                kind: "json",
              },
              { key: "tokenParameter", label: "AWS SSM bot token reference" },
              {
                key: "appTokenParameter",
                label: "AWS SSM app token reference",
              },
            ]
          : section === "jira"
            ? [
                { key: "baseUrl", label: "Site URL" },
                { key: "email", label: "Email" },
                { key: "accountId", label: "Assignee account ID" },
                { key: "project", label: "Project key" },
                {
                  key: "routingFields",
                  label: "Routing fields (JSON object)",
                  kind: "json",
                },
                {
                  key: "copyReportFields",
                  label: "Copied fields (JSON array)",
                  kind: "json",
                },
              ]
            : [
                { key: "baseUrl", label: "GitLab URL" },
                { key: "projectId", label: "Project ID or group/project" },
              ];
      for (;;) {
        const action = await prompts.choose(
          `${section.toUpperCase()} integration`,
          [
            { label: "Connection settings", value: "settings" },
            { label: "Paste / replace token (hidden input)", value: "token" },
            ...(section === "slack"
              ? [
                  {
                    label: "Paste / replace Socket Mode app token (optional)",
                    value: "app-token",
                  },
                ]
              : []),
            { label: "Remove locally stored token", value: "remove" },
            { label: "Done", value: "done" },
          ],
        );
        if (action === "done") break;
        if (action === "settings") {
          const target: Record<string, unknown> = structuredClone(
            config[section] ?? {},
          );
          await fields(
            `${section.toUpperCase()} connection settings`,
            target,
            definitions,
          );
          Object.assign(config, { [section]: target });
        } else if (action === "remove") {
          const token =
            section === "slack"
              ? ((await prompts.choose("Stored credential to remove", [
                  { label: "Bot token", value: tokenName },
                  {
                    label: "Socket Mode app token",
                    value: "SCABBERS_SLACK_APP_TOKEN",
                  },
                ])) as keyof Config["credentialKeys"])
              : tokenName;
          pendingTokens.delete(token);
          removedTokens.add(token);
        } else {
          const token =
            action === "app-token" ? "SCABBERS_SLACK_APP_TOKEN" : tokenName;
          const value = await prompts.secret("Paste token");
          if (value) {
            pendingTokens.set(token, value);
            removedTokens.delete(token);
          }
        }
      }
    } else {
      await fields(
        "Advanced settings",
        config as unknown as Record<string, unknown>,
        [
          {
            key: "repositories",
            label: "Development repositories (JSON array)",
            kind: "json",
          },
          {
            key: "skillPaths",
            label: "Installed skill paths (JSON object)",
            kind: "json",
          },
          {
            key: "aws",
            label: "AWS profile and region (JSON object)",
            kind: "json",
          },
          {
            key: "historySources",
            label: "Selected history files (JSON array)",
            kind: "json",
          },
          {
            key: "soulFile",
            label: "SOUL file (relative to settings directory)",
          },
          { key: "jevKeyParameter", label: "AWS SSM JEV key reference" },
        ],
      );
    }
    for (const name of removedTokens) delete config.credentialKeys[name];
    configuration.validate(config);
    if (
      (await prompts.choose(
        "Save configuration changes? Tokens remain hidden and are stored separately from settings.json.",
        [
          { label: "Save", value: "save" },
          { label: "Discard", value: "discard" },
        ],
      )) !== "save"
    )
      return false;
    if (readFileSync(path, "utf8") !== original)
      throw new Error(
        "Settings changed outside this menu; reopen Config before saving",
      );
    const created: string[] = [];
    try {
      for (const [name, token] of pendingTokens) {
        const reference = credentials.set(token);
        created.push(reference);
        config.credentialKeys[name] = reference;
      }
      configuration.save(config);
    } catch (error) {
      for (const reference of created) credentials.remove(reference);
      throw error;
    }
    for (const name of new Set([...pendingTokens.keys(), ...removedTokens])) {
      const previous = before.credentialKeys[name];
      if (previous && !Object.values(config.credentialKeys).includes(previous))
        credentials.remove(previous);
    }
    return true;
  } finally {
    pendingTokens.clear();
    store.close();
  }
}
