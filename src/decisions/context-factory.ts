import { redactLog } from "../logging/log-redactor.js";
import type { Run } from "../workflows/types/run.js";
import type { JiraIssue } from "../integrations/types/jira-issue.js";
import type { Family } from "../features/types/family.js";
import type {
  DecisionContext,
  DecisionDetails,
} from "./types/decision-context.js";

export class DecisionContextFactory {
  constructor(private readonly jiraBaseUrl?: string) {}
  private clean(text: string, limit: number): string {
    const clean = redactLog(text).slice(0, limit);
    return /[\uD800-\uDBFF]$/.test(clean) ? clean.slice(0, -1) : clean;
  }
  create(
    run: Run,
    question: string,
    decisionVersion: number,
    details?: DecisionDetails,
  ): DecisionContext {
    const family = run.data.family as Family | undefined;
    const issue = run.data.issue as JiraIssue | undefined;
    const issues = run.data.jiraIssues as JiraIssue[] | undefined;
    const candidates = [
      issue,
      ...(family?.members ?? []),
      ...(issues ?? []),
    ].filter((i): i is JiraIssue => !!i);
    const plan = run.data.plan as Record<string, unknown> | undefined;
    const preferred =
      run.data.issueKey ?? family?.root ?? issue?.key ?? plan?.reportKey;
    const selected = preferred
      ? candidates.find((i) => i.key === preferred)
      : candidates.filter((i) => i.fields?.issuetype?.name === "Report")
            .length === 1
        ? candidates.find((i) => i.fields?.issuetype?.name === "Report")
        : undefined;
    const key =
      selected?.key && /^[A-Z][A-Z0-9]+-\d+$/.test(selected.key)
        ? selected.key
        : undefined;
    const title =
      typeof selected?.fields?.summary === "string"
        ? selected.fields.summary
        : run.kind === "support"
          ? "Report recebido no Slack"
          : "Demanda em análise";
    const stages: Record<string, string> = {
      queued: "Na fila",
      investigating: "Análise",
      waiting: "Aguardando decisão",
      eligibility: "Avaliação JEV",
      regression: "Teste de regressão",
      routing: "Classificação e encaminhamento",
      findings: "Ajustes da revisão",
      finalTests: "Testes finais",
      publication: "Aprovação de publicação",
      staging: "Integração em staging",
      humanValidation: "Validação humana",
      fixing: "Implementação",
      review: "Revisão",
      awaitingPublication: "Aprovação de publicação",
      integrating: "Integração em staging",
      e2e: "Validação no navegador",
      awaitingValidation: "Validação humana",
      done: "Concluído",
      handoff: "Encaminhamento",
      cancelled: "Cancelado",
    };
    const technical = !!run.error;
    const context: DecisionContext = {
      version: 1,
      decisionVersion,
      label:
        run.kind === "feature"
          ? "Feature · Development"
          : run.kind === "development"
            ? "Suporte · Bug Fix"
            : "Suporte · Bug Triage",
      stage: stages[run.state] ?? "Acompanhamento",
      title: this.clean(title, 300),
      summary: this.clean(
        details?.summary ??
          (technical
            ? "A execução foi interrompida por uma falha técnica; o progresso salvo foi preservado."
            : `Estamos acompanhando ${title}. A etapa atual precisa de uma decisão para continuar.`),
        1200,
      ),
      problem: this.clean(details?.problem ?? run.error ?? question, 1200),
      whyHuman: this.clean(
        details?.whyHuman ??
          (technical
            ? "Este é um bloqueio de execução, não uma decisão de produto. Corrija a causa antes de tentar novamente; pausar mantém o progresso salvo."
            : "Há um ponto pendente nesta etapa. Sua resposta será usada para continuar a análise; nenhum caminho foi escolhido automaticamente."),
        800,
      ),
      technical,
    };
    if (key) {
      context.issueKey = key;
      if (this.jiraBaseUrl) {
        try {
          const url = new URL(this.jiraBaseUrl);
          if (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          )
            context.issueUrl =
              url.toString().replace(/\/$/, "").replace(/\|/g, "%7C") +
              "/browse/" +
              key;
        } catch {}
      }
    }
    return context;
  }
}
