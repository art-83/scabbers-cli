import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import { Secrets } from "../integrations/secrets.js";
import { JiraClient } from "../integrations/jira/jira-client.js";
import { FeatureIntake } from "./intake.js";
import { IntakePresenter } from "./intake-presenter.js";
import type { PreviewSummary } from "./types/intake-status.js";
export class PreviewService {
  constructor(
    private readonly store: Store,
    private readonly config: Config,
  ) {}
  async check(restart = false): Promise<PreviewSummary> {
    if (!this.config.jira)
      throw new Error("Configure Jira before previewing Development intake");
    const token = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("SCABBERS_JIRA_TOKEN");
    const intake = new FeatureIntake(
      this.store,
      this.config,
      new JiraClient(this.config.jira, token, this.store),
    );
    return new IntakePresenter().summary(
      await intake.advance(true, 40, restart),
    )!;
  }
}
