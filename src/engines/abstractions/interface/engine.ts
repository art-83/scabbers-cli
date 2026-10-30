import type { StageInput } from "../../types/stage-input.js";
import type { StageResult } from "../../types/stage-result.js";
import type { Capabilities } from "../../types/capabilities.js";
export interface Engine {
  readonly id: "claude" | "codex";
  readonly capabilities: Capabilities;
  execute(input: StageInput): Promise<StageResult>;
}
