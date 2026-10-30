import type { EligibilityJudge } from "../abstractions/interface/eligibility-judge.js";
import type { EligibilityVerdict } from "../types/eligibility-verdict.js";
import type { EligibilityForm } from "./types/eligibility-form.js";
import type { Config } from "../../config/types/config.js";
import { Secrets } from "../secrets.js";
import { JevClient } from "./jev-client.js";
export class ConfiguredJudge implements EligibilityJudge {
  constructor(private readonly config: Config) {}
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
