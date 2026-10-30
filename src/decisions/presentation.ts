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
    return text
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
  render(
    d: Decision,
    proposal?: DecisionProposal,
  ): { text: string; blocks: unknown[] } {
    const options = JSON.parse(d.options) as string[],
      marker = `scabbers:decision:${d.id}:v${d.version}`;
    const lines = [
      `<@${d.userId}> ${this.escape(d.question)}`,
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
    lines.push(
      options.length
        ? "Clique em uma reação numerada desta mensagem, escolha um botão ou responda nesta thread com o número. Para outro caminho, escreva sua resposta livre. Selecione apenas uma opção."
        : "Responda livremente nesta thread com a informação solicitada.",
      `\`${marker}\``,
    );
    const text = lines.join("\n");
    const blocks: unknown[] = [];
    for (let index = 0; index < text.length; index += 2800)
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(index, index + 2800) },
      });
    if (options.length)
      blocks.push({
        type: "actions",
        elements: options.slice(0, 5).map((label, index) => ({
          type: "button",
          text: {
            type: "plain_text",
            text: `${index + 1}. ${label}`.slice(0, 75),
          },
          action_id: "scabbers_decision",
          value: JSON.stringify({ id: d.id, version: d.version, index }),
        })),
      });
    return { text, blocks };
  }
}
