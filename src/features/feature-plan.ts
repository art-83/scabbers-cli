import type { FeatureForm } from "./types/feature-form.js";
import {
  eligibilitySchema,
  type EligibilityForm,
} from "../integrations/jev/types/eligibility-form.js";
// Shared delivery mechanics consume a common file/test plan; eligibility remains feature-specific.
export class FeaturePlan {
  toDelivery(form: FeatureForm): EligibilityForm {
    return eligibilitySchema.parse({
      ...form,
      nature: {
        trigger: form.request,
        expected: form.request,
        observed: form.baseline,
      },
      root_cause: {
        claim: form.implementation.summary,
        status: "traced_in_code",
      },
      reproduction: { attempted: false, result: "not_attempted" },
      proposed_fix: form.implementation,
    });
  }
}
