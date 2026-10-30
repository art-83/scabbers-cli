import { z } from "zod";
import type { Store } from "../storage/store.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Run } from "../workflows/types/run.js";
import type { MemberAnalysis } from "./types/member-analysis.js";
import type { MemberRepair } from "./types/member-repair.js";
import { memberAnalysisSchema } from "./member-analysis-schema.js";

/** Repairs only the current member's generated data, preserving the collected analysis. */
export class ValidatedMemberAnalysis {
  constructor(
    private readonly store: Store,
    private readonly executor: StageRunner,
  ) {}
  async read(
    run: Run,
    key: string,
    data: unknown,
    cwd: string,
    signal: AbortSignal,
  ): Promise<MemberAnalysis> {
    const schema = memberAnalysisSchema.extend({ key: z.literal(key) });
    let candidate = data;
    for (;;) {
      signal.throwIfAborted();
      const parsed = schema.safeParse(candidate);
      if (parsed.success) {
        delete run.data.memberRepair;
        this.store.save(run);
        return parsed.data;
      }
      const previous = run.data.memberRepair as MemberRepair | undefined;
      const attempts = previous?.target === key ? previous.attempts : 0;
      if (attempts >= 2)
        throw new Error(
          "Generated member analysis remains invalid after two automatic repairs; maintainer correction required for " +
            key,
        );
      if (Buffer.byteLength(JSON.stringify(candidate)) > 120000)
        throw new Error(
          "Generated member analysis exceeds the repair input budget; maintainer inspection required",
        );
      run.data.memberRepair = {
        target: key,
        attempts: attempts + 1,
        rejected: candidate,
        diagnostic: JSON.stringify(
          parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        ),
      } satisfies MemberRepair;
      this.store.save(run);
      this.store.log(
        run.id,
        `Repairing generated member analysis contract for ${key} (attempt ${attempts + 1}/2)`,
      );
      const result = await this.executor.execute(
        run,
        "Repair only the rejected current member analysis in memberRepair. Return the FULL corrected data object for the same target key. approach must be one plain-text string, not a structured object; preserve the supported recommendation, implementation boundaries and relevant sections in that text. Preserve evidence and authenticated owner decisions; do not fabricate facts, edit code, use network, or ask a product question merely to repair this format. Schema: " +
          JSON.stringify(z.toJSONSchema(schema)),
        "nola-engineering:solution-analysis",
        "read",
        cwd,
        signal,
      );
      if (result.status !== "passed")
        throw new Error(
          "Automatic member analysis repair did not return a valid candidate; maintainer inspection required for " +
            key,
        );
      candidate = result.data;
    }
  }
}
