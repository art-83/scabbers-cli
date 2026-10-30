import type { StageInput } from "../../types/stage-input.js";
export interface BrowserRuntime {
  run<T>(input: StageInput, execute: () => Promise<T>): Promise<T>;
}
