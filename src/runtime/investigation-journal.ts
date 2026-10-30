import { createHash } from "node:crypto";
import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import type { StageResult } from "../engines/types/stage-result.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { InvestigationRecord } from "./types/investigation.js";
import { InvestigationPresentation } from "./investigation-presentation.js";

export class InvestigationJournal {
  constructor(
    private readonly store: Store,
    private readonly jira?: IssueTracker,
  ) {}
  fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private key(run: Run, fingerprint: string): string {
    return `investigation:${run.id}:${fingerprint}`;
  }
  pending(run: Run, fingerprint: string): InvestigationRecord | undefined {
    const record = this.store.getSetting(this.key(run, fingerprint)) as
      InvestigationRecord | undefined;
    return record && !record.consumed ? record : undefined;
  }
  record(
    run: Run,
    fingerprint: string,
    skill: string,
    result: StageResult,
    member = (run.data.featureMember as { key?: string } | undefined)?.key,
  ): InvestigationRecord {
    const record: InvestigationRecord = {
      fingerprint,
      skill,
      stage: run.state,
      engine: run.engine,
      at: Date.now(),
      member,
      revisions: run.data.analysisRevisions,
      result,
      delivered: false,
      consumed: false,
    };
    this.store.setSetting(this.key(run, fingerprint), record);
    if (!skill.startsWith("controller/"))
      run.data.investigationLatest = fingerprint;
    this.store.save(run);
    return record;
  }
  private target(run: Run, member?: string): string | undefined {
    const scope = (run.data.scopeMembers ?? []) as string[];
    const report = (
      run.data.jiraIssues as
        | { key: string; fields?: { issuetype?: { name?: string } } }[]
        | undefined
    )?.find((i) => i.fields?.issuetype?.name === "Report");
    const target =
      run.kind === "feature"
        ? member && scope.includes(member)
          ? member
          : scope[0]
        : (run.data.issueKey ?? report?.key);
    return typeof target === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(target)
      ? target
      : undefined;
  }
  async publish(run: Run, record: InvestigationRecord): Promise<void> {
    if (record.delivered) return;
    const key = this.target(run, record.member);
    if (!this.jira || !key) {
      this.store.log(
        run.id,
        "Investigation preserved locally; no verified writable Jira card is available",
      );
      return;
    }
    const issue = await this.jira.issue(key);
    if (issue.key !== key)
      throw new Error(
        "Investigation documentation target does not match verified Jira issue",
      );
    const parts = new InvestigationPresentation().parts(record);
    const comment =
      this.jira.markdownComment?.bind(this.jira) ??
      this.jira.comment.bind(this.jira);
    for (const [index, part] of parts.entries())
      await comment(
        run.id,
        key,
        `## Investigação — parte ${index + 1}/${parts.length}\n\n` + part,
        `investigation:${record.fingerprint}:${index}`,
      );
    record.delivered = true;
    this.store.setSetting(this.key(run, record.fingerprint), record);
  }
  consumed(run: Run, record: InvestigationRecord): void {
    record.consumed = true;
    this.store.setSetting(this.key(run, record.fingerprint), record);
  }
  async blocker(run: Run, message: string): Promise<void> {
    const result: StageResult = {
      status: "blocked",
      summary:
        "A execução parou em um checkpoint técnico. A investigação já realizada permanece preservada.",
      evidence: [message],
      question: null,
      options: [],
      data: {
        stage: run.state,
        technicalBlocker: message,
        investigation: run.data.investigationLatest ?? null,
        actionRequired:
          "Corrigir a capacidade ou o contrato indicado e retomar o checkpoint; não autoriza operação nem altera requisitos.",
        savedPlan:
          run.data.operationalPlan ??
          run.data.featureForm ??
          run.data.form ??
          null,
      },
    };
    const fingerprint = this.fingerprint({
      state: run.state,
      message,
      source: run.data.investigationLatest,
    });
    const saved = this.store.getSetting(this.key(run, fingerprint)) as
      InvestigationRecord | undefined;
    await this.publish(
      run,
      saved ?? this.record(run, fingerprint, "controller/checkpoint", result),
    );
  }
  async eligibility(run: Run, verdict: unknown, form: unknown): Promise<void> {
    const result: StageResult = {
      status: "blocked",
      summary:
        "O avaliador JEV não classificou este plano como candidato à implementação autônoma. O resultado é de elegibilidade, não uma conclusão de que o requisito é inválido.",
      evidence: [
        "A investigação técnica e a avaliação foram preservadas; nenhuma implementação foi autorizada por esta classificação.",
      ],
      question: null,
      options: [],
      data: {
        verdict,
        form,
        actionRequired:
          "Revisar evidências, lacunas e escopo registrados. O score é provisório e não equivale a uma probabilidade calibrada de sucesso.",
      },
    };
    const fingerprint = this.fingerprint({
      stage: "eligibility",
      verdict,
      form,
    });
    const saved = this.store.getSetting(this.key(run, fingerprint)) as
      InvestigationRecord | undefined;
    await this.publish(
      run,
      saved ?? this.record(run, fingerprint, "controller/eligibility", result),
    );
  }
}
