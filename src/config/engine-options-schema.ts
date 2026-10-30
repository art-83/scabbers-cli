import { z } from "zod";
const model = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
export const codexOptionsSchema = z.strictObject({
  model: model.optional(),
  effort: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/)
    .max(30)
    .optional(),
});
export const claudeOptionsSchema = z.strictObject({
  model: model.optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
});
export const engineSettingsSchema = z.strictObject({
  codex: codexOptionsSchema.prefault({}),
  claude: claudeOptionsSchema.prefault({}),
});
export const fallbackSchema = z.strictObject({
  enabled: z.boolean().default(false),
  order: z
    .array(z.enum(["codex", "claude"]))
    .min(1)
    .max(2)
    .refine(
      (v) => new Set(v).size === v.length,
      "Fallback engines must be unique",
    )
    .default(["codex", "claude"]),
  cooldownSeconds: z.number().int().min(30).max(86400).default(300),
});
