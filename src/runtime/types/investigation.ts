import type { StageResult } from "../../engines/types/stage-result.js";
export type InvestigationRecord = {
  fingerprint: string;
  stage: string;
  skill: string;
  engine: string;
  at: number;
  member?: string | undefined;
  revisions: unknown;
  result: StageResult;
  delivered: boolean;
  consumed: boolean;
};
