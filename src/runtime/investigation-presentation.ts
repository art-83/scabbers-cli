import type { InvestigationRecord } from "./types/investigation.js";
import { redactLog } from "../logging/log-redactor.js";

export class InvestigationPresentation {
  private readonly labels: Record<string, string> = {
    verdict: "Avaliação de elegibilidade",
    classification: "Classificação",
    score: "Pontuação",
    rubric: "Critério de avaliação",
    answers: "Resultados das avaliações",
    confidence: "Confiança informada",
    probabilities: "Distribuição da avaliação",
    autonomous_track: "Elegibilidade de execução autônoma",
    eligible: "Elegível",
    eligible_with_decision: "Elegível com decisão",
    not_eligible: "Não elegível",
    testable: "Testabilidade",
    type: "Tipo",
    noul: "Indicador",
    choice: "Alternativa escolhida",
    reason: "Justificativa",
    consequence: "Consequência",
    label: "Opção",
    facts: "Fatos",
    hypotheses: "Hipóteses",
    form: "Plano analisado",
    summary: "Resumo",
    request: "Objetivo",
    baseline: "Situação atual",
    component: "Componente",
    environment: "Ambiente",
    repositories: "Repositórios",
    products: "Produtos",
    issueType: "Tipo de card",
    labels: "Etiquetas",
    domains: "Áreas afetadas",
    evidence: "Evidências",
    code: "Referências de código",
    repository: "Repositório",
    path: "Arquivo",
    line: "Linha",
    excerpt: "Trecho observado",
    source: "Origem",
    kind: "Tipo",
    coverage: "Cobertura dos cards",
    key: "Card",
    acceptance: "Critérios de aceite",
    approach: "Abordagem",
    dependencies: "Dependências",
    technicalPrerequisites: "Pré-requisitos técnicos",
    disposition: "Tratamento",
    implementation: "Implementação proposta",
    files: "Arquivos",
    failing_test: "Teste de regressão proposto",
    open_decisions: "Decisões pendentes",
    risks: "Riscos",
    requires_outside_code: "Dependências externas",
    needed: "Necessário",
    action: "Ação",
    what: "Detalhamento",
    actionRequired: "Próximo passo",
    technicalBlocker: "Motivo do bloqueio",
    savedPlan: "Plano preservado",
    missingCapabilities: "Capacidades indisponíveis",
    creationPlan: "Plano de criação",
    issueKey: "Card",
    diagnosis: "Diagnóstico",
    objective: "Objetivo",
    unknowns: "Informações ainda não verificadas",
    mode: "Modo",
    targets: "Alvos",
    aws: "Identidade AWS",
    accountId: "Conta",
    profile: "Perfil",
    region: "Região",
    steps: "Etapas",
    preconditions: "Pré-condições",
    successCriteria: "Critérios de sucesso",
    testing: "Estratégia de testes",
    rollback: "Plano de reversão",
    idempotency: "Proteção contra repetição",
    question: "Pergunta",
    proposed_default: "Opção proposta",
    proposal: "Alternativas",
    context: "Contexto",
    problem: "Problema",
    whyHuman: "Por que precisa de intervenção humana",
    choices: "Opções",
    recommendedIndex: "Índice da recomendação",
    recommendationReason: "Motivo da recomendação",
  };
  private escape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/([`*_[\]<>#])/g, "\\$1");
  }
  private label(key: string): string {
    return (
      this.labels[key] ??
      key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")
    );
  }
  private heading(label: string, depth: number): string {
    return "#".repeat(Math.min(6, depth)) + " " + this.escape(label);
  }
  private value(value: unknown): string {
    if (value === null || value === undefined) return "Não informado";
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    return this.escape(String(value));
  }
  private details(value: unknown, depth = 3): string[] {
    if (Array.isArray(value))
      return value.length
        ? value.flatMap((entry, index) =>
            entry && typeof entry === "object"
              ? [
                  this.heading(
                    String(
                      (entry as Record<string, unknown>).key ??
                        `Item ${index + 1}`,
                    ),
                    depth,
                  ),
                  ...this.details(entry, depth + 1),
                ]
              : ["- " + this.value(entry).replace(/\n/g, "\n  ")],
          )
        : ["Nenhum item registrado."];
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([key, entry]) => {
        if (key === "investigation") return [];
        const label = this.label(key);
        if (entry && typeof entry === "object")
          return [
            this.heading(label, depth),
            ...this.details(entry, depth + 1),
          ];
        return [`**${this.escape(label)}:** ${this.value(entry)}`];
      });
    return [this.value(value)];
  }
  markdown(record: InvestigationRecord): string {
    const r = record.result;
    const status = {
      passed: "Análise concluída",
      blocked: "Impedimento registrado",
      failed: "Falha observada",
      question: "Decisão pendente",
    }[r.status];
    const sections = [
      "## Investigação do Scabbers",
      `**Situação:** ${status}`,
      `**Etapa:** ${this.escape(record.stage)}`,
      record.member ? `**Card analisado:** ${this.escape(record.member)}` : "",
      "### Contexto e conclusão",
      this.escape(r.summary),
      "### Evidências consultadas",
      ...r.evidence.map((e) => "- " + this.escape(e).replace(/\n/g, "\n  ")),
    ];
    if (r.decisionContext)
      sections.push(
        "### Problema e necessidade de intervenção",
        ...this.details(r.decisionContext, 4),
      );
    if (r.question)
      sections.push(
        "### Decisão ou informação necessária",
        this.escape(r.question),
      );
    if (r.options.length)
      sections.push(
        "### Opções",
        ...r.options.map((o, i) => `${i + 1}. ${this.escape(o)}`),
      );
    if (r.decision) {
      sections.push(
        "### Recomendação e consequências",
        ...r.decision.choices.map(
          (choice, index) =>
            `${index + 1}. **${this.escape(choice.label)}:** ${this.escape(choice.consequence)}`,
        ),
      );
      if (r.decision.recommendedIndex !== null)
        sections.push(
          `**Opção recomendada:** ${r.decision.recommendedIndex + 1}. ${this.escape(r.decision.choices[r.decision.recommendedIndex]!.label)}`,
        );
      sections.push(this.escape(r.decision.reason));
    }
    if (record.revisions && Object.keys(record.revisions).length)
      sections.push(
        "### Revisões de código",
        ...this.details(record.revisions, 4),
      );
    if (Object.keys(r.data).length)
      sections.push("### Detalhes da investigação", ...this.details(r.data));
    sections.push(
      "### Limites deste registro",
      "Esta investigação preserva evidências e limitações para retomada. Não autoriza implementação, publicação ou operação. Testes lidos não equivalem a testes executados.",
    );
    return redactLog(sections.filter(Boolean).join("\n\n"));
  }
  parts(record: InvestigationRecord): string[] {
    const result: string[] = [];
    let current = "";
    for (const paragraph of this.markdown(record).split("\n\n")) {
      if (current && current.length + paragraph.length + 2 > 10000) {
        result.push(current);
        current = "";
      }
      let remaining = paragraph;
      while (remaining.length > 10000) {
        if (current) {
          result.push(current);
          current = "";
        }
        result.push(remaining.slice(0, 10000));
        remaining = remaining.slice(10000);
      }
      current += (current ? "\n\n" : "") + remaining;
    }
    if (current) result.push(current);
    return result;
  }
}
