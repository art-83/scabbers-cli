import type { Message } from "./message.js";
export type ThreadReference = { channel: string; thread: string };
export type SourceThreadEvidence = ThreadReference & {
  capturedAt: number;
  messages: Message[];
  unavailable?: string;
};
