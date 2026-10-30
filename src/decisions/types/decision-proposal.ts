import type { z } from "zod";
import type { decisionProposalSchema } from "../proposal-schema.js";
export type DecisionProposal = z.infer<typeof decisionProposalSchema>;
