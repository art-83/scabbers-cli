import type { Family } from "../features/types/family.js";
import { featureFormSchema } from "../features/feature-form-schema.js";
import { FamilyPolicy } from "../features/family-policy.js";
import type { Run } from "./types/run.js";
import type { Store } from "../storage/store.js";
import { ScopePolicy } from "../development/scope-policy.js";
export class WorkflowEvidence {
  constructor(private readonly store: Store) {}
  assert(run: Run, event: string): void {
    const store = this.store;
    if (run.kind === "support") return;
    const need = (valid: unknown, reason: string) => {
      if (!valid) throw new Error(reason);
    };
    const green = (value: unknown) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((r) => r.code === 0);
    if (event === "ELIGIBLE") {
      need(
        (run.data.jev as any)?.classification === "A-candidate",
        "JEV must approve a bounded candidate",
      );
      if (run.kind === "feature") {
        const family = run.data.family as Family;
        const form = featureFormSchema.parse(run.data.featureForm);
        new FamilyPolicy().coverage(
          form,
          family,
          run.data.scopeMembers as string[],
        );
        need(
          family?.complete &&
            run.data.scopeVerified ===
              `eligibility:${run.data.deliveryAttempt ?? 0}`,
          "Complete, freshly verified feature family required",
        );
      }
      const form = run.data.form as any;
      new ScopePolicy().assert(form?.repositories ?? [], form?.products ?? []);
    }
    if (event === "FAILING") {
      need(green(run.data.baselineTests), "Pre-change test baseline must pass");
      need(
        Array.isArray(run.data.regressionTests) &&
          run.data.regressionTests.some((r) => r.code !== 0),
        "A real failing regression must precede the fix",
      );
      need(
        (run.data.regressionEvidence as any)?.status === "passed",
        "Failure must be attributed to the defect assertion",
      );
    }
    if (event === "GREEN")
      need(
        green(
          run.state === "fixing"
            ? run.data.fixingTests
            : run.state === "findings"
              ? run.data.findingsTests
              : run.data.finalTests,
        ),
        "Configured tests must be green at this checkpoint",
      );
    if (event === "REVIEWED")
      need(
        run.data.reviewStarted === true &&
          typeof run.data.reviewSession === "string" &&
          run.data.reviewSession !== run.sessionId &&
          !!run.data.review,
        "One fresh native review session is mandatory",
      );
    if (event === "PUBLISHED")
      need(
        run.data.publications &&
          Object.keys(run.data.publications as object).length,
        "Verified publication checkpoints required",
      );
    if (event === "DEPLOYED")
      need(
        run.data.readiness && Object.keys(run.data.readiness as object).length,
        "Expected staging revision, CI and deployment must be verified",
      );
    if (event === "PASSED")
      need(
        (run.data.e2e as any)?.status === "passed" &&
          (run.data.e2e as any)?.evidence?.length,
        "Observed native-browser E2E evidence required",
      );
    if (event === "VALIDATED")
      need(
        store.db
          .prepare(
            "SELECT id FROM decisions WHERE runId=? AND status='answered' AND question LIKE ? AND answer='Validated'",
          )
          .get(
            run.id,
            Number(run.data.deliveryAttempt ?? 0) > 0
              ? `Validate staging result attempt ${run.data.deliveryAttempt}:%`
              : "Validate staging result%",
          ),
        "Authenticated human staging validation is mandatory",
      );
  }
}
