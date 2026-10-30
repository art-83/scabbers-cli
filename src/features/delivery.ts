import type { Family } from "./types/family.js";
import type { FamilyVerification } from "./types/family-verification.js";
import type { Run } from "../workflows/types/run.js";
import type { Store } from "../storage/store.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { Config } from "../config/types/config.js";
import { Hierarchy } from "./hierarchy.js";
import { FamilyPolicy } from "./family-policy.js";
import { JiraCard } from "./jira-card.js";
export class FeatureDelivery {
  constructor(
    private readonly store: Store,
    private readonly jira: IssueTracker,
    private readonly config: Config,
  ) {}
  async verifyScope(run: Run): Promise<boolean> {
    const store = this.store,
      jira = this.jira;
    const hierarchy = new Hierarchy(jira);
    const original = run.data.family as Family;
    if (!original?.complete)
      throw new Error("Complete feature family evidence is required");
    const checkpoint = `${run.state}:${run.data.deliveryAttempt ?? 0}`;
    let verification = run.data.familyVerification as
      FamilyVerification | undefined;
    if (verification?.checkpoint !== checkpoint)
      verification = { checkpoint, state: hierarchy.create(original.root) };
    for (let i = 0; i < 20 && !verification.state.complete; i++) {
      await hierarchy.step(verification.state);
      run.data.familyVerification = verification;
      store.save(run);
    }
    if (!verification.state.complete) {
      store.log(
        run.id,
        "Development scope verification continues from a saved hierarchy checkpoint",
      );
      return false;
    }
    const current = hierarchy.complete(verification.state);
    if (current.digest !== original.digest) {
      run.data.scopeChanged = true;
      store.save(run);
      throw new Error(
        "Jira requirements or family membership changed. Cancel this pinned delivery and preview the revised family; the running plan cannot be replaced silently",
      );
    }
    const blocker = new FamilyPolicy().blocker(
      current,
      (run.data.claimedMembers ?? []) as string[],
    );
    if (blocker) throw new Error(blocker);
    if (
      (run.data.scopeMembers as string[]).some((key) =>
        current.members.some((i) => i.key === key && new JiraCard(i).isDone),
      )
    )
      throw new Error(
        "Selected feature work was completed concurrently; review scope before proceeding",
      );
    delete run.data.familyVerification;
    delete run.data.scopeChanged;
    run.data.scopeVerified = checkpoint;
    store.save(run);
    return true;
  }
  async recordProgress(
    run: Run,
    checkpoint: "claim" | "documented" | "validated",
    text: string,
  ): Promise<void> {
    const store = this.store,
      jira = this.jira,
      config = this.config;
    const family = run.data.family as Family;
    const claimed = new Set((run.data.claimedMembers ?? []) as string[]);
    for (const key of run.data.scopeMembers as string[]) {
      const issue = family.members.find((i) => i.key === key)!;
      if (new JiraCard(issue).isDone) continue;
      const mapping =
        config.development.transitions[
          `${issue.fields.project.key}/${issue.fields.issuetype.name}`
        ];
      // Workflow names differ by project/type. Unmapped cards receive evidence, never a guessed status.
      if (mapping) {
        await jira.transition(
          run.id,
          key,
          mapping[checkpoint],
          `${checkpoint}:${key}:attempt-${run.data.deliveryAttempt ?? 0}`,
        );
        claimed.add(key);
        run.data.claimedMembers = [...claimed];
        store.save(run);
      }
      await jira.comment(
        run.id,
        key,
        `${text}\nEntrega agrupada: ${family.root}. Escopo desta entrega: ${(run.data.scopeMembers as string[]).join(", ")}.${mapping ? "" : " Status preservado: nenhum mapeamento de workflow configurado para este projeto/tipo."}`,
        `${checkpoint}:${key}:attempt-${run.data.deliveryAttempt ?? 0}`,
      );
    }
  }
}
