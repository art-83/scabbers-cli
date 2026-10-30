import { OperationalIdentity } from "../plan-identity.js";
import type { OperationalContext, OperationalStage } from "../types/context.js";
import type { Run } from "../../workflows/types/run.js";
import { OperationalResult } from "../result.js";
import {
  operationalImplementationSchema,
  operationalReviewSchema,
} from "../implementation-schema.js";
import { Workflow } from "../../workflows/workflow.js";
import type { OperationalPlan } from "../types/operation.js";
export class OperationalBuilding implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { approvals, store } = this.context;
    if (approvals.answer(run, "plan") !== approvals.option("plan"))
      throw new Error("Plan approval is required before creating scripts");
    const attempts = Number(run.data.operationalBuildAttempts ?? 0);
    if (attempts >= 3)
      throw new Error(
        "Operational implementation still fails review/checks after three bounded preparations; owner revision required",
      );
    run.data.operationalBuildAttempts = attempts + 1;
    store.save(run);
    const bundle = await new OperationalResult(this.context).read(
      run,
      "Create the operational implementation as file contents in JSON; do not execute any file. Stay strictly within operationalPlan approved by the owner. Script mode requires preflight.sh, execute.sh, verify.sh and tests.sh plus any helper sources. Tests use local fixtures only and run inside bubblewrap with /usr read-only, a writable /work copy, no network, no host HOME, secrets or AWS access; PATH is /usr/bin:/bin. Shell and Python standard library are available; include all needed local helper files. Exercise meaningful behavior and failure modes; do not merely grep source or assert true. preflight.sh and verify.sh MUST be read-only and print only JSON {checks:[{criterion:the exact approved criterion,passed:boolean,observed:concrete observed result}]} covering every precondition or success criterion respectively. execute.sh performs only the exact reviewed mutation. No automatic rollback or retry, hidden remote code, embedded credentials or guessed targets. Manual mode creates documentation files only and testCases explaining its non-executable scope. Address saved test output and independent review findings without changing the approved plan. Unknown essential write parameters require manual handling rather than inventing scripts.",
      operationalImplementationSchema,
      signal,
    );
    if (!bundle) return;
    run.data.operationalImplementation = bundle;
    run.data.operationalArtifacts = this.context.scripts.prepare(
      run,
      run.data.operationalPlan as OperationalPlan,
      bundle,
    );
    delete run.data.operationalReview;
    delete run.data.operationalTests;
    delete run.data.executionDecisionId;
    store.save(run);
    new Workflow(store).transition(run, "BUILT");
  }
}
export class OperationalTesting implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { store } = this.context;
    const implementationDigest = new OperationalIdentity().implementation(
      run.data.operationalPlan as OperationalPlan,
      run.data
        .operationalImplementation as import("../types/operation.js").OperationalImplementation,
    );
    this.context.scripts.inspect(
      run.data.operationalPlan as OperationalPlan,
      run.data
        .operationalImplementation as import("../types/operation.js").OperationalImplementation,
      run.data
        .operationalArtifacts as import("../types/operation.js").OperationalArtifacts,
    );
    if ((run.data.operationalPlan as OperationalPlan).mode === "manual")
      run.data.operationalTests = {
        passed: true,
        applicable: false,
        implementationDigest,
        reason: "Manual documentation only; no executable operational script",
      };
    else {
      const result = await this.context.scripts.test(
        run.data
          .operationalArtifacts as import("../types/operation.js").OperationalArtifacts,
        signal,
      );
      run.data.operationalTests = {
        passed: result.code === 0 && !result.truncated,
        ...result,
        implementationDigest,
      };
      store.save(run);
      if (result.code !== 0 || result.truncated) {
        new Workflow(store).transition(run, "REVISE");
        return;
      }
    }
    store.save(run);
    new Workflow(store).transition(run, "TESTED");
  }
}
export class OperationalReviewing implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { store } = this.context;
    const reviewDigest = new OperationalIdentity().implementation(
      run.data.operationalPlan as OperationalPlan,
      run.data
        .operationalImplementation as import("../types/operation.js").OperationalImplementation,
    );
    if (run.data.operationalReviewLaunchDigest !== reviewDigest) {
      delete run.data.reviewSession;
      run.data.operationalReviewLaunchDigest = reviewDigest;
      store.save(run);
    }
    const review =
      run.data.operationalReviewDigest === reviewDigest &&
      run.data.operationalReview
        ? operationalReviewSchema.parse(run.data.operationalReview)
        : await new OperationalResult(this.context).read(
            run,
            "Independently review the approved operational plan, every generated file and real local unit result. Do not execute anything, access production, edit files or approve the operation for the human. Verify the implementation matches exact targets/scope, fixtures meaningfully exercise behavior/failures without external state, credentials are references rather than secrets, and preflight/verification are read-only and assert the approved criteria rather than merely printing success. Flag hidden commands, wildcard scope, dynamic remote code, unsafe output or automatic retries/rollback. Manual mode may approve honest documentation with no executable script; explain test non-applicability. approved=true requires all booleans true and no unresolved findings. This independent review is not the owner's second execution approval.",
            operationalReviewSchema,
            signal,
            true,
          );
    if (!review) return;
    run.data.operationalReview = review;
    run.data.operationalReviewDigest = reviewDigest;
    store.save(run);
    if (
      !review.approved ||
      !review.scopeMatchesPlan ||
      !review.testsMeaningful ||
      !review.verificationMeaningful ||
      !review.credentialFree ||
      !review.checksReadOnly ||
      review.findings.length
    ) {
      new Workflow(store).transition(run, "REVISE");
      return;
    }
    await this.context.documentation.implementation(run);
    new Workflow(store).transition(run, "REVIEWED");
  }
}
