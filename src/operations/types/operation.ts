import type { z } from "zod";
import type { operationalPlanSchema } from "../plan-schema.js";
import type {
  operationalImplementationSchema,
  operationalReviewSchema,
} from "../implementation-schema.js";
export type OperationalPlan = z.infer<typeof operationalPlanSchema>;
export type OperationalImplementation = z.infer<
  typeof operationalImplementationSchema
>;
export type OperationalReview = z.infer<typeof operationalReviewSchema>;
export type OperationalCommandResult = {
  code: number;
  stdout: string;
  truncated: boolean;
  stderr?: string;
};
export type OperationalArtifacts = {
  directory: string;
  digest: string;
  files: string[];
};
