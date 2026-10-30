import type { Message } from "./message.js";
export type MessagePage = { messages: Message[]; nextCursor: string | null };
