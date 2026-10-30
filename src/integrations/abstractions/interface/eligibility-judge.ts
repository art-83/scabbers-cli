import type { EligibilityForm } from "../../jev/types/eligibility-form.js";
import type { EligibilityVerdict } from "../../types/eligibility-verdict.js";
export interface EligibilityJudge {
  classifyOperational?(
    plan: import("../../../operations/types/operation.js").OperationalPlan,
    blockedNames: string[],
  ): Promise<EligibilityVerdict>;
  classifyFeature?(
    form: import("../../../features/types/feature-form.js").FeatureForm,
    blockedNames: string[],
  ): Promise<EligibilityVerdict>;
  classify(
    form: EligibilityForm,
    blockedNames: string[],
  ): Promise<EligibilityVerdict>;
}
