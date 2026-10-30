import { createHash } from "node:crypto";
import { operationalPlanSchema } from "./plan-schema.js";
import { operationalImplementationSchema } from "./implementation-schema.js";
import type {
  OperationalPlan,
  OperationalImplementation,
} from "./types/operation.js";
export class OperationalIdentity {
  plan(plan: OperationalPlan): string {
    return this.hash(operationalPlanSchema.parse(plan));
  }
  implementation(
    plan: OperationalPlan,
    bundle: OperationalImplementation,
  ): string {
    return this.hash({
      plan: operationalPlanSchema.parse(plan),
      implementation: operationalImplementationSchema.parse(bundle),
    });
  }
  hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  assertCredentialFree(value: unknown): void {
    const text = JSON.stringify(value);
    if (
      /\b(?:xox[baprs]-[\w-]+|AKIA[A-Z0-9]{16}|glpat-[\w-]+|sk-proj-[\w-]{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b|BEGIN [A-Z ]*PRIVATE KEY|(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{20,}/i.test(
        text,
      )
    )
      throw new Error(
        "Possible credentials in operational artifacts; use local credential references instead of literal secrets",
      );
  }
}
