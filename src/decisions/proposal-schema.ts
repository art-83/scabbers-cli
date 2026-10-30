import { z } from "zod";
export const decisionProposalSchema = z
  .strictObject({
    choices: z
      .array(
        z.strictObject({
          label: z.string().trim().min(1).max(500),
          consequence: z.string().trim().min(1).max(1000),
        }),
      )
      .min(2)
      .max(5),
    recommendedIndex: z.number().int().min(0).nullable(),
    reason: z.string().trim().min(1).max(1500),
  })
  .refine(
    (p) => p.recommendedIndex === null || p.recommendedIndex < p.choices.length,
    "Recommendation must identify an offered choice",
  )
  .refine(
    (p) => new Set(p.choices.map((c) => c.label)).size === p.choices.length,
    "Decision choices must be distinct",
  );
