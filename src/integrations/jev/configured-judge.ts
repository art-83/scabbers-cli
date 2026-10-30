import type { EligibilityJudge } from "../abstractions/interface/eligibility-judge.js";
import type { EligibilityVerdict } from "../types/eligibility-verdict.js";
import type { EligibilityForm } from "./types/eligibility-form.js";
import type { Config } from "../../config/types/config.js";
import { Secrets } from "../secrets.js";
import { JevClient } from "./jev-client.js";
export class ConfiguredJudge implements EligibilityJudge {
  async classifyOperational(
    plan: import("../../operations/types/operation.js").OperationalPlan,
    blockedNames: string[],
  ): Promise<EligibilityVerdict> {
    const key = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("TYPESAFE_API_KEY", this.config.jevKeyParameter);
    return new JevClient(key).classifyOperational(plan, blockedNames);
  }
  constructor(private readonly config: Config) {}
  async classifyFeature(
    form: import("../../features/types/feature-form.js").FeatureForm,
    blockedNames: string[],
  ): Promise<EligibilityVerdict> {
    const key = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("TYPESAFE_API_KEY", this.config.jevKeyParameter);
    return new JevClient(key).classifyFeature(form, blockedNames);
  }
  async classify(
    form: EligibilityForm,
    blockedNames: string[],
  ): Promise<EligibilityVerdict> {
    const key = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("TYPESAFE_API_KEY", this.config.jevKeyParameter);
    return new JevClient(key).classify(form, blockedNames);
  }
}
