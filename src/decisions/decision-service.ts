import { DecisionContextFactory } from "./context-factory.js";
import { decisionDetailsSchema } from "./details-schema.js";
import type {
  DecisionContext,
  DecisionDetails,
} from "./types/decision-context.js";
import { DecisionPresentation } from "./presentation.js";
import { decisionProposalSchema } from "./proposal-schema.js";
import type { DecisionProposal } from "./types/decision-proposal.js";
import type { DecisionMessage } from "./types/decision-message.js";
import type { DecisionReply } from "./types/decision-reply.js";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/store.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import { Effects } from "../runtime/effects.js";
import type { Decision } from "./types/decision.js";
export class DecisionService {
  private readonly effects: Effects;
  private readonly presentation = new DecisionPresentation();
  constructor(
    private readonly store: Store,
    private readonly slack: Messaging,
    private readonly userId: string,
    private readonly jiraBaseUrl?: string,
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
    proposal?: DecisionProposal,
    details?: DecisionDetails,
  ): Promise<Decision> {
    const preparedDetails = details
      ? decisionDetailsSchema.parse(details)
      : undefined;
    const prepared = proposal
      ? decisionProposalSchema.parse(proposal)
      : undefined;
    const choices = prepared
      ? prepared.choices.map((choice) => choice.label)
      : options;
    if (choices.length > 10)
      throw new Error("A private decision must offer at most ten choices");
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
          JSON.stringify(choices),
          now,
          now + 600_000,
        );
      const context = new DecisionContextFactory(this.jiraBaseUrl).create(
        this.store.get(runId),
        question,
        1,
        preparedDetails,
      );
      this.store.setSetting(`decision-context:${id}:v1`, context);
      if (prepared) this.store.setSetting(`decision-proposal:${id}`, prepared);
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
    const context = this.context(d);
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
            this.presentation.introduction(d, context, marker),
          ),
      );
      const run = this.store.get(d.runId);
      run.data.privateThread = root;
      run.data.privateChannel = d.channel;
      this.store.save(run);
    }
    const marker = `scabbers:decision:${d.id}:v${d.version}`;
    const proposal = this.store.getSetting(`decision-proposal:${d.id}`) as
      DecisionProposal | undefined;
    const rendered = this.presentation.render(d, proposal, context);
    const alreadyPosted = this.effects.completed<string>(marker) !== undefined;
    const timestamp = await this.effects.once(
      d.runId,
      marker,
      () => this.slack.find(d.channel!, marker, root),
      () => this.slack.post(d.channel!, rendered.text, root, rendered.blocks),
    );
    this.store.db
      .prepare("UPDATE decisions SET thread=? WHERE id=?")
      .run(root, d.id);
    d.thread = root;
    const previous = this.store.getSetting(`decision-message:${d.id}`) as
      DecisionMessage | undefined;
    const validPrevious =
      previous?.version === d.version &&
      previous.channel === d.channel &&
      previous.thread === root &&
      previous.timestamp === timestamp;
    const receipt: DecisionMessage = (validPrevious ? previous : undefined) ?? {
      timestamp,
      version: d.version,
      channel: d.channel,
      thread: root,
      numbered: !alreadyPosted,
      reactionsReady: alreadyPosted,
      lastReactionAttempt: 0,
    };
    this.store.setSetting(`decision-message:${d.id}`, receipt);
    await this.seed(d, receipt);
  }
  private context(d: Decision): DecisionContext {
    const saved = this.store.getSetting(
      `decision-context:${d.id}:v${d.version}`,
    ) as DecisionContext | undefined;
    return (
      saved ??
      new DecisionContextFactory(this.jiraBaseUrl).create(
        this.store.get(d.runId),
        d.question,
        d.version,
      )
    );
  }
  private message(d: Decision): DecisionMessage | undefined {
    const saved = this.store.getSetting(`decision-message:${d.id}`) as
      DecisionMessage | undefined;
    if (
      saved &&
      saved.version === d.version &&
      saved.channel === d.channel &&
      saved.thread === d.thread
    )
      return saved;
    const timestamp = this.effects.completed<string>(
      `scabbers:decision:${d.id}:v${d.version}`,
    );
    if (!timestamp || !d.channel || !d.thread) return undefined;
    return {
      timestamp,
      version: d.version,
      channel: d.channel,
      thread: d.thread,
      numbered: false,
      reactionsReady: true,
      lastReactionAttempt: 0,
    };
  }
  private async seed(
    d: Decision,
    message: DecisionMessage,
    now = Date.now(),
  ): Promise<void> {
    if (
      !message.numbered ||
      message.reactionsReady ||
      !this.slack.react ||
      (message.lastReactionAttempt > 0 &&
        now - message.lastReactionAttempt < 60000)
    )
      return;
    message.lastReactionAttempt = now;
    try {
      const options = JSON.parse(d.options) as string[];
      for (let index = 0; index < options.length; index++)
        await this.slack.react(
          message.channel,
          message.timestamp,
          DecisionPresentation.reactions[index]!,
        );
      message.reactionsReady = true;
    } catch {
      this.store.log(
        d.runId,
        "Numbered decision reactions unavailable; buttons and thread replies remain available. Check Slack reaction scopes/connection",
      );
    }
    this.store.setSetting(`decision-message:${d.id}`, message);
  }
  async reaction(payload: unknown): Promise<void> {
    const event = payload as {
      type?: string;
      user?: string;
      reaction?: string;
      event_ts?: string;
      item?: { type?: string; channel?: string; ts?: string };
    };
    if (
      event.type !== "reaction_added" ||
      event.item?.type !== "message" ||
      !event.event_ts
    )
      return;
    const index = DecisionPresentation.reactions.indexOf(event.reaction ?? "");
    if (index < 0) return;
    for (const d of this.list().filter((d) => d.status === "pending")) {
      const message = this.message(d);
      if (
        !message ||
        !message.numbered ||
        message.channel !== event.item.channel ||
        message.timestamp !== event.item.ts
      )
        continue;
      const options = JSON.parse(d.options) as string[];
      if (!options[index]) continue;
      this.accept({
        id: d.id,
        user: event.user ?? "",
        channel: message.channel,
        thread: message.thread,
        version: message.version,
        receipt: `reaction:${message.channel}:${message.timestamp}:${event.event_ts}:${event.user}`,
        answer: options[index],
        at: Number(event.event_ts) * 1000,
      });
    }
  }
  accept(input: DecisionReply): boolean {
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
        const receipt = this.message(d);
        const tagged = message.text.startsWith(prefix);
        const onlyPending =
          this.list().filter(
            (x) =>
              x.status === "pending" &&
              x.channel === d.channel &&
              x.thread === d.thread,
          ).length === 1;
        if (
          !tagged &&
          (!onlyPending ||
            !receipt ||
            Number(message.ts) <= Number(receipt.timestamp) ||
            /^[0-9a-f]{8}-[0-9a-f-]{27,}:/i.test(message.text))
        )
          continue;
        this.accept({
          id: d.id,
          user: message.user,
          channel: d.channel,
          thread: d.thread,
          receipt: `${d.channel}:${message.ts}`,
          version: d.version,
          answer: this.presentation.answer(
            tagged ? message.text.slice(prefix.length) : message.text,
            JSON.parse(d.options) as string[],
          ),
          at: Number(message.ts) * 1000,
        });
      }
      if (this.list().find((x) => x.id === d.id)?.status === "pending") {
        const message = this.message(d);
        if (message) {
          await this.seed(d, message, now);
          if (
            message.numbered &&
            this.slack.reactions &&
            (JSON.parse(d.options) as string[]).length
          ) {
            try {
              const reactions = await this.slack.reactions(
                message.channel,
                message.timestamp,
              );
              const options = JSON.parse(d.options) as string[];
              const selected = reactions.filter(
                (reaction) =>
                  reaction.users.includes(d.userId) &&
                  DecisionPresentation.reactions.indexOf(reaction.name) >= 0 &&
                  DecisionPresentation.reactions.indexOf(reaction.name) <
                    options.length,
              );
              if (selected.length === 1)
                this.accept({
                  id: d.id,
                  user: d.userId,
                  channel: message.channel,
                  thread: message.thread,
                  version: message.version,
                  receipt: `reaction-poll:${d.id}:v${d.version}:${message.timestamp}:${selected[0]!.name}`,
                  answer:
                    options[
                      DecisionPresentation.reactions.indexOf(selected[0]!.name)
                    ]!,
                  at: now,
                });
            } catch {
              this.store.log(
                d.runId,
                "Cannot read decision reactions; reply in the private thread or use a button",
              );
            }
          }
        }
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
            this.presentation.reminder(
              d,
              this.context(d),
              marker,
              this.store.getSetting(`decision-proposal:${d.id}`) as
                DecisionProposal | undefined,
            ),
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
      if (!/^scabbers_decision(?:_[0-9]+)?$/.test(action.action_id)) continue;
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
