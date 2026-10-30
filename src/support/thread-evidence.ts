import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import type { Message } from "./types/message.js";
import type {
  ThreadReference,
  SourceThreadEvidence,
} from "./types/thread-evidence.js";
export class ThreadEvidence {
  constructor(private readonly slack: Messaging) {}
  async collect(
    messages: Message[],
    channel: string,
    thread: string,
  ): Promise<SourceThreadEvidence[]> {
    const references = new Map<string, ThreadReference>();
    for (const message of messages) {
      for (const match of message.text.matchAll(
        /https:\/\/grupo-arcca\.slack\.com\/archives\/(C[A-Z0-9]+)\/p(\d{10})(\d{6})(?=[?>\s]|$)/g,
      )) {
        const source = {
          channel: match[1]!,
          thread: `${match[2]}.${match[3]}`,
        };
        if (source.channel === channel && source.thread === thread) continue;
        references.set(`${source.channel}:${source.thread}`, source);
      }
    }
    if (references.size > 3)
      throw new Error(
        "More than three explicit source threads; narrow report evidence scope",
      );
    const sources: SourceThreadEvidence[] = [];
    for (const source of references.values()) {
      let replies: Message[];
      try {
        replies = await this.slack.replies(source.channel, source.thread);
      } catch {
        sources.push({
          ...source,
          capturedAt: Date.now(),
          messages: [],
          unavailable:
            "Source thread unavailable to the configured Slack identity; this is a collection limitation, not proof that evidence does not exist.",
        });
        continue;
      }
      if (Buffer.byteLength(JSON.stringify(replies)) > 100000)
        throw new Error("Source Slack thread exceeds evidence budget");
      sources.push({ ...source, capturedAt: Date.now(), messages: replies });
    }
    return sources;
  }
}
