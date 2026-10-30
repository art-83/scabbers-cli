import type { EligibilityForm } from "../../jev/types/eligibility-form.js";
import type { EligibilityVerdict } from "../../types/eligibility-verdict.js";
export interface EligibilityJudge {
  classify(
    form: EligibilityForm,
    blockedNames: string[],
  ): Promise<EligibilityVerdict>;
}
