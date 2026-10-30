import { it, expect, vi } from "vitest";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";

it("automatically approves native Chrome tools only in browser stages without granting other tools or persistent permissions", async () => {
  const result = {
    status: "passed",
    summary: "Read login page",
    evidence: ["Login heading"],
    question: null,
    options: [],
    data: {},
  };
  const nativeQuery = vi.fn(({ options }) =>
    (async function* () {
      expect(options.permissionMode).toBe("default");
      expect(options.permissionPrompts).toBe("host");
      expect(options.allowedTools).toBeUndefined();
      expect(options.extraArgs).toEqual({ chrome: null });
      const context = { signal: new AbortController().signal };
      expect(
        await options.canUseTool("Bash", { command: "bad" }, context),
      ).toMatchObject({ behavior: "deny" });
      const decision = await options.canUseTool(
        "mcp__claude-in-chrome__read_page",
        { tabId: 1 },
        context,
      );
      expect(decision).toEqual({
        behavior: "allow",
        updatedInput: { tabId: 1 },
      });
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: options.sessionId,
        structured_output: result,
      };
    })(),
  );
  const engine = new ClaudeEngine(
    undefined,
    { run: async (_input, operation) => operation() },
    nativeQuery as never,
  );
  expect(
    await engine.execute({
      runId: "test",
      stage: "browser",
      prompt: "Read",
      cwd: process.cwd(),
      sessionId: null,
      mode: "browser",
      browserAuthorized: true,
      onSession: vi.fn(),
    }),
  ).toEqual(result);
});
