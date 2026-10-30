import { z } from "zod";
export const decisionDetailsSchema = z.strictObject({
  summary: z.string().trim().min(1).max(1200),
  problem: z.string().trim().min(1).max(1200).optional(),
  whyHuman: z.string().trim().min(1).max(800).optional(),
});
