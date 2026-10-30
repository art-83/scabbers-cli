import { z } from "zod";
import type { OperationalContext } from "./types/context.js";
import type { Run } from "../workflows/types/run.js";
import { Workflow } from "../workflows/workflow.js";
import { operationalPlanSchema } from "./plan-schema.js";
export class OperationalResult {
  constructor(private readonly context: OperationalContext) {}
  async read<T>(
    run: Run,
    instruction: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    fresh = false,
  ): Promise<T | undefined> {
    const cwd =
      Object.values(
        (run.data.analysisWorkspaces ?? {}) as Record<string, string>,
      )[0] ??
      this.context.config.repositories[0]?.path ??
      process.cwd();
    const result = await this.context.executor.execute(
      run,
      instruction +
        "\nReturn data matching this exact schema: " +
        JSON.stringify(z.toJSONSchema(schema)),
      fresh
        ? "nola-engineering:code-review"
        : "nola-engineering:solution-analysis",
      "read",
      cwd,
      signal,
      fresh,
    );
    if (result.status === "question" && run.state === "investigating") {
      const decision = await this.context.decisions.ask(
        run.id,
        result.question ?? result.summary,
        result.options,
        Date.now(),
        result.decision,
        result.decisionContext ?? { summary: result.summary.slice(0, 1200) },
      );
      run.data.operationalQuestionId = decision.id;
      this.context.store.save(run);
      new Workflow(this.context.store).transition(run, "ASK");
      return undefined;
    }
    const manualPlan =
      run.state === "investigating" && result.status === "blocked"
        ? operationalPlanSchema.safeParse(
            result.data.creationPlan ?? result.data,
          )
        : undefined;
    if (manualPlan?.success && manualPlan.data.mode === "manual") {
      const compatible = schema.safeParse(manualPlan.data);
      if (compatible.success) {
        run.data.operationalPreparationLimitations = {
          summary: result.summary,
          evidence: result.evidence,
          missingCapabilities: result.data.missingCapabilities ?? [],
        };
        this.context.store.save(run);
        return compatible.data;
      }
    }
    if (result.status !== "passed")
      throw new Error(
        "Operational preparation needs verified evidence: " +
          (result.question ?? result.summary),
      );
    const parsed = schema.safeParse(result.data);
    if (parsed.success) {
      delete run.data.operationalRepair;
      this.context.store.save(run);
      return parsed.data;
    }
    const previous = run.data.operationalRepair as
      { stage: string; attempts: number } | undefined;
    const attempts = previous?.stage === run.state ? previous.attempts : 0;
    if (attempts >= 2)
      throw new Error(
        "Operational generated contract remains invalid after two repairs",
      );
    run.data.operationalRepair = {
      stage: run.state,
      attempts: attempts + 1,
      rejected: result.data,
      diagnostic: parsed.error.message,
    };
    this.context.store.save(run);
    return this.read(
      run,
      "Repair only the invalid operational contract in operationalRepair. Preserve the approved scope and both human approval requirements; do not ask a product question merely to repair formatting. " +
        instruction,
      schema,
      signal,
      fresh,
    );
  }
}
