import { decisionDetailsSchema } from "../../../decisions/details-schema.js";
import { decisionProposalSchema } from "../../../decisions/proposal-schema.js";
import { z } from "zod";
export const eligibilitySchema = z.object({
  nature: z.object({
    trigger: z.string(),
    expected: z.string(),
    observed: z.string(),
  }),
  component: z.string(),
  environment: z.string(),
  repositories: z.array(z.string()),
  products: z.array(z.string()),
  issueType: z.string(),
  labels: z.array(z.string()),
  domains: z.array(z.string()),
  root_cause: z.object({
    claim: z.string(),
    status: z.enum(["confirmed", "traced_in_code", "hypothesis", "unknown"]),
  }),
  evidence: z
    .array(
      z.object({ kind: z.string(), excerpt: z.string(), source: z.string() }),
    )
    .min(1)
    .max(6),
  code: z
    .array(
      z.object({
        repository: z.string(),
        path: z.string(),
        line: z.number().int().positive(),
        excerpt: z.string(),
      }),
    )
    .max(3),
  proposed_fix: z.object({
    summary: z.string(),
    files: z.array(z.string()),
    failing_test: z.string(),
  }),
  reproduction: z.object({
    attempted: z.boolean(),
    result: z.enum([
      "reproduced",
      "not_reproduced",
      "sampled",
      "not_attempted",
    ]),
  }),
  open_decisions: z
    .array(
      z.object({
        question: z.string(),
        proposed_default: z.string().nullable(),
        proposal: decisionProposalSchema.optional(),
        context: decisionDetailsSchema.optional(),
      }),
    )
    .max(6),
  risks: z.array(z.string()),
  requires_outside_code: z.object({
    needed: z.boolean(),
    action: z.enum(["read", "change"]),
    what: z.string(),
  }),
});
export type EligibilityForm = z.infer<typeof eligibilitySchema>;
