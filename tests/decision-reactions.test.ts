import { DecisionPresentation } from "../src/decisions/presentation.js";
import { Effects } from "../src/runtime/effects.js";
import { EffectRejectedError } from "../src/runtime/effect-rejected-error.js";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { Store } from "../src/storage/store.js";
import { DecisionService } from "../src/decisions/decision-service.js";
import { decisionProposalSchema } from "../src/decisions/proposal-schema.js";
import type { MessageReaction } from "../src/integrations/types/message-reaction.js";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const run = store.create("development", "NOLA-test", "codex", "profile", {});
  let counter = 0;
  const messages: {
    user: string;
    ts: string;
    text: string;
    bot_id?: string;
  }[] = [];
  const selected: MessageReaction[] = [];
  const slack = {
    openPrivate: vi.fn(async () => "DPRIVATE"),
    find: vi.fn(async () => undefined),
    post: vi.fn(async () => `1.${String(++counter).padStart(6, "0")}`),
    replies: vi.fn(async () => messages),
    react: vi.fn(async () => {}),
    reactions: vi.fn(async () => selected),
    history: vi.fn(async () => []),
  };
  const service = new DecisionService(store, slack, "OWNER");
  return { store, run, slack, service, messages, selected };
}
it("prepares numbered choices with a recommendation without answering for the owner", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Como ordenar?", [], 1000, {
    choices: [
      { label: "Data", consequence: "Mais recentes primeiro" },
      { label: "ID", consequence: "Identificador decrescente" },
    ],
    recommendedIndex: 0,
    reason: "Preserva a preferência existente",
  });
  expect(JSON.parse(d.options)).toEqual(["Data", "ID"]);
  expect(d.status).toBe("pending");
  expect(f.slack.react.mock.calls).toEqual([
    ["DPRIVATE", "1.000002", "one"],
    ["DPRIVATE", "1.000002", "two"],
  ]);
  expect(f.slack.post.mock.calls[1]?.[1]).toContain("Recomendação: opção 1");
});
it.each(["Resposta livre com contexto", "2"])(
  "accepts a direct thread reply: %s",
  async (answer) => {
    const f = fixture();
    const d = await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
    f.messages.push({ user: "OWNER", ts: "2.000000", text: answer });
    await f.service.poll(2000);
    expect(f.service.list()[0]?.answer).toBe(answer === "2" ? "ID" : answer);
    expect(f.service.list()[0]?.status).toBe("answered");
    await f.service.poll(3000);
    expect(f.service.list()[0]?.id).toBe(d.id);
  },
);
it("recovers old pending questions and already posted free replies without reposting", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Pergunta antiga", [], 1000);
  f.store.db
    .prepare("DELETE FROM settings WHERE key=?")
    .run(`decision-message:${d.id}`);
  f.messages.push({
    user: "OWNER",
    ts: "2.000000",
    text: "Minha decisão já enviada",
  });
  const resumed = new DecisionService(f.store, f.slack, "DIFFERENT_DEFAULT");
  await resumed.poll(2000);
  expect(resumed.list()[0]?.answer).toBe("Minha decisão já enviada");
  expect(f.slack.post).toHaveBeenCalledTimes(2);
});
it("does not reuse an older answer for the next question in the same thread", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Primeira", [], 1000);
  f.messages.push({ user: "OWNER", ts: "1.000003", text: "Primeira resposta" });
  await f.service.poll(2000);
  await f.service.ask(f.run.id, "Segunda", [], 1000);
  await f.service.poll(2000);
  expect(f.service.list().find((x) => x.id !== d.id)?.status).toBe("pending");
});
it("ignores other users, bot messages and a different decision prefix", async () => {
  const f = fixture();
  await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
  f.messages.push(
    { user: "OTHER", ts: "2", text: "2" },
    { user: "OWNER", bot_id: "BOT", ts: "3", text: "2" },
    {
      user: "OWNER",
      ts: "4",
      text: "12345678-1234-1234-1234-123456789012: outra decisão",
    },
  );
  await f.service.poll(4000);
  expect(f.service.list()[0]?.status).toBe("pending");
});
it("accepts only the owner's reaction on the exact question message", async () => {
  const f = fixture();
  await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
  const event = {
    type: "reaction_added",
    user: "BOT",
    reaction: "two",
    event_ts: "2",
    item: { type: "message", channel: "DPRIVATE", ts: "1.000002" },
  };
  await f.service.reaction(event);
  expect(f.service.list()[0]?.status).toBe("pending");
  await f.service.reaction({
    ...event,
    user: "OWNER",
    item: { ...event.item, ts: "WRONG" },
  });
  expect(f.service.list()[0]?.status).toBe("pending");
  await f.service.reaction({ ...event, user: "OWNER" });
  expect(f.service.list()[0]?.answer).toBe("ID");
});
it("polling ignores bot reactions and ambiguous owner selections", async () => {
  const f = fixture();
  await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
  f.selected.push({ name: "one", users: ["BOT"] });
  await f.service.poll(2000);
  expect(f.service.list()[0]?.status).toBe("pending");
  f.selected[0]!.users.push("OWNER");
  f.selected.push({ name: "two", users: ["OWNER"] });
  await f.service.poll(3000);
  expect(f.service.list()[0]?.status).toBe("pending");
  f.selected.pop();
  await f.service.poll(4000);
  expect(f.service.list()[0]?.answer).toBe("Data");
});
it("keeps free replies available when reaction permissions fail", async () => {
  const f = fixture();
  f.slack.react.mockRejectedValue(new Error("missing_scope"));
  await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
  f.messages.push({ user: "OWNER", ts: "2", text: "Prefiro outro caminho" });
  await f.service.poll(2000);
  expect(f.service.list()[0]?.answer).toBe("Prefiro outro caminho");
});
it("validates proposal recommendations and remains JSON-schema compatible", () => {
  const p = {
    choices: [
      { label: "A", consequence: "a" },
      { label: "B", consequence: "b" },
    ],
    recommendedIndex: 0,
    reason: "Evidência",
  };
  expect(() => z.toJSONSchema(decisionProposalSchema)).not.toThrow();
  expect(
    decisionProposalSchema.safeParse({ ...p, recommendedIndex: 2 }).success,
  ).toBe(false);
  expect(
    decisionProposalSchema.safeParse({
      ...p,
      choices: [p.choices[0], p.choices[0]],
    }).success,
  ).toBe(false);
});
it("keeps ambiguous threads pending and respects paused runs", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Primeira", [], 1000);
  const other = f.store.create(
    "development",
    "NOLA-other",
    "codex",
    "profile",
    {},
  );
  other.data.privateThread = d.thread;
  f.store.save(other);
  await f.service.ask(other.id, "Outra pergunta", [], 1000);
  f.messages.push({
    user: "OWNER",
    ts: "2",
    text: "Resposta sem destino claro",
  });
  await f.service.poll(2000);
  expect(f.service.list().every((x) => x.status === "pending")).toBe(true);
  f.store.db.prepare("UPDATE runs SET paused=1 WHERE id=?").run(f.run.id);
  expect(
    f.service.accept({
      id: d.id,
      user: "OWNER",
      channel: d.channel!,
      thread: d.thread!,
      receipt: "new",
      version: d.version,
      answer: "Texto",
      at: 3000,
    }),
  ).toBe(false);
});
it("renders distinct Slack action IDs and accepts the selected numbered button", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Escolha", ["Data", "ID"], 1000);
  const rendered = new DecisionPresentation().render(d);
  const actions = rendered.blocks.find((b: any) => b.type === "actions") as {
    elements: { action_id: string; value: string }[];
  };
  expect(new Set(actions.elements.map((b) => b.action_id)).size).toBe(2);
  await f.service.action({
    user: { id: "OWNER" },
    channel: { id: "DPRIVATE" },
    message: { thread_ts: d.thread },
    actions: [{ ...actions.elements[1], action_ts: "2" }],
  });
  expect(f.service.list()[0]?.answer).toBe("ID");
});
it("retries definitive Slack rejection while preserving uncertain delivery protection", async () => {
  const f = fixture();
  const effects = new Effects(f.store);
  const perform = vi
    .fn()
    .mockRejectedValueOnce(new EffectRejectedError("invalid_blocks"))
    .mockResolvedValue("posted");
  await expect(
    effects.once(f.run.id, "rejected", async () => undefined, perform),
  ).rejects.toThrow("invalid_blocks");
  expect(
    await effects.once(f.run.id, "rejected", async () => undefined, perform),
  ).toBe("posted");
  await expect(
    effects.once(
      f.run.id,
      "uncertain",
      async () => undefined,
      async () => {
        throw new Error("timeout");
      },
    ),
  ).rejects.toThrow("timeout");
  await expect(
    effects.once(f.run.id, "uncertain", async () => undefined, perform),
  ).rejects.toThrow("uncertain outcome");
  expect(perform).toHaveBeenCalledTimes(2);
});
