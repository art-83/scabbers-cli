import { randomUUID } from "node:crypto";
import type { Store } from "../storage/store.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import { Effects } from "../runtime/effects.js";
import type { Decision } from "./types/decision.js";
export class DecisionService {
  private readonly effects: Effects;
  constructor(
    private readonly store: Store,
    private readonly slack: Messaging,
    private readonly userId: string,
  ) {
    this.effects = new Effects(store);
  }
  list(): Decision[] {
    return this.store.db
      .prepare("SELECT * FROM decisions ORDER BY createdAt")
      .all() as Decision[];
  }
  async ask(
    runId: string,
    question: string,
    options: string[],
    now = Date.now(),
  ): Promise<Decision> {
    let decision = this.list().find(
      (d) => d.runId === runId && d.status === "pending",
    );
    if (!decision) {
      const id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO decisions(id,runId,userId,question,options,createdAt,nextReminder) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id,
          runId,
          String(
            this.store.get(runId).data.ownerSlackUser ??
              this.list().find((previous) => previous.runId === runId)
                ?.userId ??
              this.userId,
          ),
          question,
          JSON.stringify(options),
          now,
          now + 600_000,
        );
      decision = this.list().find((d) => d.id === id)!;
    }
    await this.deliver(decision);
    return this.list().find((d) => d.id === decision.id)!;
  }
  private async deliver(d: Decision): Promise<void> {
    if (!d.channel) {
      d.channel = await this.slack.openPrivate(d.userId);
      this.store.db
        .prepare("UPDATE decisions SET channel=? WHERE id=?")
        .run(d.channel, d.id);
    }
    let root = this.store.get(d.runId).data.privateThread as string | undefined;
    if (!root) {
      const marker = `scabbers:run:${d.runId}`;
      root = await this.effects.once(
        d.runId,
        marker,
        () => this.slack.find(d.channel!, marker),
        () =>
          this.slack.post(
            d.channel!,
            `<@${d.userId}> Acompanhamento privado da demanda ${this.store.get(d.runId).source}. ${marker}`,
          ),
      );
      const run = this.store.get(d.runId);
      run.data.privateThread = root;
      run.data.privateChannel = d.channel;
      this.store.save(run);
    }
    const marker = `scabbers:decision:${d.id}:v${d.version}`;
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${d.userId}> ${d.question}\nResponda nesta thread com o código da decisão e sua opção ou contexto adicional. \`${marker}\``,
        },
      },
      {
        type: "actions",
        elements: (JSON.parse(d.options) as string[])
          .slice(0, 5)
          .map((label, index) => ({
            type: "button",
            text: { type: "plain_text", text: label.slice(0, 75) },
            action_id: "scabbers_decision",
            value: JSON.stringify({ id: d.id, version: d.version, index }),
          })),
      },
    ];
    if (!(blocks[1] as { elements: unknown[] }).elements.length) blocks.pop();
    await this.effects.once(
      d.runId,
      marker,
      () => this.slack.find(d.channel!, marker, root),
      () =>
        this.slack.post(
          d.channel!,
          `<@${d.userId}> ${d.question} ${marker}`,
          root,
          blocks,
        ),
    );
    this.store.db
      .prepare("UPDATE decisions SET thread=? WHERE id=?")
      .run(root, d.id);
  }
  accept(input: {
    id: string;
    user: string;
    channel: string;
    thread: string;
    receipt: string;
    version: number;
    answer: string;
    at: number;
  }): boolean {
    return this.store.transaction(() => {
      const d = this.list().find((d) => d.id === input.id);
      if (
        !d ||
        d.status !== "pending" ||
        d.userId !== input.user ||
        d.channel !== input.channel ||
        d.thread !== input.thread ||
        d.version !== input.version ||
        input.at < d.createdAt ||
        !Number.isFinite(input.at) ||
        !input.receipt.trim() ||
        !input.answer.trim()
      )
        return false;
      const run = this.store.get(d.runId);
      if (run.paused || run.state === "cancelled") return false;
      if (
        this.store.db
          .prepare("INSERT OR IGNORE INTO receipts VALUES(?,?)")
          .run(input.receipt, d.id).changes !== 1
      )
        return false;
      this.store.db
        .prepare("UPDATE decisions SET status=?,answer=? WHERE id=?")
        .run("answered", input.answer.trim(), d.id);
      if (input.answer.trim() === "Pause")
        this.store.db
          .prepare("UPDATE runs SET paused=1 WHERE id=?")
          .run(d.runId);
      return true;
    });
  }
  async poll(now = Date.now()): Promise<void> {
    for (const d of this.list().filter((d) => d.status === "pending")) {
      const run = this.store.get(d.runId);
      if (run.paused || run.state === "cancelled") continue;
      if (!d.channel || !d.thread) {
        await this.deliver(d);
        continue;
      }
      const replies = await this.slack.replies(d.channel, d.thread);
      for (const message of replies) {
        if (
          message.bot_id ||
          message.user !== d.userId ||
          Number(message.ts) * 1000 < d.createdAt
        )
          continue;
        const prefix = `${d.id}:`;
        if (!message.text.startsWith(prefix)) continue;
        this.accept({
          id: d.id,
          user: message.user,
          channel: d.channel,
          thread: d.thread,
          receipt: `${d.channel}:${message.ts}`,
          version: d.version,
          answer: message.text.slice(prefix.length),
          at: Number(message.ts) * 1000,
        });
      }
      if (
        this.list().find((x) => x.id === d.id)?.status !== "pending" ||
        now < d.nextReminder
      )
        continue;
      const marker = `scabbers:reminder:${d.id}:${d.nextReminder}`;
      await this.effects.once(
        d.runId,
        marker,
        () => this.slack.find(d.channel!, marker, d.thread!),
        () =>
          this.slack.post(
            d.channel!,
            `<@${d.userId}> Decisão pendente: ${d.question}\nResponda com ${d.id}: sua resposta. ${marker}`,
            d.thread!,
          ),
      );
      this.store.db
        .prepare("UPDATE decisions SET nextReminder=? WHERE id=? AND status=?")
        .run(now + 600_000, d.id, "pending");
    }
  }
  async action(payload: unknown): Promise<void> {
    const body = payload as {
      user?: { id: string };
      channel?: { id: string };
      message?: { thread_ts?: string; ts?: string };
      actions?: { action_id: string; value: string; action_ts?: string }[];
      action_ts?: string;
    };
    for (const action of body.actions ?? []) {
      if (action.action_id !== "scabbers_decision") continue;
      const value = JSON.parse(action.value);
      const actionTimestamp = action.action_ts ?? body.action_ts;
      if (!actionTimestamp) continue;
      const d = this.list().find((d) => d.id === value.id);
      if (!d) continue;
      const options = JSON.parse(d.options) as string[];
      const answer = options[value.index];
      if (!answer) continue;
      this.accept({
        id: d.id,
        user: body.user?.id ?? "",
        channel: body.channel?.id ?? "",
        thread: body.message?.thread_ts ?? body.message?.ts ?? "",
        receipt: `action:${body.channel?.id}:${actionTimestamp}`,
        version: value.version,
        answer,
        at: Number(actionTimestamp) * 1000,
      });
    }
  }
}
