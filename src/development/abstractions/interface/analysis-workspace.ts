import type { Config } from "../../../config/types/config.js";
export interface AnalysisWorkspace {
  prepareAnalysis(
    runId: string,
    repositories: Config["repositories"],
    signal?: AbortSignal,
  ): Promise<Record<string, string>>;
  revisions(
    paths: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Record<string, string>>;
}
