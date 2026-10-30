import type { DecisionContext } from "./types/decision-context.js";
import { redactLog } from "../logging/log-redactor.js";
import type { Decision } from "./types/decision.js";
import type { DecisionProposal } from "./types/decision-proposal.js";
export class DecisionPresentation {
  static readonly reactions = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "keycap_ten",
  ];
  private escape(text: string): string {
    return redactLog(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  answer(text: string, options: readonly string[]): string {
    const value = text.trim();
    const number = /^(?:op[cç][aã]o\s*)?(10|[1-9])[.)]?$/iu.exec(value);
    if (number) return options[Number(number[1]) - 1] ?? value;
    return (
      options.find((option) => option.toLowerCase() === value.toLowerCase()) ??
      value
    );
  }
  private buttonLabel(text: string): string {
    const label = text.slice(0, 75);
    return /[\uD800-\uDBFF]$/.test(label) ? label.slice(0, -1) : label;
  }
  private header(context: DecisionContext): string {
    const card = context.issueUrl
      ? `<${context.issueUrl}|${this.escape(context.issueKey!)}>`
      : context.issueKey
        ? this.escape(context.issueKey) + " · "
        : "";
    return `*${this.escape(context.label)}* · ${card} ${this.escape(context.title)}\n*Etapa:* ${this.escape(context.stage)}${context.technical ? " · Bloqueio técnico" : ""}`;
  }
  introduction(d: Decision, context: DecisionContext, marker: string): string {
    return `<@${d.userId}> ${this.header(context)}\n*Contexto:* ${this.escape(context.summary)}\nAcompanhamento privado desta demanda.\n${marker}`;
  }
  reminder(
    d: Decision,
    context: DecisionContext,
    marker: string,
    proposal?: DecisionProposal,
  ): string {
    const rendered = this.render(d, proposal, context).text;
    const nonce = `\`scabbers:decision:${d.id}:v${d.version}\``;
    return (
      "*Lembrete — decisão pendente*\n" +
      rendered
        .replace(nonce, "")
        .replace(
          "Clique em uma reação numerada desta mensagem, escolha um botão ou responda nesta thread com o número. Para outro caminho, escreva sua resposta livre. Selecione apenas uma opção.",
          "Responda nesta thread com o número ou texto livre. Os botões e reações estão na mensagem original. Selecione apenas uma opção.",
        ) +
      "\n" +
      marker
    );
  }
  render(
    d: Decision,
    proposal?: DecisionProposal,
    context?: DecisionContext,
  ): { text: string; blocks: unknown[] } {
    const options = JSON.parse(d.options) as string[],
      marker = `scabbers:decision:${d.id}:v${d.version}`;
    const lines = [
      ...(context
        ? [
            `<@${d.userId}> ${this.header(context)}`,
            `*Contexto:* ${this.escape(context.summary)}`,
            `*Problema:* ${this.escape(context.problem)}`,
            `*Por que preciso de você:* ${this.escape(context.whyHuman)}`,
            `*${context.technical ? "Ação necessária" : "Decisão"}:* ${this.escape(d.question)}`,
          ]
        : [`<@${d.userId}> ${this.escape(d.question)}`]),
      ...options.map(
        (option, index) =>
          `${index + 1}. ${this.escape(option)}${proposal?.choices[index] ? " — " + this.escape(proposal.choices[index]!.consequence) : ""}`,
      ),
    ];
    if (proposal)
      lines.push(
        proposal.recommendedIndex === null
          ? `Sem recomendação fechada: ${this.escape(proposal.reason)}`
          : `*Recomendação: opção ${proposal.recommendedIndex + 1}.* ${this.escape(proposal.reason)}`,
      );
    if (!proposal && context?.technical)
      lines.push(
        options.includes("Pause") && options.includes("Retry checkpoint")
          ? "*Orientação:* Pause enquanto a causa não estiver resolvida. Use Retry checkpoint apenas depois de corrigi-la; essa opção não corrige o problema automaticamente."
          : "*Orientação:* Resolva a causa técnica antes de repetir a etapa; uma resposta nesta thread não corrige o problema automaticamente.",
      );
    lines.push(
      options.length
        ? "Clique em uma reação numerada desta mensagem, escolha um botão ou responda nesta thread com o número. Para outro caminho, escreva sua resposta livre. Selecione apenas uma opção."
        : "Responda livremente nesta thread com a informação solicitada.",
      `\`${marker}\``,
    );
    const text = lines.join("\n");
    const blocks: unknown[] = [];
    for (let index = 0; index < text.length;) {
      let end = Math.min(index + 2800, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(index, end) },
      });
      index = end;
    }
    if (options.length)
      blocks.push({
        type: "actions",
        elements: options.slice(0, 5).map((label, index) => ({
          type: "button",
          text: {
            type: "plain_text",
            text: this.buttonLabel(`${index + 1}. ${redactLog(label)}`),
          },
          action_id: `scabbers_decision_${index}`,
          value: JSON.stringify({ id: d.id, version: d.version, index }),
        })),
      });
    return { text, blocks };
  }
}
