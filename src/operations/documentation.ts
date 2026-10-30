import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import { Effects } from "../runtime/effects.js";
import { redactLog } from "../logging/log-redactor.js";
import { OperationalIdentity } from "./plan-identity.js";
import { OperationalApprovalProof } from "./approval-proof.js";
import type {
  OperationalPlan,
  OperationalImplementation,
} from "./types/operation.js";
export class OperationalDocumentation {
  constructor(
    private readonly store: Store,
    private readonly jira: IssueTracker,
    private readonly slack: Messaging,
    private readonly owner: string,
  ) {}
  async plan(run: Run): Promise<void> {
    const plan = run.data.operationalPlan as OperationalPlan;
    await this.jira.comment(
      run.id,
      String(run.data.issueKey),
      "Operational Tasks — proposta de plano; nenhuma implementação ou execução autorizada.\n" +
        JSON.stringify(plan, null, 2) +
        "\n\nLimitações da investigação:\n" +
        JSON.stringify(
          run.data.operationalPreparationLimitations ?? {},
          null,
          2,
        ),
      "operational-plan:" + new OperationalIdentity().plan(plan),
    );
  }
  async implementation(run: Run): Promise<void> {
    const plan = run.data.operationalPlan as OperationalPlan,
      bundle = run.data.operationalImplementation as OperationalImplementation,
      digest = new OperationalIdentity().implementation(plan, bundle);
    for (const file of bundle.files)
      await this.jira.comment(
        run.id,
        String(run.data.issueKey),
        `Operational Tasks — arquivo para revisão (${digest})\n${file.path}\n${file.content}`,
        `operational-file:${digest}:${file.path}`,
      );
    await this.jira.comment(
      run.id,
      String(run.data.issueKey),
      "Operational Tasks — implementação pronta para revisão humana, ainda não executada.\n" +
        JSON.stringify(
          {
            digest,
            executionDigest: new OperationalApprovalProof(
              this.store,
              this.owner,
            ).digest(run, "execute"),
            tests: this.result(run.data.operationalTests),
            review: run.data.operationalReview,
          },
          null,
          2,
        ),
      "operational-review:" + digest,
    );
    if (this.jira.readyForReview) {
      const ready = await this.jira.readyForReview(
        run.id,
        String(run.data.issueKey),
        "operational-ready:" + digest,
      );
      if (!ready) {
        run.data.operationalStatusNotice =
          "Documentação pronta para revisão; não há caminho permitido até Ready for Code Review neste workflow. Nenhum status de QA/Done foi escolhido.";
        this.store.save(run);
      }
      return;
    }
    try {
      await this.jira.transition(
        run.id,
        String(run.data.issueKey),
        "Ready for Code Review",
        "operational-ready:" + digest,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("Verified Jira transition unavailable:")
      )
        throw error;
      run.data.operationalStatusNotice =
        "Documentação pronta para revisão; a transição direta para Ready for Code Review não está disponível neste workflow. Status Jira preservado.";
      this.store.save(run);
    }
  }
  private result(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    const result = { ...value } as Record<string, unknown>;
    for (const key of ["stdout", "stderr", "error"]) {
      if (typeof result[key] === "string" && result[key].length > 4000) {
        result[key] =
          result[key].slice(0, 4000) +
          "\n[trecho; evidência completa no checkpoint privado]";
      }
    }
    return result;
  }
  async complete(run: Run, manual = false): Promise<void> {
    const digest = new OperationalIdentity().implementation(
      run.data.operationalPlan as OperationalPlan,
      run.data.operationalImplementation as OperationalImplementation,
    );
    const summary = manual
      ? "Documentação revisada; execução ficou a cargo do responsável. Nenhuma operação foi executada pelo Scabbers."
      : "Operação executada após a segunda aprovação explícita. Os critérios de sanity check foram confirmados pelos scripts revisados; nenhuma repetição ou rollback automático foi realizado.";
    await this.jira.comment(
      run.id,
      String(run.data.issueKey),
      summary +
        "\n" +
        JSON.stringify(
          {
            digest,
            result: this.result(run.data.operationalExecution),
            verification: this.result(run.data.operationalVerification),
          },
          null,
          2,
        ),
      "operational-complete:" + digest,
    );
    const marker = `scabbers:operational:${run.id}:${digest}:complete`;
    const channel = String(
      run.data.privateChannel ?? (await this.slack.openPrivate(this.owner)),
    );
    await new Effects(this.store).once(
      run.id,
      marker,
      () => this.slack.find(channel, marker),
      () =>
        this.slack.post(
          channel,
          redactLog(
            `Operational Tasks · ${run.data.issueKey}\n${summary}\nEvidências e documentação no card.\n${marker}`,
          ),
        ),
    );
  }
}
