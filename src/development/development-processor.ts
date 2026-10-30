import type { DecisionProposal } from "../decisions/types/decision-proposal.js";
import { FeatureAnalysis } from "../features/analysis.js";
import { featureFormSchema } from "../features/feature-form-schema.js";
import { FeatureDelivery } from "../features/delivery.js";
import { privateNames } from "../integrations/jira/private-names.js";
import { browserOrigins } from "../browser/origin-policy.js";
import { Secrets } from "../integrations/secrets.js";
import { Publication } from "../development/publication.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { Run } from "../workflows/types/run.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import { GitlabClient } from "../integrations/gitlab/gitlab-client.js";
import type { EligibilityJudge } from "../integrations/abstractions/interface/eligibility-judge.js";
import type { DecisionService } from "../decisions/decision-service.js";
import {
  eligibilitySchema,
  type EligibilityForm,
} from "../integrations/jev/types/eligibility-form.js";
import { Workflow } from "../workflows/workflow.js";
import { ScopePolicy } from "../development/scope-policy.js";
import { Workspace } from "../development/workspace.js";
import { ProcessRunner } from "../runtime/process-runner.js";
export class DevelopmentProcessor {
  private readonly workflow: Workflow;
  private readonly workspace: Workspace;
  private readonly process = new ProcessRunner();
  private readonly publication: Publication;
  private readonly featureAnalysis: FeatureAnalysis;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly executor: StageRunner,
    private readonly decisions: DecisionService,
    private readonly jira: IssueTracker | undefined,
    private readonly jev: EligibilityJudge | undefined,
    private readonly directory: string,
  ) {
    this.workflow = new Workflow(store);
    this.workspace = new Workspace(directory);
    this.publication = new Publication(store, config, directory);
    this.featureAnalysis = new FeatureAnalysis(store, executor, decisions);
  }
  async processRun(run: Run, signal: AbortSignal): Promise<void> {
    if (run.kind === "feature" && !["waiting", "queued"].includes(run.state)) {
      if (!this.jira)
        throw new Error(
          "Jira connection required for feature scope verification",
        );
      if (
        !(await new FeatureDelivery(
          this.store,
          this.jira,
          this.config,
        ).verifyScope(run))
      )
        return;
    }
    const decision = this.decisions
      .list()
      .filter((d) => d.runId === run.id && d.status === "answered")
      .at(-1);
    if (run.state === "humanValidation") {
      if (
        !decision ||
        !decision.question.startsWith("Validate staging result") ||
        (Number(run.data.deliveryAttempt ?? 0) > 0 &&
          !decision.question.includes(`attempt ${run.data.deliveryAttempt}:`))
      ) {
        await this.decisions.ask(
          run.id,
          `Validate staging result${run.data.deliveryAttempt ? ` attempt ${run.data.deliveryAttempt}:` : ":"} revise as evidências e confirme o comportamento esperado. A validação humana permanece obrigatória.`,
          ["Validated", "Needs changes"],
        );
        return;
      }
      if (decision.answer === "Validated") {
        await this.finalize(run);
        this.workflow.transition(run, "VALIDATED");
        return;
      }
      if (decision.answer === "Needs changes") {
        run.data.resumeStage = "fixing";
        this.store.save(run);
        this.workflow.transition(run, "REJECT");
        return;
      }
      throw new Error(
        "Ambiguous human staging validation; private clarification required",
      );
    }
    if (run.state === "queued") {
      this.scope(run);
      this.workflow.transition(run, "START");
      return;
    }
    await this.development(run, signal);
  }
  private scope(run: Run): void {
    const form = run.data.form as EligibilityForm | undefined;
    if (!form) {
      if (run.data.scopePending === true) return;
      throw new Error("Development scope evidence missing");
    }
    new ScopePolicy().assert(form.repositories, form.products);
  }
  private async development(run: Run, signal: AbortSignal): Promise<void> {
    const cwd = this.config.repositories[0]?.path;
    if (!cwd)
      throw new Error("Configure NOLA web repositories and staging endpoints");
    if (run.state === "investigating") {
      if (!run.data.analysisWorkspaces) {
        // Preserve older in-flight checkpoints instead of replacing their code base.
        if (run.data.workspaces)
          run.data.analysisWorkspaces = run.data.workspaces;
        else {
          const paths = await this.workspace.prepareAnalysis(
            run.id,
            this.config.repositories,
            signal,
          );
          run.data.analysisRevisions = await this.workspace.revisions(
            paths,
            signal,
          );
          run.data.analysisWorkspaces = paths;
        }
        this.store.save(run);
      }
      const analysisPaths = run.data.analysisWorkspaces as Record<
        string,
        string
      >;
      if (run.kind === "feature") {
        await this.featureAnalysis.investigate(
          run,
          Object.values(analysisPaths)[0]!,
          signal,
        );
        return;
      }
      if (this.jira) {
        const issue = await this.jira.evidence(
          String(run.data.issueKey ?? run.source),
        );
        run.data.issue = issue;
        run.data.identifyingNames = privateNames(issue);
      }
      const result = await this.executor.execute(
        run,
        "Read actual repository code and issue evidence. Fill data with the eligibility-form v0.6 fields plus repositories, products, issueType and labels. The accepted form schema is: " +
          JSON.stringify(z.toJSONSchema(eligibilitySchema)) +
          ". Identify ALL products involved, including mixed dependencies. Totem or SmartPOS must be handed off. State code-traced facts separately from hypotheses. Propose repository-prefixed file paths and a real configured regression test. Do not modify code.",
        "nola-engineering:solution-analysis",
        "read",
        Object.values(analysisPaths)[0]!,
        signal,
      );
      if (result.status !== "passed") {
        await this.ask(
          run,
          result.question ?? result.summary,
          result.options,
          result.decision,
        );
        return;
      }
      const form = eligibilitySchema.parse(result.data);
      const issue = run.data.issue as
        | { fields?: { issuetype?: { name?: string }; labels?: unknown } }
        | undefined;
      if (
        !issue?.fields?.issuetype?.name ||
        !Array.isArray(issue.fields.labels) ||
        !issue.fields.labels.every((label) => typeof label === "string")
      )
        throw new Error(
          "Verified Jira type/labels are required; an engine cannot invent factual eligibility gates",
        );
      form.issueType = issue.fields.issuetype.name;
      form.labels = issue.fields.labels as string[];
      run.data.form = form;
      this.store.save(run);
      try {
        this.scope(run);
      } catch (error) {
        run.data.handoff = String(error);
        this.store.save(run);
        this.workflow.transition(run, "FORM");
        this.workflow.transition(run, "REJECT");
        return;
      }
      this.workflow.transition(run, "FORM");
      return;
    }
    const form = eligibilitySchema.parse(run.data.form);
    this.scope(run);
    if (run.state === "eligibility") {
      if (
        run.kind === "feature" &&
        (await this.featureAnalysis.resolveDecisions(run, signal))
      )
        return;
      if (!this.jev)
        throw new Error(
          "JEV unavailable. Configure TYPESAFE_API_KEY or SSM; eligibility remains pending",
        );
      const names = (run.data.identifyingNames as string[] | undefined) ?? [];
      const classification =
        run.kind === "feature"
          ? await (() => {
              if (!this.jev?.classifyFeature)
                throw new Error("Feature-specific JEV evaluator unavailable");
              return this.jev.classifyFeature(
                featureFormSchema.parse(run.data.featureForm),
                names,
              );
            })()
          : await this.jev.classify(form, names);
      run.data.jev = classification;
      this.store.save(run);
      if (classification.classification !== "A-candidate") {
        this.workflow.transition(run, "REJECT");
        return;
      }
      if (form.open_decisions.length) {
        const unresolved = form.open_decisions.find(
          (d) =>
            !this.decisions
              .list()
              .some(
                (answer) =>
                  answer.runId === run.id &&
                  answer.status === "answered" &&
                  answer.question === d.question,
              ),
        );
        if (unresolved) {
          await this.decisions.ask(
            run.id,
            unresolved.question,
            unresolved.proposed_default
              ? [unresolved.proposed_default, "Discuss alternative"]
              : [],
            Date.now(),
            unresolved.proposal,
          );
          return;
        }
      }
      const restricted = form.domains.filter((d) =>
        /fiscal|payments|authentication|lgpd|security/i.test(d),
      );
      if (restricted.length && run.data.domainApproval !== true) {
        const question =
          "Owner approval required before changing restricted domains: " +
          restricted.join(", ");
        const approval = this.decisions
          .list()
          .find(
            (d) =>
              d.runId === run.id &&
              d.question === question &&
              d.status === "answered",
          );
        if (approval?.answer === "Approve restricted domain change") {
          run.data.domainApproval = true;
          this.store.save(run);
        } else if (approval?.answer === "Human handoff") {
          this.workflow.transition(run, "REJECT");
          return;
        } else {
          await this.decisions.ask(run.id, question, [
            "Approve restricted domain change",
            "Human handoff",
          ]);
          return;
        }
      }
      const repos = this.config.repositories.filter((r) =>
        form.repositories.includes(r.name),
      );
      if (repos.length !== form.repositories.length)
        throw new Error("Missing repository configuration");
      const analysis = run.data.analysisWorkspaces as
        Record<string, string> | undefined;
      if (analysis && repos.some((repo) => !analysis[repo.name]))
        throw new Error(
          "Selected repository was not included in the pinned investigation; review scope before proceeding",
        );
      run.data.workspaces = await this.workspace.prepare(
        run.id,
        repos,
        form.products,
        signal,
        run.data.branchName as string | undefined,
      );
      this.workspace.validatePlan(
        run.data.workspaces as Record<string, string>,
        form.proposed_fix.files,
      );
      this.store.save(run);
      this.workflow.transition(run, "ELIGIBLE");
      return;
    }
    const paths = run.data.workspaces as Record<string, string>;
    if (!paths) throw new Error("Isolated worktree checkpoint missing");
    const primary = Object.values(paths)[0]!;
    if (["regression", "fixing", "findings"].includes(run.state)) {
      this.scope(run);
      this.workspace.validatePlan(paths, form.proposed_fix.files);
      if (run.state === "regression" && !run.data.baselineTests) {
        const baseline = await this.tests(run, paths, signal);
        if (baseline.some((result) => result.code !== 0))
          throw new Error(
            "Configured regression command fails before test changes; restore dependency/setup baseline before claiming defect proof",
          );
        run.data.baselineTests = baseline;
        this.store.save(run);
      }
      const instruction =
        run.state === "regression"
          ? run.kind === "feature"
            ? "Write only failing acceptance/unit tests for the requested feature and complete family coverage. Do not implement the feature."
            : "Write only the regression test from observed defect evidence. Do not fix the implementation."
          : run.state === "fixing"
            ? "Implement the minimal bounded fix in the approved file plan; the independently run regression is recorded failing."
            : "Resolve findings from the single independent review. Do not start another review.";
      const result = await this.executor.execute(
        run,
        instruction +
          " Workspaces: " +
          JSON.stringify(paths) +
          ". Approved file plan: " +
          JSON.stringify(form.proposed_fix.files),
        run.state === "regression" && run.kind !== "feature"
          ? "nola-engineering:bug-reproduction"
          : "nola-engineering:delivery",
        "edit",
        primary,
        signal,
      );
      if (result.status !== "passed") {
        await this.ask(
          run,
          result.question ?? result.summary,
          result.options,
          result.decision,
        );
        return;
      }
      const changed = await this.workspace.changed(paths);
      if (changed.some((f) => !form.proposed_fix.files.includes(f)))
        throw new Error(
          "Changed file outside approved plan; inspect preserved worktree",
        );
      const results = await this.tests(run, paths, signal);
      run.data[run.state + "Tests"] = results;
      this.store.save(run);
      if (run.state === "regression") {
        if (!changed.length || results.every((r) => r.code === 0))
          throw new Error(
            "No demonstrated failing regression; fix is forbidden",
          );
        const attribution = await this.executor.execute(
          run,
          run.kind === "feature"
            ? "Inspect the actual test failure. Prove its assertion captures requested feature acceptance criteria, not setup, syntax or unrelated failures. Return passed only with the exact assertion and changed test path in data.testPath."
            : "Inspect actual test output and assertion. Prove the failure is the reported defect, not missing dependencies, syntax, setup or unrelated baseline failures. Return passed only with the exact failing assertion and a test path in data.testPath.",
          run.kind === "feature"
            ? "nola-engineering:delivery"
            : "nola-engineering:bug-reproduction",
          "read",
          primary,
          signal,
        );
        const testPath = attribution.data.testPath;
        if (
          attribution.status !== "passed" ||
          typeof testPath !== "string" ||
          !changed.includes(testPath) ||
          changed.some(
            (f) =>
              !/(?:\/tests?\/|\/__tests__\/|\.(?:test|spec)\.[jt]sx?$|\/test_[^/]+\.py$|_test\.py$)/i.test(
                f,
              ),
          )
        )
          throw new Error(
            "Failing defect assertion has not been established with test-only changes",
          );
        run.data.regressionEvidence = attribution;
        this.store.save(run);
        if (!this.jira)
          throw new Error("Jira connection required to claim confirmed Bug");
        if (run.kind === "feature")
          await new FeatureDelivery(
            this.store,
            this.jira,
            this.config,
          ).recordProgress(
            run,
            "claim",
            "Plano da família e testes de aceitação revisados. Teste falhou pelo comportamento solicitado antes da implementação; entrega em andamento.",
          );
        else
          await this.jira.transition(
            run.id,
            String(run.data.issueKey ?? run.source),
            "In Progress",
            "claim",
          );
        this.workflow.transition(run, "FAILING");
      } else {
        if (results.some((r) => r.code !== 0))
          throw new Error("Regression/unit checks are not green");
        this.workflow.transition(run, "GREEN");
      }
      return;
    }
    if (run.state === "review") {
      if (run.data.reviewStarted)
        throw new Error(
          "Independent review already started. Inspect its saved session; a second review is forbidden",
        );
      run.data.reviewBrief = {
        preview: await this.publication.preview(run),
        filePlan: form.proposed_fix.files,
        regressionTests: run.data.regressionTests,
        passingTests: run.data.fixingTests,
      };
      run.data.reviewStarted = true;
      this.store.save(run);
      const result = await this.executor.execute(
        run,
        "Perform the ONE independent review from this clean native session. Read diff, evidence and tests. Return data.findings with actionable findings; blocked if review evidence unavailable. Do not change files.",
        "nola-engineering:code-review",
        "read",
        primary,
        signal,
        true,
      );
      if (result.status === "blocked")
        throw new Error(
          "Independent review blocked; saved review session requires inspection",
        );
      run.data.review = result;
      this.store.save(run);
      this.workflow.transition(run, "REVIEWED");
      return;
    }
    if (run.state === "finalTests") {
      const before = await this.publication.preview(run);
      const results = await this.tests(run, paths, signal);
      if (results.some((r) => r.code !== 0))
        throw new Error("Final tests failed");
      const after = await this.publication.preview(run);
      if (before.digest !== after.digest)
        throw new Error("Tests changed source content; inspect and rerun");
      run.data.finalTestDigest = after.digest;
      run.data.finalTests = results;
      this.store.save(run);
      this.workflow.transition(run, "GREEN");
      return;
    }
    if (run.state === "publication") {
      if (!run.data.publicationApproval) {
        const preview = await this.publication.preview(run);
        const artifact = join(this.directory, "artifacts", run.id);
        mkdirSync(artifact, { recursive: true, mode: 0o700 });
        writeFileSync(join(artifact, "publication.diff"), preview.diff, {
          mode: 0o600,
        });
        const approval = this.decisions
          .list()
          .find(
            (d) =>
              d.runId === run.id &&
              d.status === "answered" &&
              d.answer === `Approve publication ${preview.digest}` &&
              d.question.startsWith("Review concrete publication") &&
              d.question.includes(preview.digest),
          );
        if (!approval) {
          await this.decisions.ask(
            run.id,
            `Review concrete publication for ${run.source}. Diff: ${join(artifact, "publication.diff")}. Digest: ${preview.digest}. This pushes only the task branch, serializes integration into staging and creates a draft MR to master. No master merge or production deploy.`,
            [`Approve publication ${preview.digest}`, "Pause"],
          );
          return;
        }
        run.data.publicationApproval = preview.digest;
        this.store.save(run);
      }
      run.data.publications = await this.publication.publish(run);
      this.store.save(run);
      this.workflow.transition(run, "PUBLISHED");
      return;
    }
    if (run.state === "staging") {
      run.data.readiness = await this.verifyStaging(run);
      if (!this.jira)
        throw new Error("Jira connection required for verified documentation");
      const publications = run.data.publications as Record<
        string,
        { revision: string; mergeRequest: { web_url?: string } }
      >;
      const documentation = `Correção implementada em worktree isolada. Teste de regressão falhou pelo defeito antes da correção; testes finais passaram. Uma revisão independente foi concluída. Staging verificado por revisão, CI e deployment. Validação E2E automática e confirmação humana ainda pendentes.\n${Object.entries(
        publications,
      )
        .map(
          ([name, p]) =>
            `${name}: ${p.revision} ${p.mergeRequest.web_url ?? ""}`,
        )
        .join("\n")}`;
      if (run.kind === "feature")
        await new FeatureDelivery(
          this.store,
          this.jira,
          this.config,
        ).recordProgress(
          run,
          "documented",
          documentation
            .replace("Correção implementada", "Funcionalidade implementada")
            .replace("pelo defeito", "pelos critérios de aceitação"),
        );
      else {
        await this.jira.comment(
          run.id,
          String(run.data.issueKey ?? run.source),
          documentation,
        );
        await this.jira.transition(
          run.id,
          String(run.data.issueKey ?? run.source),
          "Docs & Tests",
          "documented",
        );
      }
      this.store.save(run);
      this.workflow.transition(run, "DEPLOYED");
      return;
    }
    if (run.state === "e2e") {
      const endpoints = this.config.repositories
        .filter((r) => form.repositories.includes(r.name))
        .map((r) => r.stagingUrl);
      const origins = browserOrigins(endpoints);
      if (!origins.length)
        throw new Error(
          "No verified staging endpoints configured for this E2E task",
        );
      run.data.browserAuthorized = true;
      run.data.browserAuthorizationSource = "native-engine";
      run.data.browserScopeOrigins = origins;
      this.store.save(run);
      await this.verifyStaging(run);
      const result = await this.executor.execute(
        run,
        (run.kind === "feature"
          ? "Use only native browser tools to validate ALL implemented family feature acceptance criteria on these verified STAGING endpoints: "
          : "Use only native browser tools to validate the observable defect acceptance criteria on these verified STAGING endpoints: ") +
          JSON.stringify(endpoints) +
          ". Do not access production or real-store environments. Missing extension, browser, login or access => blocked with exact user action. Include observable assertions and evidence paths.",
        run.kind === "feature"
          ? "nola-engineering:delivery"
          : "nola-engineering:bug-reproduction",
        "browser",
        primary,
        signal,
      );
      run.data.e2e = result;
      this.store.save(run);
      if (result.status === "passed") {
        this.workflow.transition(run, "PASSED");
        return;
      }
      if (result.status === "failed") {
        run.data.resumeStage = "fixing";
        this.store.save(run);
        this.workflow.transition(run, "FAILED");
        await this.decisions.ask(
          run.id,
          "Staging E2E failed: " + result.summary,
          ["Revise attempt", "Pause"],
        );
        return;
      }
      run.data.resumeStage = "e2e";
      this.store.save(run);
      this.workflow.transition(run, "ASK");
      await this.decisions.ask(run.id, result.question ?? result.summary, [
        "Ready: validate access again",
        "Pause",
      ]);
    }
  }
  private async finalize(run: Run): Promise<void> {
    if (!this.config.gitlab || !this.jira)
      throw new Error("Verified delivery connections required");
    const token = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("SCABBERS_GITLAB_TOKEN");
    const publications = run.data.publications as Record<
      string,
      { mergeRequest: { iid: number } }
    >;
    const progress = run.data.publicationProgress as Record<
      string,
      { head: string }
    >;
    for (const [name, publication] of Object.entries(publications)) {
      const repo = this.config.repositories.find((r) => r.name === name)!;
      const projectId = repo.gitlabProjectId ?? this.config.gitlab.projectId;
      const client = new GitlabClient(
        { ...this.config.gitlab, projectId },
        token,
      );
      await client.ready(publication.mergeRequest.iid, progress[name]!.head);
    }
    if (run.kind === "feature") {
      await new FeatureDelivery(
        this.store,
        this.jira,
        this.config,
      ).recordProgress(
        run,
        "validated",
        "Validação humana de staging recebida. MRs liberados para revisão; nenhuma alteração de produção realizada.",
      );
      return;
    }
    await this.jira.comment(
      run.id,
      String(run.data.issueKey ?? run.source),
      "Validação humana de staging recebida na thread privada autenticada. MR liberado do modo draft; encaminhado para revisão de código. Nenhuma alteração de produção realizada.",
      "human-validation",
    );
    await this.jira.transition(
      run.id,
      String(run.data.issueKey ?? run.source),
      "Ready for Code Review",
      "human-validation",
    );
  }
  private async verifyStaging(run: Run): Promise<Record<string, unknown>> {
    if (!this.config.gitlab)
      throw new Error("GitLab connection required to verify deployment");
    const token = await new Secrets(
      this.config.aws,
      this.config.credentialKeys,
    ).get("SCABBERS_GITLAB_TOKEN");
    const publications = run.data.publications as
      Record<string, { revision: string }> | undefined;
    if (!publications)
      throw new Error("Published repository revisions are missing");
    const evidence: Record<string, unknown> = {};
    for (const [name, publication] of Object.entries(publications)) {
      const repository = this.config.repositories.find((r) => r.name === name);
      if (!repository) throw new Error("Repository configuration missing");
      const projectId =
        repository.gitlabProjectId ??
        (Object.keys(publications).length === 1
          ? this.config.gitlab.projectId
          : undefined);
      if (!projectId)
        throw new Error("Per-repository GitLab project identity required");
      const client = new GitlabClient(
        { ...this.config.gitlab, projectId },
        token,
      );
      evidence[name] = await client.readiness(publication.revision, "staging");
      const response = await fetch(repository.stagingUrl, {
        method: "HEAD",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          "Staging endpoint requires access/login or is temporarily unavailable: " +
            repository.stagingUrl,
        );
    }
    return evidence;
  }
  private async tests(
    run: Run,
    paths: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ repository: string; code: number; stdout: string }[]> {
    const results = [];
    for (const [name, path] of Object.entries(paths)) {
      const repo = this.config.repositories.find((r) => r.name === name)!;
      const [command, ...args] = repo.testCommand;
      const result = await this.process.run(
        command!,
        args,
        path,
        "",
        (line) => this.store.log(run.id, `Tests ${name}: ${line}`),
        signal,
        undefined,
        undefined,
        undefined,
        (line) => this.store.log(run.id, `Tests ${name} stderr: ${line}`),
      );
      this.store.log(run.id, `Tests ${name}: exited ${result.code}`);
      results.push({ repository: name, ...result });
    }
    return results;
  }
  private async ask(
    run: Run,
    question: string,
    options: string[],
    proposal?: DecisionProposal,
  ): Promise<void> {
    await this.decisions.ask(run.id, question, options, Date.now(), proposal);
    if (["investigating", "routing", "e2e"].includes(run.state))
      this.workflow.transition(run, "ASK");
    else this.store.log(run.id, "Private decision pending at " + run.state);
  }
}
