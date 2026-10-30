import type { DecisionDetails } from "../decisions/types/decision-context.js";
import type { AnalysisWorkspace } from "../development/abstractions/interface/analysis-workspace.js";
import type { DecisionProposal } from "../decisions/types/decision-proposal.js";
import { triagePlanSchema } from "./triage-plan-schema.js";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { Run } from "../workflows/types/run.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { DecisionService } from "../decisions/decision-service.js";
import { Workflow } from "../workflows/workflow.js";
import { Effects } from "../runtime/effects.js";
import { hasTriage } from "../support/triage-detector.js";
import { ThreadEvidence } from "./thread-evidence.js";

export class SupportProcessor {
  private readonly workflow: Workflow;
  private readonly effects: Effects;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly executor: StageRunner,
    private readonly slack: Messaging,
    private readonly decisions: DecisionService,
    private readonly jira: IssueTracker | undefined,
    private readonly workspace?: AnalysisWorkspace,
  ) {
    this.workflow = new Workflow(store);
    this.effects = new Effects(store);
  }
  async process(run: Run, signal: AbortSignal): Promise<void> {
    const channel = String(run.data.channel),
      thread = String(run.data.thread);
    const messages = await this.slack.replies(channel, thread);
    const ownPublication = (items: typeof messages) =>
      typeof run.data.destination === "string" &&
      items.some(
        (message) =>
          message.text.includes(
            `nola-bug-management/report-triage/${(run.data.plan as { reportKey?: string })?.reportKey}`,
          ) &&
          message.text.includes(
            `${this.config.jira?.baseUrl}/browse/${run.data.destination}`,
          ),
      );
    if (hasTriage(messages) && !ownPublication(messages)) {
      if (run.data.destination)
        throw new Error(
          "Concurrent triage found after partial Jira routing; reconcile without publishing over another triage",
        );
      this.workflow.transition(run, "CANCEL");
      this.store.log(
        run.id,
        "Existing identifiable triage found; no re-review or publication",
      );
      return;
    }
    if (run.state === "investigating") {
      run.data.messages = messages;
      run.data.originThreads = await new ThreadEvidence(this.slack).collect(
        messages,
        channel,
        thread,
      );
      const keys = [
        ...new Set(
          messages.flatMap(
            (message) => message.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [],
          ),
        ),
      ];
      const allowedProjects = new Set([
        "SNOLA",
        "PNOLA",
        this.config.jira?.project,
      ]);
      const nolaKeys = keys.filter((key) =>
        allowedProjects.has(key.split("-")[0]),
      );
      if (!nolaKeys.length)
        throw new Error(
          "Report has no verifiable Jira key. Link the source Report before routing.",
        );
      if (!this.jira)
        throw new Error("Jira connection is required for evidence and routing");
      run.data.jiraIssues = await Promise.all(
        nolaKeys.map((key) => this.jira!.evidence(key)),
      );
      this.store.save(run);
      if (this.config.repositories.length && !run.data.analysisWorkspaces) {
        if (!this.workspace)
          throw new Error(
            "Pinned analysis workspace provider required for code investigation",
          );
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
        this.store.save(run);
      }
      const analysisPaths = run.data.analysisWorkspaces as
        Record<string, string> | undefined;
      const result = await this.executor.execute(
        run,
        "Investigate this complete report thread and verified Jira issues. Return a routing plan in data: {reportKey,type: Bug|Bug Crítico|Ticket|duplicate|cancel|product|insufficient,summary,description,evidence:string[],ambiguous:false,destinationKey?:string,cancellationReason?:string} only for an objective evidenced route. Duplicate requires an inspected open Bug and destinationKey; cancellation requires an evidenced reason matching live Jira metadata. Product keeps the Report open without creating an RFC. An active critical incident requires observable reach, urgency and workaround evidence. Behavior uncertainty or missing evidence requires status question and a precise private question with permitted options; do not infer confirmation. Do not copy private discussion into public output; use only the pertinent authorized conclusion. Do not create or modify issues. Existing triage is not ours to review. The configured owner may be assigned a confirmed Bug; assignment never grants development eligibility.",
        "nola-operations:report-triage",
        "read",
        Object.values(analysisPaths ?? {})[0] ?? process.cwd(),
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
      run.data.plan = triagePlanSchema.parse(result.data);
      this.store.save(run);
      this.workflow.transition(run, "READY");
      return;
    }
    if (run.state === "routing") {
      const plan = triagePlanSchema.parse(run.data.plan);
      const sourceIssues = run.data.jiraIssues as {
        key: string;
        fields: { issuetype: { name: string } };
      }[];
      if (
        !sourceIssues.some(
          (i) =>
            i.key === plan.reportKey && i.fields.issuetype.name === "Report",
        )
      )
        throw new Error("Routing plan source does not match verified Report");
      if (!this.jira) throw new Error("Jira adapter unavailable");
      const destination = await this.jira.route(run.id, plan.reportKey, plan);
      run.data.destination = destination;
      this.store.save(run);
      const beforePublication = await this.slack.replies(channel, thread);
      if (hasTriage(beforePublication) && !ownPublication(beforePublication))
        throw new Error(
          "Concurrent triage found after Jira routing; reconcile privately before Slack publication",
        );
      const marker = `nola-bug-management/report-triage/${plan.reportKey}`;
      await this.effects.once(
        run.id,
        marker + ":slack",
        () => this.slack.find(channel, marker, thread),
        () =>
          this.slack.post(
            channel,
            `${["product", "insufficient"].includes(plan.type) ? "Triagem registrada; Report permanece aberto para encaminhamento humano" : "Encaminhamento concluído"}: ${this.config.jira!.baseUrl}/browse/${destination}\n${marker}`,
            thread,
          ),
      );
      if (plan.type === "Bug")
        this.store.create(
          "development",
          destination,
          run.engine,
          run.profileVersion,
          {
            ...(run.data.soulSnapshot
              ? { soulSnapshot: run.data.soulSnapshot }
              : {}),
            issueKey: destination,
            ownerSlackUser: run.data.ownerSlackUser ?? this.config.slack.user,
            sourceRun: run.id,
            scopePending: true,
          },
        );
      this.workflow.transition(run, "PUBLISHED");
    }
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
    if (["investigating", "routing", "e2e"].includes(run.state))
      this.workflow.transition(run, "ASK");
    else this.store.log(run.id, "Private decision pending at " + run.state);
  }
}
