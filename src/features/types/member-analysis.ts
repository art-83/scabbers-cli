import type { z } from "zod";
import type { memberAnalysisSchema } from "../member-analysis-schema.js";
export type MemberAnalysis = z.infer<typeof memberAnalysisSchema>;
