import { memberAnalysisSchema } from "./member-analysis-schema.js";
import { ValidatedMemberAnalysis } from "./validated-member-analysis.js";
import type { DecisionDetails } from "../decisions/types/decision-context.js";
import { ValidatedPlan } from "./validated-plan.js";
import type { DecisionProposal } from "../decisions/types/decision-proposal.js";
import { z } from "zod";
import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { DecisionService } from "../decisions/decision-service.js";
import { Workflow } from "../workflows/workflow.js";
import { ScopePolicy } from "../development/scope-policy.js";
import { privateNames } from "../integrations/jira/private-names.js";
import type { Family } from "./types/family.js";
import type { FeatureForm } from "./types/feature-form.js";
import { featureFormSchema } from "./feature-form-schema.js";
import { FeaturePlan } from "./feature-plan.js";
import { FamilyPolicy } from "./family-policy.js";
export class FeatureAnalysis {
  private readonly workflow: Workflow;
  constructor(
    private readonly store: Store,
    private readonly executor: StageRunner,
    private readonly decisions: DecisionService,
  ) {
    this.workflow = new Workflow(store);
  }
  async resolveDecisions(run: Run, signal: AbortSignal): Promise<boolean> {
    const feature = featureFormSchema.parse(run.data.featureForm);
    const applied = (run.data.appliedFeatureDecisions ?? []) as string[];
    const answers = this.decisions
      .list()
      .filter(
        (d) =>
          d.runId === run.id &&
          d.status === "answered" &&
          !applied.includes(d.id) &&
          feature.open_decisions.some((q) => q.question === d.question),
      );
    if (answers.length) {
      run.data.featureDecisionAnswers = answers.map((d) => ({
        question: d.question,
        answer: d.answer,
      }));
      this.store.save(run);
      const result = await this.executor.execute(
        run,
        "Revise the complete feature plan using the authenticated featureDecisionAnswers. Resolve answered decisions explicitly, preserve family coverage, and return the full feature form. If an answer is ambiguous, ask a clarification instead of assuming the proposed default. Schema: " +
          JSON.stringify(z.toJSONSchema(featureFormSchema)),
        "nola-engineering:solution-analysis",
        "read",
        Object.values(
          run.data.analysisWorkspaces as Record<string, string>,
        )[0]!,
        signal,
      );
      if (result.status !== "passed") {
        await this.ask(
          run,
          result.question ?? result.summary,
          result.options,
          result.decision,
          result.decisionContext ?? { summary: result.summary.slice(0, 1200) },
        );
        return true;
      }
      const updated = await new ValidatedPlan(this.store, this.executor).read(
        run,
        result.data,
        Object.values(
          run.data.analysisWorkspaces as Record<string, string>,
        )[0]!,
        signal,
      );
      if (
        updated.open_decisions.some((q) =>
          answers.some((a) => a.question === q.question),
        )
      )
        throw new Error(
          "Answered feature decision is still unresolved; clarification required before implementation",
        );
      this.acceptFeatureForm(run, updated);
      run.data.appliedFeatureDecisions = [
        ...applied,
        ...answers.map((d) => d.id),
      ];
      delete run.data.jev;
      this.store.save(run);
      return true;
    }
    return false;
  }
  async investigate(run: Run, cwd: string, signal: AbortSignal): Promise<void> {
    if (run.data.featurePlanCandidate) {
      signal.throwIfAborted();
      this.acceptFeatureForm(
        run,
        featureFormSchema.parse(run.data.featurePlanCandidate),
      );
      this.workflow.transition(run, "FORM");
      return;
    }
    const family = run.data.family as Family;
    const analyses = (run.data.featureAnalyses ?? {}) as Record<
      string,
      unknown
    >;
    if (Buffer.byteLength(JSON.stringify(analyses)) > 120000)
      throw new Error(
        "Family analysis exceeds bounded context; explicit owner scope decision required",
      );
    const next = family.members.find((i) => !analyses[i.key]);
    if (next) {
      if (Buffer.byteLength(JSON.stringify(next)) > 100000)
        throw new Error(
          "Jira member evidence exceeds bounded analysis input; explicit owner scope decision required",
        );
      run.data.featureMember = next;
      this.store.save(run);
      const result = await this.executor.execute(
        run,
        "Only scopeMembers may be implemented; all other cards are context and must retain their behavior, assignee and status. Read this family member and actual repository code in the pinned analysis workspaces. Analyze acceptance criteria, dependencies, completed/context work and bounded implementation possibilities for featureMember only. Other family members are summarized here and will each receive a separate full-description analysis. Do not ask the human to copy sibling descriptions merely because this step provides only their summaries. Defer cross-member acceptance synthesis until all saved member analyses are available. Do not edit. Return approach as a single plain-text string, not an object. Do not invent requirements. Missing consequential product decisions => question. Exact member data schema: " +
          JSON.stringify(
            z.toJSONSchema(
              memberAnalysisSchema.extend({ key: z.literal(next.key) }),
            ),
          ),
        "nola-engineering:solution-analysis",
        "read",
        cwd,
        signal,
      );
      if (result.status !== "passed") {
        await this.ask(
          run,
          result.question ?? result.summary,
          result.options,
          result.decision,
          result.decisionContext ?? { summary: result.summary.slice(0, 1200) },
        );
        return;
      }
      const analysis = await new ValidatedMemberAnalysis(
        this.store,
        this.executor,
      ).read(run, next.key, result.data, cwd, signal);
      analyses[next.key] = analysis;
      run.data.featureAnalyses = analyses;
      delete run.data.featureMember;
      this.store.save(run);
      return;
    }
    if (Buffer.byteLength(JSON.stringify(analyses)) > 120000)
      throw new Error(
        "Family analysis exceeds a bounded delivery context. Explicit owner scope decision required; no family members were dropped or split",
      );
    const result = await this.executor.execute(
      run,
      "Synthesize ALL saved member analyses into one feature delivery per repository. Preserve completed work, list every family member in coverage, use disposition implement only for scopeMembers and context for others. Use coverage.dependencies only for exact verified Jira card keys, and coverage.technicalPrerequisites for descriptive technical work. Resolve dependencies and name acceptance tests and bounded repository-prefixed files. No edits. Use this feature form schema: " +
        JSON.stringify(z.toJSONSchema(featureFormSchema)),
      "nola-engineering:solution-analysis",
      "read",
      cwd,
      signal,
    );
    if (result.status !== "passed") {
      await this.ask(
        run,
        result.question ?? result.summary,
        result.options,
        result.decision,
        result.decisionContext ?? { summary: result.summary.slice(0, 1200) },
      );
      return;
    }
    this.acceptFeatureForm(
      run,
      await new ValidatedPlan(this.store, this.executor).read(
        run,
        result.data,
        cwd,
        signal,
      ),
    );
    this.workflow.transition(run, "FORM");
  }
  private acceptFeatureForm(run: Run, form: FeatureForm): void {
    const family = run.data.family as Family;
    new FamilyPolicy().coverage(
      form,
      family,
      run.data.scopeMembers as string[],
    );
    const root = family.members.find((i) => i.key === family.root)!;
    form.issueType = root.fields.issuetype.name;
    form.labels = [
      ...new Set(
        [
          ...family.members.filter(
            (i) =>
              i.key === family.root ||
              (run.data.scopeMembers as string[]).includes(i.key),
          ),
          ...family.ancestors.filter((i) => i.key === family.root),
        ].flatMap((i) => i.fields.labels ?? []),
      ),
    ] as string[];
    run.data.featurePlanCandidate = form;
    this.store.save(run);
    new ScopePolicy().assert(form.repositories, form.products);
    run.data.featureForm = form;
    run.data.form = new FeaturePlan().toDelivery(form);
    run.data.identifyingNames = [
      ...new Set(family.members.flatMap(privateNames)),
    ];
    delete run.data.featurePlanCandidate;
    this.store.save(run);
  }
  private async ask(
    run: Run,
    question: string,
    options: string[],
    proposal?: DecisionProposal,
    details?: DecisionDetails,
  ): Promise<void> {
    await this.decisions.ask(
      run.id,
      question,
      options,
      Date.now(),
      proposal,
      details,
    );
    if (run.state === "investigating") this.workflow.transition(run, "ASK");
  }
}
