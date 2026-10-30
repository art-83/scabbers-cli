import type { Run } from "../../../workflows/types/run.js";
import type { StageResult } from "../../types/stage-result.js";
export interface StageRunner {
  execute(
    run: Run,
    instruction: string,
    skill: string,
    mode: "read" | "edit" | "browser",
    cwd: string,
    signal: AbortSignal,
    fresh?: boolean,
  ): Promise<StageResult>;
}
