import type { z } from "zod";
import type { decisionDetailsSchema } from "../details-schema.js";
export type DecisionDetails = z.infer<typeof decisionDetailsSchema>;
export type DecisionContext = {
  version: 1;
  decisionVersion: number;
  label: string;
  stage: string;
  title: string;
  issueKey?: string;
  issueUrl?: string;
  summary: string;
  problem: string;
  whyHuman: string;
  technical: boolean;
};
