import type { PlanRepair } from "./types/plan-repair.js";
import { z } from "zod";
import type { Store } from "../storage/store.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Run } from "../workflows/types/run.js";
import type { FeatureForm } from "./types/feature-form.js";
import type { Family } from "./types/family.js";
import { featureFormSchema } from "./feature-form-schema.js";
import { FamilyPolicy } from "./family-policy.js";

/** Repairs a generated plan's contract; never weakens verified family/scope guards. */
export class ValidatedPlan {
  constructor(
    private readonly store: Store,
    private readonly executor: StageRunner,
  ) {}
  async read(
    run: Run,
    data: unknown,
    cwd: string,
    signal: AbortSignal,
  ): Promise<FeatureForm> {
    let candidate = data;
    for (;;) {
      signal.throwIfAborted();
      let validated: FeatureForm | undefined;
      let diagnostic = "Invalid feature plan";
      try {
        const form = featureFormSchema.parse(candidate);
        new FamilyPolicy().coverage(
          form,
          run.data.family as Family,
          run.data.scopeMembers as string[],
        );
        validated = form;
      } catch (error) {
        diagnostic =
          error instanceof z.ZodError
            ? JSON.stringify(
                error.issues.map((issue) => ({
                  path: issue.path,
                  message: issue.message,
                })),
              )
            : error instanceof Error
              ? error.message
              : "Invalid feature plan";
      }
      if (validated) {
        delete run.data.planRepair;
        this.store.save(run);
        return validated;
      }
      const previous = run.data.planRepair as PlanRepair | undefined;
      const attempts = previous?.attempts ?? 0;
      if (attempts >= 2)
        throw new Error(
          "Generated feature plan remains invalid after two automatic repairs; maintainer correction required: " +
            diagnostic.slice(0, 2000),
        );
      if (Buffer.byteLength(JSON.stringify(candidate)) > 120000)
        throw new Error(
          "Invalid generated plan exceeds repair input budget; maintainer inspection required",
        );
      run.data.planRepair = {
        attempts: attempts + 1,
        rejected: candidate,
        diagnostic,
      };
      this.store.save(run);
      this.store.log(
        run.id,
        `Repairing generated feature plan contract (attempt ${attempts + 1}/2)`,
      );
      const result = await this.executor.execute(
        run,
        "Repair the rejected generated feature plan in planRepair using its diagnostic and verified family evidence. Return the FULL corrected form, not a patch. coverage.dependencies must contain only exact verified Jira card keys. Put descriptive technical prerequisites in coverage.technicalPrerequisites or approach. Never invent cards, drop family coverage, expand scope, change human answers or request human help merely to repair this format. No edits, network or publication. Schema: " +
          JSON.stringify(z.toJSONSchema(featureFormSchema)),
        "nola-engineering:solution-analysis",
        "read",
        cwd,
        signal,
      );
      if (result.status !== "passed")
        throw new Error(
          "Automatic feature plan repair did not return a valid candidate; maintainer inspection required",
        );
      candidate = result.data;
    }
  }
}
