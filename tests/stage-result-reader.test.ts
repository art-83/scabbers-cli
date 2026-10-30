import { expect, it, vi } from "vitest";
import { StageResultReader } from "../src/engines/stage-result-reader.js";
import { CodexEngine } from "../src/engines/codex/codex-engine.js";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";
const decision = {
  choices: [
    { label: "Keep at the end", consequence: "Preserve the selected records" },
    { label: "Collect evidence", consequence: "Pause for verified examples" },
  ],
  recommendedIndex: 0,
  reason: "Preserve valid ordering without inventing dates",
};
const raw = {
  status: "question",
  summary: "Observed technical analysis",
  evidence: ["Read actual code"],
  question: {
    text: "How should missing dates be displayed?",
    decisionContext: "Verified ordering context",
    decision,
  },
  options: [],
  data: { key: "SNOLA-12622", approach: "Preserved technical approach" },
};
it("normalizes the observed nested question while preserving choices, recommendation, context, evidence and member analysis", () => {
  const parsed = new StageResultReader().parse(raw);
  expect(parsed).toEqual({
    ...raw,
    question: raw.question.text,
    decision,
    decisionContext: { summary: raw.question.decisionContext },
  });
  expect(raw.question).toBeTypeOf("object");
});
it("accepts structured decision details and leaves canonical responses unchanged", () => {
  const context = {
    summary: "Context",
    problem: "Problem",
    whyHuman: "Product decision",
  };
  const parsed = new StageResultReader().parse({
    ...raw,
    question: { ...raw.question, decisionContext: context },
  });
  expect(parsed.decisionContext).toEqual(context);
  expect(new StageResultReader().parse(parsed)).toEqual(parsed);
  expect(
    new StageResultReader().parse({ ...raw, status: "passed", question: null }),
  ).toEqual({ ...raw, status: "passed", question: null });
});
it.each([
  { ...raw, question: { ...raw.question, text: { nested: "bad" } } },
  {
    ...raw,
    question: {
      ...raw.question,
      decision: { ...decision, recommendedIndex: 5 },
    },
  },
  { ...raw, question: { ...raw.question, unexpectedApproval: true } },
  { ...raw, decision: { ...decision, recommendedIndex: 1 } },
  { ...raw, decisionContext: { summary: "Conflicting context" } },
])(
  "continues rejecting invalid or conflicting content without fabricating a human answer",
  (candidate) => {
    expect(() => new StageResultReader().parse(candidate)).toThrow();
  },
);
const input = {
  runId: "fixture",
  stage: "investigating",
  prompt: "Read only",
  cwd: process.cwd(),
  sessionId: null,
  mode: "read" as const,
  browserAuthorized: false,
  onSession: vi.fn(),
};
it("handles the actual provider shape before Codex member analysis and requests the complete canonical schema", async () => {
  const runner = {
    run: vi.fn(async (_c, _args, _cwd, _prompt, line) => {
      line(
        JSON.stringify({ type: "thread.started", thread_id: "saved-thread" }),
      );
      line(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(raw) },
        }),
      );
      return { code: 0, stdout: "" };
    }),
  };
  const parsed = await new CodexEngine(runner as never).execute(input);
  expect(parsed.question).toBe(raw.question.text);
  expect(parsed.decision).toEqual(decision);
  expect(parsed.data).toEqual(raw.data);
  const prompt = runner.run.mock.calls[0]![3];
  expect(prompt).toContain('"decisionContext"');
  expect(prompt).toContain('"required"');
  expect(prompt).toContain("question must be a plain string or null");
});
it("normalizes the same shape through the Claude CLI boundary", async () => {
  const runner = {
    run: vi.fn(async (_c, args) => ({
      code: 0,
      stdout: JSON.stringify({
        session_id: args[args.indexOf("--session-id") + 1],
        structured_output: raw,
      }),
    })),
  };
  expect(
    (await new ClaudeEngine(runner as never).execute(input)).decision,
  ).toEqual(decision);
});
it("normalizes the same shape through the Claude browser SDK boundary", async () => {
  const query = vi.fn(({ options }) =>
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: options.sessionId,
        structured_output: raw,
      };
    })(),
  );
  const engine = new ClaudeEngine(
    undefined,
    { run: async (_input, execute) => execute() },
    query as never,
  );
  expect(
    (
      await engine.execute({
        ...input,
        mode: "browser",
        browserAuthorized: true,
      })
    ).question,
  ).toBe(raw.question.text);
});
