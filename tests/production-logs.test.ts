import { it, expect, vi } from "vitest";
import { ReadOnlyLogs } from "../src/observability/read-only-logs.js";
import { CodexEngine } from "../src/engines/codex/codex-engine.js";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";
import { ThreadEvidence } from "../src/support/thread-evidence.js";
const connection = { profile: "fixture", region: "us-east-1" };
const query = {
  operation: "filter_events" as const,
  group: "/aws/lambda/fixture-prod-handler",
  start: 1000,
  end: 2000,
  pattern: '"No counter"',
};
it("uses only a bounded CloudWatch read operation, keeps credentials out of arguments, redacts secrets and preserves pagination", async () => {
  const runner = {
    run: vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        events: [
          {
            timestamp: 1234,
            logStreamName: "stream",
            message: "Authorization: Bearer fixture-authorization-secret",
          },
        ],
        nextToken: "continue",
      }),
    })),
  };
  const output = (await new ReadOnlyLogs(connection, runner as never).query(
    query,
  )) as any;
  const [command, args] = runner.run.mock.calls[0]!;
  expect(command).toBe("aws");
  expect(args.slice(0, 2)).toEqual(["logs", "filter-log-events"]);
  expect(args).toContain("--no-paginate");
  expect(args).toContain("--profile=fixture");
  expect(args).not.toContain("--unmask");
  expect(JSON.stringify(output)).not.toContain("fixture-authorization-secret");
  expect(output.nextToken).toBe("continue");
  expect(output.complete).toBe(false);
});
it.each([
  { ...query, operation: "delete_log_group" },
  { ...query, group: "--endpoint-url=evil" },
  { ...query, end: 1000 },
  { ...query, end: 1000 + 86400001 },
  { ...query, endpoint: "https://untrusted.example" },
])(
  "refuses writes, unexpected options and unbounded windows before invoking AWS",
  async (input) => {
    const runner = { run: vi.fn() };
    await expect(
      new ReadOnlyLogs(connection, runner as never).query(input as never),
    ).rejects.toThrow();
    expect(runner.run).not.toHaveBeenCalled();
  },
);
it("keeps option-like filter/token text as argument values, reports empty partial pages and enforces the stage budget", async () => {
  const runner = {
    run: vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ events: [], nextToken: "more" }),
    })),
  };
  const logs = new ReadOnlyLogs(connection, runner as never);
  const output = (await logs.query({
    ...query,
    pattern: "--endpoint-url=https://example.invalid",
    nextToken: "--profile=other",
  })) as any;
  expect(runner.run.mock.calls[0]![1]).toContain(
    "--filter-pattern=--endpoint-url=https://example.invalid",
  );
  expect(runner.run.mock.calls[0]![1]).toContain(
    "--next-token=--profile=other",
  );
  expect(output.complete).toBe(false);
  for (let n = 1; n < 20; n++) await logs.query(query);
  await expect(logs.query(query)).rejects.toThrow("budget");
  expect(runner.run).toHaveBeenCalledTimes(20);
});
it("does not treat denied access or malformed responses as absence of production errors", async () => {
  const runner = {
    run: vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "{}" }),
  };
  const logs = new ReadOnlyLogs(connection, runner as never);
  await expect(logs.query(query)).rejects.toThrow("permissions");
  await expect(logs.query(query)).rejects.toThrow();
});
const result = {
  status: "passed",
  summary: "Read-only fixture",
  evidence: ["Fixture"],
  question: null,
  options: [],
  data: {},
};
const input = {
  runId: "fixture",
  stage: "investigating",
  cwd: process.cwd(),
  prompt: "Read only",
  sessionId: null,
  mode: "read" as const,
  browserAuthorized: false,
  onSession: () => {},
  productionLogs: connection,
};
it("exposes the controlled read-only MCP server to Codex without opening shell networking or edit stages", async () => {
  const runner = {
    run: vi.fn(async (_c, _a, _d, _p, line) => {
      line(JSON.stringify({ type: "thread.started", thread_id: "fixture" }));
      line(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(result) },
        }),
      );
      return { code: 0, stdout: "" };
    }),
  };
  const engine = new CodexEngine(runner as never);
  await engine.execute(input);
  const read = runner.run.mock.calls[0]![1];
  expect(read).toContain("sandbox_workspace_write.network_access=false");
  expect(read.join(" ")).toContain("mcp_servers.scabbers_logs.command");
  await engine.execute({ ...input, mode: "edit" });
  expect(runner.run.mock.calls[1]![1].join(" ")).not.toContain(
    "mcp_servers.scabbers_logs",
  );
});
it("exposes only the log tool in Claude read mode and preserves strict MCP isolation in edit mode", async () => {
  const runner = {
    run: vi.fn(async (_c, args) => ({
      code: 0,
      stdout: JSON.stringify({
        session_id: args[args.indexOf("--session-id") + 1],
        structured_output: result,
      }),
    })),
  };
  const engine = new ClaudeEngine(runner as never);
  await engine.execute(input);
  const args = runner.run.mock.calls[0]![1];
  expect(args).toContain("Read,Grep,Glob,mcp__scabbers_logs__query_logs");
  expect(
    JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers.scabbers_logs
      .command,
  ).toBe(process.execPath);
  await engine.execute({ ...input, mode: "edit" });
  const edit = runner.run.mock.calls[1]![1];
  expect(JSON.parse(edit[edit.indexOf("--mcp-config") + 1]).mcpServers).toEqual(
    {},
  );
});
it("collects only explicit source links once, preserves timestamps, and never recursively crawls Slack", async () => {
  const messages = [
    {
      ts: "1793380042.421949",
      text: "https://grupo-arcca.slack.com/archives/CORIGIN/p1793378960105719 https://grupo-arcca.slack.com/archives/CORIGIN/p1793378960105719 https://evil.example/archives/CBAD/p1793378960105719",
    },
  ];
  const slack = {
    replies: vi.fn(async () => [
      {
        ts: "1793378960.105719",
        text: "Later evidence; https://grupo-arcca.slack.com/archives/COTHER/p1793378960105719",
      },
    ]),
  };
  const evidence = await new ThreadEvidence(slack as never).collect(
    messages,
    "CREPORT",
    "1793380042.421949",
  );
  expect(slack.replies).toHaveBeenCalledExactlyOnceWith(
    "CORIGIN",
    "1793378960.105719",
  );
  expect(evidence[0]!.capturedAt).toBeTypeOf("number");
  expect(evidence[0]!.messages[0]!.ts).toBe("1793378960.105719");
});
it("reports inaccessible source threads instead of pretending the evidence is absent or stopping all analysis", async () => {
  const slack = {
    replies: vi.fn().mockRejectedValue(new Error("not_in_channel")),
  };
  const evidence = await new ThreadEvidence(slack as never).collect(
    [
      {
        ts: "1",
        text: "https://grupo-arcca.slack.com/archives/CORIGIN/p1793378960105719",
      },
    ],
    "CREPORT",
    "1",
  );
  expect(evidence[0]!.unavailable).toContain("configured Slack identity");
  expect(evidence[0]!.messages).toEqual([]);
});
it("fails explicitly when a log page exceeds the evidence budget instead of silently losing events", async () => {
  const runner = {
    run: vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        events: Array.from({ length: 20 }, () => ({
          timestamp: 1,
          logStreamName: "stream",
          message: "x".repeat(2000),
        })),
      }),
    })),
  };
  await expect(
    new ReadOnlyLogs(connection, runner as never).query(query),
  ).rejects.toThrow("narrow");
});
it("applies the production-read policy at the controller boundary only when the owner enabled it", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { StageExecutor } = await import("../src/runtime/stage-executor.js");
  const { Store } = await import("../src/storage/store.js");
  const { configSchema } = await import("../src/config/types/config.js");
  const folder = mkdtempSync(join(tmpdir(), "scabbers-read-policy-"));
  const skill = join(folder, "SKILL.md");
  writeFileSync(skill, "Fixture read-only guidance");
  const store = new Store(":memory:");
  try {
    for (const enabled of [false, true]) {
      const run = store.create(
        "support",
        "read-policy-" + enabled,
        "codex",
        "profile",
        {
          soulSnapshot: {
            version: "profile",
            content: "Fixture",
            source: "fixture",
          },
        },
      );
      const execute = vi.fn(async () => result);
      const config = configSchema.parse({
        aws: { readOnlyLogs: enabled, profile: "fixture", region: "us-east-1" },
        skillPaths: { fixture: skill },
      });
      await new StageExecutor(
        store,
        new Map([
          [
            "codex",
            { execute, capabilities: { nativeBrowser: true } } as never,
          ],
        ]),
        {} as never,
        config,
      ).execute(
        run,
        "Read evidence",
        "fixture",
        "read",
        folder,
        new AbortController().signal,
      );
      const sent = execute.mock.calls[0]![0] as any;
      if (enabled) {
        expect(sent.productionLogs).toEqual(connection);
        expect(sent.prompt).toContain("replaces earlier blanket prohibitions");
        expect(sent.prompt).toContain("Do not publish, modify production");
      } else {
        expect(sent.productionLogs).toBeUndefined();
        expect(sent.prompt).toContain("Production log access is unavailable");
      }
    }
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
