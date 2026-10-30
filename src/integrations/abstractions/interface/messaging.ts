import type { MessagePage } from "../../../support/types/message-page.js";
import type { Message } from "../../../support/types/message.js";
export interface Messaging {
  historyPage(
    channel: string,
    oldest: string,
    latest: string,
    cursor: string | null,
  ): Promise<MessagePage>;
  openPrivate(user: string): Promise<string>;
  history(channel: string, oldest: string, latest?: string): Promise<Message[]>;
  replies(channel: string, thread: string): Promise<Message[]>;
  post(
    channel: string,
    text: string,
    thread?: string,
    blocks?: unknown[],
  ): Promise<string>;
  find(
    channel: string,
    marker: string,
    thread?: string,
  ): Promise<string | undefined>;
}
