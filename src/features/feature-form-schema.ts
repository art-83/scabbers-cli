import { z } from "zod";
import { eligibilitySchema } from "../integrations/jev/types/eligibility-form.js";

export const featureFormSchema = eligibilitySchema
  .omit({
    nature: true,
    root_cause: true,
    reproduction: true,
    proposed_fix: true,
  })
  .extend({
    code: eligibilitySchema.shape.code.min(1),
    request: z.string().min(1),
    baseline: z.string().min(1),
    coverage: z
      .array(
        z.object({
          key: z.string(),
          acceptance: z.array(z.string().min(1)).min(1),
          approach: z.string().min(1),
          dependencies: z.array(z.string()),
          disposition: z.enum(["implement", "context"]),
        }),
      )
      .min(1),
    implementation: z.object({
      summary: z.string().min(1),
      files: z.array(z.string().min(1)).min(1),
      failing_test: z.string().min(1),
    }),
  });
