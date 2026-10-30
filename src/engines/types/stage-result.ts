import { decisionProposalSchema } from "../../decisions/proposal-schema.js";
import { z } from "zod";
export const stageResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked", "question"]),
  summary: z.string().min(1),
  evidence: z.array(z.string()).min(1),
  question: z.string().nullable(),
  options: z.array(z.string()),
  decision: decisionProposalSchema.optional(),
  data: z.record(z.string(), z.unknown()),
});
export type StageResult = z.infer<typeof stageResultSchema>;
