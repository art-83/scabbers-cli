import { z } from "zod";
export const memberAnalysisSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/),
  summary: z.string().min(1).max(2000),
  acceptance: z.array(z.string().min(1).max(1000)).min(1).max(30),
  approach: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "A single plain-text explanation, not an object or an array. Include the relevant recommendation and boundaries in this text.",
    ),
  dependencies: z
    .array(z.string().max(1000))
    .max(100)
    .describe(
      "Descriptive prerequisites for this member analysis; the final coverage plan uses exact Jira keys separately.",
    ),
});
