import { afterEach, expect, it, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { DecisionService } from "../src/decisions/decision-service.js";
import { DecisionContextFactory } from "../src/decisions/context-factory.js";
import { DecisionPresentation } from "../src/decisions/presentation.js";
import type { RunKind } from "../src/workflows/types/run.js";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
function fixture(kind: RunKind = "feature") {
  const store = new Store(":memory:");
  stores.push(store);
  let count = 0;
  const run = store.create(
    kind,
    "PNOLA-1@internal-digest",
    "codex",
    "profile",
    {
      issueKey: "PNOLA-1",
      issue: {
        key: "PNOLA-1",
        fields: {
          summary: "Histórico de Pedidos",
          issuetype: { name: "Epic" },
        },
      },
    },
  );
  run.state = "investigating";
  store.save(run);
  const slack = {
    openPrivate: async () => "D",
    find: async () => undefined,
    post: vi.fn(
      async (
        _channel: string,
        _text: string,
        _thread?: string,
        _blocks?: unknown[],
      ) => `1.${String(++count).padStart(6, "0")}`,
    ),
    react: vi.fn(async () => {}),
    reactions: async () => [],
    replies: async () => [],
    history: async () => [],
    historyPage: async () => ({ messages: [], nextCursor: null }),
  };
  const service = new DecisionService(
    store,
    slack,
    "OWNER",
    "https://jira.example.test",
  );
  return { store, run, slack, service };
}
it.each([
  ["support", "Suporte · Bug Triage"],
  ["development", "Suporte · Bug Fix"],
  ["feature", "Feature · Development"],
] as const)(
  "labels %s decisions and their initial follow-up with the verified card",
  async (kind, label) => {
    const f = fixture(kind);
    await f.service.ask(f.run.id, "Qual regra?", ["A", "B"], 1000, undefined, {
      summary: "Três histórias tratam ordenação e busca.",
      problem: "Falta definir o tratamento de um caso-limite.",
      whyHuman: "Não há regra explícita no card para esse caso.",
    });
    const [root, decision] = f.slack.post.mock.calls;
    for (const message of [root![1], decision![1]]) {
      expect(message).toContain(label);
      expect(message).toContain("Histórico de Pedidos");
      expect(message).toContain("https://jira.example.test/browse/PNOLA-1");
      expect(message).not.toContain("internal-digest");
    }
    expect(decision![1]).toContain("Três histórias");
    expect(decision![1]).toContain("Falta definir");
    expect(decision![1]).toContain("Não há regra explícita");
    expect(decision![1]).toContain("*Etapa:* Análise");
  },
);
it("keeps a decision's context stable across restart and reminder", async () => {
  const f = fixture();
  const d = await f.service.ask(
    f.run.id,
    "Qual regra?",
    ["A", "B"],
    1000,
    undefined,
    { summary: "Contexto original" },
  );
  const run = f.store.get(f.run.id);
  run.data.issue = { key: "PNOLA-OTHER", fields: { summary: "Outro card" } };
  run.state = "waiting";
  f.store.save(run);
  await new DecisionService(
    f.store,
    f.slack,
    "OTHER",
    "https://different.example.test",
  ).poll(602000);
  const reminder = f.slack.post.mock.calls.at(-1)![1];
  expect(reminder).toContain("Contexto original");
  expect(reminder).toContain("Histórico de Pedidos");
  expect(reminder).not.toContain("Outro card");
  expect(reminder).toContain("Etapa:* Análise");
  expect(reminder).toContain("mensagem original");
  expect(f.service.list()[0]!.status).toBe("pending");
  expect(f.service.list()[0]!.id).toBe(d.id);
});
it("labels infrastructure failures as technical blockers and conditions retries on fixing their cause", async () => {
  const f = fixture();
  const run = f.store.get(f.run.id);
  run.error = "Cannot create isolated analysis worktree";
  f.store.save(run);
  await f.service.ask(
    run.id,
    "Como deseja acompanhar este bloqueio?",
    ["Retry checkpoint", "Pause"],
    1000,
  );
  const text = f.slack.post.mock.calls[1]![1];
  expect(text).toContain("Bloqueio técnico");
  expect(text).toContain("não uma decisão de produto");
  expect(text).toContain("Cannot create isolated");
  expect(text).toContain("apenas depois");
  expect(text).not.toContain("Checkpoint investigating blocked for");
});
it("recovers metadata for legacy questions without reposting or attaching another card", async () => {
  const f = fixture();
  const d = await f.service.ask(f.run.id, "Old question", [], 1000);
  f.store.db
    .prepare("DELETE FROM settings WHERE key=?")
    .run(`decision-context:${d.id}:v1`);
  await f.service.poll(602000);
  expect(f.slack.post).toHaveBeenCalledTimes(3);
  expect(f.slack.post.mock.calls[2]![1]).toContain("Histórico de Pedidos");
  const run = f.store.get(f.run.id);
  run.data.issueKey = "PNOLA-2";
  const context = new DecisionContextFactory(
    "https://jira.example.test",
  ).create(run, "Pergunta", 1);
  expect(context.issueKey).toBeUndefined();
  expect(context.title).toBe("Demanda em análise");
});
it("escapes and redacts untrusted text, and preserves Slack block/button limits", async () => {
  const f = fixture();
  const run = f.store.get(f.run.id);
  run.data.issue.fields.summary = "<@ALL> xoxb-fake-token-value";
  f.store.save(run);
  const d = await f.service.ask(
    run.id,
    "Pergunta " + "🙂".repeat(2000),
    ["A".repeat(200), "B"],
    1000,
    undefined,
    { summary: "<https://evil.example|click> contexto" },
  );
  const text = f.slack.post.mock.calls[1]![1];
  expect(text).not.toContain("xoxb-fake-token-value");
  expect(text).not.toContain("<@ALL>");
  expect(text).toContain("&lt;@ALL&gt;");
  const context = new DecisionContextFactory().create(
    f.store.get(run.id),
    d.question,
    1,
  );
  const rendered = new DecisionPresentation().render(d, undefined, context);
  for (const block of rendered.blocks as any[]) {
    if (block.type === "section") {
      expect(block.text.text.length).toBeLessThanOrEqual(3000);
      expect(/[\uD800-\uDBFF]$/.test(block.text.text)).toBe(false);
    }
    if (block.type === "actions") {
      expect(new Set(block.elements.map((b: any) => b.action_id)).size).toBe(
        block.elements.length,
      );
      expect(block.elements.every((b: any) => b.text.text.length <= 75)).toBe(
        true,
      );
    }
  }
});
it("validates supplied context before creating a pending decision", async () => {
  const f = fixture();
  await expect(
    f.service.ask(f.run.id, "Q", [], 1000, undefined, { summary: "" }),
  ).rejects.toThrow();
  expect(f.service.list()).toEqual([]);
});
it("includes choices and their recommendation in reminders without changing reaction targets", async () => {
  const f = fixture();
  await f.service.ask(
    f.run.id,
    "Escolha",
    [],
    1000,
    {
      choices: [
        { label: "Seguir padrão", consequence: "Preserva comportamento" },
        { label: "Outra alternativa", consequence: "Exige nova regra" },
      ],
      recommendedIndex: 0,
      reason: "Menor mudança compatível",
    },
    { summary: "Contexto conhecido" },
  );
  const seeds = f.slack.react.mock.calls.length;
  await f.service.poll(602000);
  const text = f.slack.post.mock.calls.at(-1)![1];
  expect(text).toContain("1. Seguir padrão");
  expect(text).toContain("Recomendação: opção 1");
  expect(text).toContain("mensagem original");
  expect(f.slack.react.mock.calls.length).toBe(seeds);
});
it.each([
  "http://jira.example.test",
  "https://user:password@jira.example.test",
  "https://jira.example.test?token=private",
])("does not emit an unsafe Jira base URL: %s", (url) => {
  const f = fixture();
  const context = new DecisionContextFactory(url).create(f.run, "Q", 1);
  expect(context.issueUrl).toBeUndefined();
  expect(context.issueKey).toBe("PNOLA-1");
});
