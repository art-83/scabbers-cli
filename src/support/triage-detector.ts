import type { Message } from "./types/message.js";
export function hasTriage(messages: Message[]): boolean {
  return messages.some(
    ({ text }) =>
      /nola-bug-management\/report-triage\/[A-Z][A-Z0-9]+-\d+|scabbers:triage:[a-zA-Z0-9:._-]+/.test(
        text,
      ) ||
      (/\btriagem\s*(?:conclu[ií]da|publicada|do report)\b/i.test(text) &&
        /\b(?:Bug Cr[ií]tico|Bug|Ticket|Duplicado|Cancelado|encaminhamento)\b/i.test(
          text,
        ) &&
        /https:\/\/[^\s]+\/browse\/[A-Z]+-\d+/.test(text)),
  );
}
