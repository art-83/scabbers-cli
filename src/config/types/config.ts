import { z } from "zod";
import { browserSchema } from "./browser.js";
import { scheduleSchema } from "./schedule.js";
export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  paths: z.array(z.string().trim().min(1)).default([]),
  soulFile: z.string().min(1).optional(),
  browser: browserSchema.default({}),
  version: z.literal(1).default(1),
  engine: z.enum(["claude", "codex"]).default("claude"),
  workers: z.number().int().min(1).max(16).default(3),
  remoteEnabled: z.boolean().default(false),
  credentialKeys: z
    .partialRecord(
      z.enum([
        "SCABBERS_SLACK_BOT_TOKEN",
        "SCABBERS_SLACK_APP_TOKEN",
        "SCABBERS_JIRA_TOKEN",
        "SCABBERS_GITLAB_TOKEN",
        "TYPESAFE_API_KEY",
      ]),
      z.string().regex(/^local:[0-9a-f-]{36}$/),
    )
    .default({}),
  slack: z
    .strictObject({
      channel: z.string().default("C0BU8TX3NTW"),
      reportBotIds: z.array(z.string()).default(["B0C0B2WU7PU"]),
      user: z
        .string()
        .regex(/^U[A-Z0-9]+$/)
        .optional(),
      tokenParameter: z.string().optional(),
      appTokenParameter: z.string().optional(),
    })
    .default({ channel: "C0BU8TX3NTW", reportBotIds: ["B0C0B2WU7PU"] }),
  schedule: scheduleSchema.optional(),
  jira: z
    .strictObject({
      baseUrl: z.url(),
      email: z.email(),
      accountId: z.string(),
      project: z.string(),
      routingFields: z.record(z.string(), z.unknown()).default({}),
      copyReportFields: z.array(z.string()).default([]),
    })
    .optional(),
  gitlab: z
    .strictObject({
      baseUrl: z.url().default("https://gitlab.com"),
      projectId: z.string(),
    })
    .optional(),
  repositories: z
    .array(
      z.strictObject({
        name: z.enum(["arccanet-backend", "arccanet-frontend", "arcca-pdv"]),
        path: z.string(),
        stagingUrl: z.url(),
        stagingRef: z.literal("staging").default("staging"),
        gitlabProjectId: z.string().optional(),
        testCommand: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  skillPaths: z.record(z.string(), z.string()).default({}),
  historySources: z.array(z.string()).default([]),
  aws: z
    .strictObject({
      profile: z.string().optional(),
      region: z.string().optional(),
    })
    .default({}),
  jevKeyParameter: z.string().optional(),
});
export type Config = z.infer<typeof configSchema>;
