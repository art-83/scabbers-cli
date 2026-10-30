import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import { OperationalApprovalProof } from "./approval-proof.js";
import { operationalPlanSchema } from "./plan-schema.js";
import {
  operationalImplementationSchema,
  operationalReviewSchema,
} from "./implementation-schema.js";
export class OperationalEvidence {
  constructor(private readonly store: Store) {}
  assert(run: Run, event: string): void {
    const approvals = new OperationalApprovalProof(
      this.store,
      String(run.data.ownerSlackUser),
    );
    if (event === "PLAN") operationalPlanSchema.parse(run.data.operationalPlan);
    if (
      event === "MANUAL_PLAN" &&
      (operationalPlanSchema.parse(run.data.operationalPlan).mode !==
        "manual" ||
        run.data.operationalPlanDocumented !== true)
    )
      throw new Error(
        "A documented manual plan is required for a documentation-only handoff",
      );
    if (
      event === "PLAN_APPROVED" &&
      approvals.answer(run, "plan") !== approvals.option("plan")
    )
      throw new Error(
        "Explicit approval of this exact operational plan is required before building",
      );
    if (event === "BUILT")
      operationalImplementationSchema.parse(run.data.operationalImplementation);
    if (
      event === "TESTED" &&
      !(run.data.operationalTests as { passed?: boolean } | undefined)?.passed
    )
      throw new Error("Operational unit checks must pass before review");
    if (["REVIEWED", "EXECUTION_APPROVED"].includes(event)) {
      const review = operationalReviewSchema.parse(run.data.operationalReview);
      if (
        !review.approved ||
        !review.scopeMatchesPlan ||
        !review.testsMeaningful ||
        !review.verificationMeaningful ||
        !review.credentialFree ||
        !review.checksReadOnly ||
        review.findings.length > 0 ||
        !run.data.reviewSession ||
        run.data.reviewSession === run.sessionId
      )
        throw new Error(
          "An independent approved operational implementation review is required",
        );
      if (
        !(run.data.operationalTests as { passed?: boolean } | undefined)?.passed
      )
        throw new Error("Operational unit checks must pass");
    }
    if (event === "EXECUTION_APPROVED") approvals.assertExecution(run);
    if (
      event === "EXECUTED" &&
      ((
        run.data.operationalExecution as
          { status?: string; code?: number } | undefined
      )?.status !== "completed" ||
        (run.data.operationalExecution as { code?: number } | undefined)
          ?.code !== 0)
    )
      throw new Error("Observed operational execution receipt required");
    if (
      event === "VERIFIED" &&
      !(run.data.operationalVerification as { passed?: boolean } | undefined)
        ?.passed
    )
      throw new Error("Observed operational read-back checks required");
    if (event === "DOCUMENTED" && run.data.operationalDocumented !== true)
      throw new Error(
        "Operational result documentation and notification required",
      );
  }
}
