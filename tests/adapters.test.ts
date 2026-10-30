import { describe, it, expect, vi } from "vitest";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";
import { CodexEngine } from "../src/engines/codex/codex-engine.js";
import { JevClient } from "../src/integrations/jev/jev-client.js";
import { eligibilitySchema } from "../src/integrations/jev/types/eligibility-form.js";
import { readFileSync } from "node:fs";
import { SlackClient } from "../src/integrations/slack/slack-client.js";
const result = {
  status: "passed",
  summary: "Observed",
  evidence: ["test observation"],
  question: null,
  options: [],
  data: {},
};
const input = {
  runId: "r",
  stage: "investigation",
  cwd: process.cwd(),
  prompt: "Read only",
  sessionId: null,
  mode: "read" as const,
  browserAuthorized: false,
  onSession: vi.fn(),
};
describe("Native engine contracts", () => {
  it("uses Claude native session resume, structured output and bounded read tools", async () => {
    const runner = {
      run: vi.fn(async (_command, args) => ({
        code: 0,
        stdout: JSON.stringify({
          session_id: args[args.indexOf("--resume") + 1],
          structured_output: result,
        }),
      })),
    };
    const engine = new ClaudeEngine(runner as never);
    const response = await engine.execute({
      ...input,
      sessionId: "d9d749ef-2f26-457c-a16c-729a0c62ba42",
    });
    expect(response.status).toBe("passed");
    const args = runner.run.mock.calls[0]![1];
    expect(args).toContain("--resume");
    expect(args).toContain("Read,Grep,Glob");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
  it("persists Codex thread IDs and loads the selected native browser transport only for authorized browser stages", async () => {
    const onSession = vi.fn();
    const runner = {
      run: vi.fn(async (_command, _args, _cwd, _prompt, line) => {
        line(
          JSON.stringify({ type: "thread.started", thread_id: "thread-id" }),
        );
        line(
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: JSON.stringify(result) },
          }),
        );
        return { code: 0, stdout: "" };
      }),
    };
    const browser = { run: vi.fn(async (_input, execute) => execute()) };
    const nativeConfiguration = vi.fn(() => ({
      args: ["-c", "mcp_servers.cua_repl.enabled=true"],
      environment: { PATH: process.env.PATH },
    }));
    const engine = new CodexEngine(
      runner as never,
      browser,
      nativeConfiguration,
    );
    await engine.execute({ ...input, onSession });
    expect(onSession).toHaveBeenCalledWith("thread-id");
    expect(nativeConfiguration).not.toHaveBeenCalled();
    await expect(
      engine.execute({ ...input, mode: "browser", browserAuthorized: false }),
    ).rejects.toThrow("authorization");
    await engine.execute({
      ...input,
      mode: "browser",
      browserAuthorized: true,
      allowedOrigins: ["https://staging.example.com"],
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(nativeConfiguration).toHaveBeenCalledTimes(1);
    const readArgs = runner.run.mock.calls[0]![1];
    const browserArgs = runner.run.mock.calls[1]![1];
    expect(readArgs).toContain('approval_policy="never"');
    expect(browserArgs).toContain('approval_policy="on-request"');
    expect(browserArgs).toContain("mcp_servers.cua_repl.enabled=true");
    expect(browserArgs).toContain("--ignore-user-config");
    expect(browserArgs).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
  });
  it("records visible Codex activity without recording reasoning events", async () => {
    const activity: string[] = [];
    const runner = {
      run: vi.fn(async (_c, _a, _d, _p, line) => {
        for (const event of [
          { type: "thread.started", thread_id: "fixture-thread" },
          {
            type: "item.completed",
            item: { type: "reasoning", text: "private reasoning fixture" },
          },
          {
            type: "item.started",
            item: { type: "mcp_tool_call", tool: "read_page" },
          },
          {
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "npm test",
              aggregated_output: "Regression test passed",
            },
          },
          {
            type: "item.completed",
            item: { type: "agent_message", text: JSON.stringify(result) },
          },
        ])
          line(JSON.stringify(event));
        return { code: 0, stdout: "" };
      }),
    };
    await new CodexEngine(runner as never).execute({
      ...input,
      onActivity: (line) => activity.push(line),
    });
    expect(activity.join("\n")).toContain("read_page");
    expect(activity.join("\n")).toContain("Regression test passed");
    expect(activity.join("\n")).toContain("Assistant:");
    expect(activity.join("\n")).not.toContain("private reasoning fixture");
  });
  it("does not silently replace a resumed Codex conversation", async () => {
    const runner = {
      run: vi.fn(async (_c, _a, _d, _p, line) => {
        line(
          JSON.stringify({ type: "thread.started", thread_id: "replacement" }),
        );
        return { code: 0, stdout: "" };
      }),
    };
    await expect(
      new CodexEngine(runner as never).execute({
        ...input,
        sessionId: "original",
      }),
    ).rejects.toThrow("mismatch");
  });
  it("requires explicit delegation for Claude browser navigation", async () => {
    const runner = { run: vi.fn() };
    await expect(
      new ClaudeEngine(runner as never).execute({ ...input, mode: "browser" }),
    ).rejects.toThrow("authorization");
    expect(runner.run).not.toHaveBeenCalled();
  });
});
const form = eligibilitySchema.parse({
  nature: {
    trigger: "Click submit",
    expected: "Modal closes",
    observed: "Modal remains",
  },
  component: "web modal",
  environment: "staging",
  repositories: ["arcca-pdv"],
  products: ["web"],
  issueType: "Bug",
  labels: [],
  domains: [],
  root_cause: {
    claim: "State is updated in the wrong order",
    status: "traced_in_code",
  },
  evidence: [
    {
      kind: "report",
      excerpt: "Observed modal remains",
      source: "sanitized report",
    },
  ],
  code: [
    {
      repository: "arcca-pdv",
      path: "modal.ts",
      line: 1,
      excerpt: "setOpen(true);",
    },
  ],
  proposed_fix: {
    summary: "Update state before completion",
    files: ["arcca-pdv/modal.ts"],
    failing_test: "assert modal closes",
  },
  reproduction: { attempted: false, result: "not_attempted" },
  open_decisions: [],
  risks: [],
  requires_outside_code: { needed: false, action: "read", what: "" },
});
const spec = JSON.parse(readFileSync("assets/eligibility-form.json", "utf8"));
function validResponse() {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 10, output_tokens: 2 },
    answers: Object.fromEntries(
      Object.entries(spec.jev.questions).map(([id, q]: [string, any]) => [
        id,
        q.type === "noul"
          ? { type: "noul", noul: 0.95 }
          : {
              type: "choice",
              choice: "eligible",
              confidence: 0.9,
              probabilities: {
                eligible: 0.9,
                eligible_with_decision: 0.05,
                not_eligible: 0.05,
              },
            },
      ]),
    ),
  };
}
describe("JEV decisive classifier", () => {
  it("uses the real systemone contract, both option orders and form cutoff", async () => {
    const transport = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(validResponse()), { status: 200 }),
      );
    const answer = await new JevClient("not-a-real-key", transport).classify(
      form,
      [],
    );
    expect(answer.classification).toBe("A-candidate");
    expect(answer.score).toBe(0.95);
    expect(transport).toHaveBeenCalledTimes(2);
    const first = JSON.parse(transport.mock.calls[0]![1].body),
      second = JSON.parse(transport.mock.calls[1]![1].body);
    expect(transport.mock.calls[0]![0]).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(Object.keys(first.questions.autonomous_track.criteria)).toEqual(
      Object.keys(second.questions.autonomous_track.criteria).reverse(),
    );
    expect(first.model).toBe("jev-1.13.0");
  });
  it("does not approve on unavailable, malformed or partially valid responses", async () => {
    await expect(
      new JevClient(
        "key",
        vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
      ).classify(form, []),
    ).rejects.toThrow("unavailable");
    const bad = validResponse();
    bad.answers.autonomous_track.probabilities.eligible = 1;
    await expect(
      new JevClient(
        "key",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(bad))),
      ).classify(form, []),
    ).rejects.toThrow("probabilities");
  });
  it("applies factual opt-out and secret/name gates independently of high probabilities", async () => {
    const transport = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify(validResponse())),
      );
    const jev = new JevClient("key", transport);
    expect(
      (await jev.classify({ ...form, labels: ["no-auto"] }, [])).classification,
    ).toBe("C");
    await expect(
      jev.classify(
        {
          ...form,
          code: [
            { ...form.code[0]!, excerpt: 'token="supersecretcredential"' },
          ],
        },
        [],
      ),
    ).rejects.toThrow("credential");
    await expect(jev.classify(form, ["modal"])).rejects.toThrow(
      "Identifying name",
    );
  });
});
describe("Slack pagination", () => {
  it("reads every cursor page for history and thread replies", async () => {
    const slack = new SlackClient("local-test-token");
    const history = vi
      .spyOn(slack.web.conversations, "history")
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1", text: "first" }],
        response_metadata: { next_cursor: "page2" },
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "2", text: "second" }],
        response_metadata: { next_cursor: "" },
      });
    expect(await slack.history("C", "0")).toHaveLength(2);
    expect(history.mock.calls[1]![0]).toMatchObject({ cursor: "page2" });
    const replies = vi
      .spyOn(slack.web.conversations, "replies")
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "1", text: "root" }],
        response_metadata: { next_cursor: "page2" },
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: "2", text: "triage" }],
        response_metadata: { next_cursor: "" },
      });
    expect(await slack.replies("C", "1")).toHaveLength(2);
    expect(replies.mock.calls[1]![0]).toMatchObject({ cursor: "page2" });
  });
});
