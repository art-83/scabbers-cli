import type { MessageReaction } from "../types/message-reaction.js";
import type { MessagePage } from "../../support/types/message-page.js";
import type { Messaging } from "../abstractions/interface/messaging.js";
import { WebClient } from "@slack/web-api";
import type { Message } from "../../support/types/message.js";
export class SlackClient implements Messaging {
  readonly web: WebClient;
  constructor(token: string) {
    this.web = new WebClient(token, {
      retryConfig: { retries: 3 },
      rejectRateLimitedCalls: true,
    });
  }
  async react(channel: string, timestamp: string, name: string): Promise<void> {
    try {
      await this.web.reactions.add({ channel, timestamp, name });
    } catch (error) {
      if (
        (error as { data?: { error?: string } }).data?.error !==
        "already_reacted"
      )
        throw error;
    }
  }
  async reactions(
    channel: string,
    timestamp: string,
  ): Promise<MessageReaction[]> {
    const response = await this.web.reactions.get({
      channel,
      timestamp,
      full: true,
    });
    if (response.type !== "message" || !response.message)
      throw new Error("Slack reaction target is not a message");
    return (response.message.reactions ?? []).map((reaction) => ({
      name: reaction.name ?? "",
      users: reaction.users ?? [],
    }));
  }
  async openPrivate(user: string): Promise<string> {
    const response = await this.web.conversations.open({ users: user });
    if (!response.channel?.id)
      throw new Error("Cannot open private owner channel");
    return response.channel.id;
  }
  async historyPage(
    channel: string,
    oldest: string,
    latest: string,
    cursor: string | null,
  ): Promise<MessagePage> {
    const result = await this.web.conversations.history({
      channel,
      oldest,
      latest,
      inclusive: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    return {
      messages: (result.messages ?? []) as Message[],
      nextCursor: result.response_metadata?.next_cursor || null,
    };
  }
  async history(
    channel: string,
    oldest: string,
    latest?: string,
  ): Promise<Message[]> {
    const messages: Message[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.web.conversations.history({
        channel,
        oldest,
        ...(latest ? { latest } : {}),
        inclusive: true,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      messages.push(...((result.messages ?? []) as Message[]));
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    return messages;
  }
  async replies(channel: string, ts: string): Promise<Message[]> {
    const messages: Message[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.web.conversations.replies({
        channel,
        ts,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      messages.push(...((result.messages ?? []) as Message[]));
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    return messages;
  }
  async post(
    channel: string,
    text: string,
    thread?: string,
    blocks?: unknown[],
  ): Promise<string> {
    const result = await this.web.chat.postMessage({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false,
      ...(thread ? { thread_ts: thread } : {}),
      ...(blocks ? { blocks: blocks as never } : {}),
    });
    if (!result.ts) throw new Error("Slack did not return a timestamp");
    return result.ts;
  }
  async find(
    channel: string,
    marker: string,
    thread?: string,
  ): Promise<string | undefined> {
    const messages = thread
      ? await this.replies(channel, thread)
      : await this.history(channel, "0");
    return messages.find((m) => m.text?.includes(marker))?.ts;
  }
}
