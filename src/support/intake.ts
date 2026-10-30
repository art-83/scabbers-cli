import type { Soul } from "../profile/soul.js";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import { Schedule } from "./schedule.js";
import { hasTriage } from "./triage-detector.js";
export class Intake {
  constructor(
    private readonly store: Store,
    private readonly slack: Messaging,
    private readonly config: Config,
    private readonly soul?: Soul,
  ) {}
  async sweep(now = Date.now()): Promise<number> {
    if (!this.config.schedule)
      throw new Error("Configure support schedule before intake");
    const schedule = new Schedule(this.config.schedule);
    const key = `slack-watermark:${this.config.slack.channel}`;
    const oldest = String(
      this.store.getSetting(key) ?? (now / 1000).toFixed(6),
    );
    const snapshot = this.soul?.snapshotForNewRun();
    const profile =
      snapshot?.version ??
      String(this.store.getSetting("active-profile") ?? "");
    if (!profile)
      throw new Error(
        "Review and approve the first SOUL profile before intake",
      );
    const scanKey = `slack-scan:${this.config.slack.channel}`;
    const scan = (this.store.getSetting(scanKey) ?? {
      oldest,
      latest: (now / 1000).toFixed(6),
      cursor: null,
    }) as { oldest: string; latest: string; cursor: string | null };
    this.store.setSetting(scanKey, scan);
    let admitted = 0;
    for (;;) {
      let page;
      try {
        page = await this.slack.historyPage(
          this.config.slack.channel,
          scan.oldest,
          scan.latest,
          scan.cursor,
        );
      } catch (error) {
        if (
          (error as { data?: { error?: string } }).data?.error ===
          "invalid_cursor"
        ) {
          scan.cursor = null;
          this.store.setSetting(scanKey, scan);
        }
        throw error;
      }
      for (const message of page.messages) {
        const isTrustedReportBot = this.config.slack.reportBotIds.includes(
          message.bot_id ?? message.user ?? "",
        );
        if (
          (message.bot_id && !isTrustedReportBot) ||
          (message.subtype &&
            !(message.subtype === "bot_message" && isTrustedReportBot)) ||
          (message.thread_ts && message.thread_ts !== message.ts) ||
          !schedule.contains(Number(message.ts) * 1000)
        )
          continue;
        const thread = await this.slack.replies(
          this.config.slack.channel,
          message.ts,
        );
        if (hasTriage(thread)) continue;
        this.store.create(
          "support",
          `${this.config.slack.channel}:${message.ts}`,
          this.config.engine,
          profile,
          {
            ...(snapshot ? { soulSnapshot: snapshot } : {}),
            ownerSlackUser: this.config.slack.user,
            channel: this.config.slack.channel,
            thread: message.ts,
            text: message.text,
          },
        );
        admitted++;
      }
      scan.cursor = page.nextCursor;
      if (scan.cursor) {
        this.store.setSetting(scanKey, scan);
        continue;
      }
      this.store.transaction(() => {
        this.store.setSetting(key, scan.latest);
        this.store.db.prepare("DELETE FROM settings WHERE key=?").run(scanKey);
      });
      return admitted;
    }
  }
}
