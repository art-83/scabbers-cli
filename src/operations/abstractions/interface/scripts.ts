import type { Run } from "../../../workflows/types/run.js";
import type {
  OperationalArtifacts,
  OperationalPlan,
  OperationalImplementation,
  OperationalCommandResult,
} from "../../types/operation.js";
export interface OperationalScripts {
  prepare(
    run: Run,
    plan: OperationalPlan,
    bundle: OperationalImplementation,
  ): OperationalArtifacts;
  inspect(
    plan: OperationalPlan,
    bundle: OperationalImplementation,
    artifacts: OperationalArtifacts,
  ): void;
  test(
    artifacts: OperationalArtifacts,
    signal: AbortSignal,
  ): Promise<OperationalCommandResult>;
  execute(run: Run, signal: AbortSignal): Promise<OperationalCommandResult>;
  verify(run: Run, signal: AbortSignal): Promise<OperationalCommandResult>;
}
