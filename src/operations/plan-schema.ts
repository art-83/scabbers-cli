import { z } from "zod";
const text = z.string().trim().min(1).max(1500);
export const operationalPlanSchema = z
  .object({
    issueKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/),
    summary: text,
    diagnosis: text,
    objective: text,
    evidence: z.array(text).min(1).max(12),
    unknowns: z.array(text).max(12),
    mode: z.enum(["script", "manual"]),
    environment: z.enum(["local", "staging", "production"]),
    targets: z.array(text).min(1).max(10),
    aws: z
      .object({
        accountId: z.string().regex(/^\d{12}$/),
        profile: z.string().regex(/^[\w.@-]+$/),
        region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
      })
      .nullable(),
    steps: z.array(text).min(1).max(15),
    risks: z.array(text).min(1).max(10),
    preconditions: z.array(text).min(1).max(10),
    successCriteria: z.array(text).min(1).max(10),
    testing: text,
    rollback: text,
    idempotency: text,
  })
  .superRefine((plan, ctx) => {
    if (Buffer.byteLength(JSON.stringify(plan)) > 16000)
      ctx.addIssue({
        code: "custom",
        message:
          "Condense the operational plan to at most 16000 bytes while retaining all essential scope and risks",
      });
    if (plan.mode === "script" && plan.environment !== "local" && !plan.aws)
      ctx.addIssue({
        code: "custom",
        path: ["aws"],
        message:
          "Automated remote scripts require a verified AWS account/profile/region; use manual mode for unsupported targets",
      });
  });
