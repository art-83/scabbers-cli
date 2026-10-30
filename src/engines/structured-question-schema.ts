import { z } from "zod";
import { decisionDetailsSchema } from "../decisions/details-schema.js";
import { decisionProposalSchema } from "../decisions/proposal-schema.js";

export const structuredQuestionSchema = z.strictObject({
  text: z.string().trim().min(1),
  decisionContext: z
    .union([
      decisionDetailsSchema,
      z
        .string()
        .trim()
        .min(1)
        .max(1200)
        .transform((summary) => ({ summary })),
    ])
    .optional(),
  decision: decisionProposalSchema.optional(),
});
