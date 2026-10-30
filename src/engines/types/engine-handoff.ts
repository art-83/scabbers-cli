import type { EngineId, EngineOptions } from "./engine-options.js";
export type EngineHandoff = {
  from: EngineId;
  to: EngineId;
  stage: string;
  at: number;
  reason: "quota";
  sourceSession: string | null;
  targetSession: string | null;
};
export type EngineSession = { id: string | null; options: EngineOptions };
export type EngineSessions = Partial<Record<EngineId, EngineSession>>;
