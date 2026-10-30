import { it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/types/config.js";
import { CodexEngine } from "../src/engines/codex/codex-engine.js";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";
import { NativeQuotaError } from "../src/engines/errors/quota-error.js";
import { StageExecutor } from "../src/runtime/stage-executor.js";
import { Store } from "../src/storage/store.js";
import { Soul } from "../src/profile/soul.js";
import type { Engine } from "../src/engines/abstractions/interface/engine.js";
import type { StageInput } from "../src/engines/types/stage-input.js";

const result = {
  status: "passed" as const,
  summary: "Verified fixture",
  evidence: ["Fixture observation"],
  question: null,
  options: [],
  data: {},
};
const input = {
  runId: "fixture",
  stage: "investigation",
  cwd: process.cwd(),
  prompt: "Read selected evidence",
  sessionId: null,
  mode: "read" as const,
  browserAuthorized: false,
  onSession: vi.fn(),
};
it("passes explicit model/effort to Codex and Claude without modifying their global settings", async () => {
  const codexRunner = {
    run: vi.fn(async (_c, _a, _d, _p, line) => {
      line(
        JSON.stringify({ type: "thread.started", thread_id: "native-codex" }),
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
  await new CodexEngine(codexRunner as never).execute({
    ...input,
    options: { model: "fixture-codex-model", effort: "high" },
  });
  expect(codexRunner.run.mock.calls[0]![1]).toEqual(
    expect.arrayContaining([
      "--model",
      "fixture-codex-model",
      'model_reasoning_effort="high"',
    ]),
  );
  const claudeRunner = {
    run: vi.fn(async (_c, args) => ({
      code: 0,
      stdout: JSON.stringify({
        session_id: args[args.indexOf("--session-id") + 1],
        structured_output: result,
      }),
    })),
  };
  await new ClaudeEngine(claudeRunner as never).execute({
    ...input,
    options: { model: "fixture-claude-model", effort: "medium" },
  });
  expect(claudeRunner.run.mock.calls[0]![1]).toEqual(
    expect.arrayContaining([
      "--model",
      "fixture-claude-model",
      "--effort",
      "medium",
    ]),
  );
});
it("passes model and effort through the Claude native-browser SDK options", async () => {
  const query = vi.fn(({ options }) =>
    (async function* () {
      expect(options.model).toBe("fixture-claude");
      expect(options.effort).toBe("high");
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: options.sessionId,
        structured_output: result,
      };
    })(),
  );
  await new ClaudeEngine(
    undefined,
    { run: async (_i, operation) => operation() },
    query as never,
  ).execute({
    ...input,
    mode: "browser",
    browserAuthorized: true,
    options: { model: "fixture-claude", effort: "high" },
  });
  expect(query).toHaveBeenCalledTimes(1);
});
it("recognizes a structured Codex quota failure after the process exits", async () => {
  const runner = {
    run: vi.fn(async (_c, _a, _d, _p, line) => {
      line(
        JSON.stringify({ type: "thread.started", thread_id: "saved-native" }),
      );
      line(
        JSON.stringify({
          type: "turn.failed",
          error: {
            code: "usage_limit_reached",
            message: "Usage limit reached",
          },
        }),
      );
      return { code: 1, stdout: "" };
    }),
  };
  await expect(
    new CodexEngine(runner as never).execute(input),
  ).rejects.toBeInstanceOf(NativeQuotaError);
});
it("does not switch engines for a recovered transient rate limit followed by success", async () => {
  const runner = {
    run: vi.fn(async (_c, _a, _d, _p, line) => {
      for (const event of [
        { type: "thread.started", thread_id: "saved-native" },
        { type: "error", error: { code: "rate_limit" } },
        {
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(result) },
        },
        { type: "turn.completed" },
      ])
        line(JSON.stringify(event));
      return { code: 0, stdout: "" };
    }),
  };
  expect((await new CodexEngine(runner as never).execute(input)).status).toBe(
    "passed",
  );
});
it("recognizes Claude CLI quota results but does not classify authentication as quota", async () => {
  const runner = {
    run: vi.fn(async () => ({
      code: 1,
      stdout: JSON.stringify({
        is_error: true,
        result: "You've hit your limit · resets later",
      }),
    })),
  };
  await expect(
    new ClaudeEngine(runner as never).execute(input),
  ).rejects.toBeInstanceOf(NativeQuotaError);
  expect(
    NativeQuotaError.matches("authentication_failed", "Permission denied"),
  ).toBe(false);
  expect(
    NativeQuotaError.matches("error_max_budget_usd", "Budget exhausted"),
  ).toBe(false);
});
it("validates engine-specific effort and rejects duplicate fallback order", () => {
  expect(
    configSchema.safeParse({ engines: { claude: { effort: "unsupported" } } })
      .success,
  ).toBe(false);
  expect(
    configSchema.safeParse({ fallback: { order: ["codex", "codex"] } }).success,
  ).toBe(false);
  expect(
    configSchema.parse({
      engines: { codex: { model: "fixture", effort: "ultra" } },
    }).engines.codex.effort,
  ).toBe("ultra");
});

function fixture(enabled = true) {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-engine-handoff-")),
    store = new Store(join(directory, "state.db"));
  const skill = join(directory, "SKILL.md");
  writeFileSync(skill, "Inspect the configured local evidence.");
  const config = configSchema.parse({
    fallback: { enabled },
    engines: {
      codex: { model: "fixture-codex", effort: "medium" },
      claude: { model: "fixture-claude", effort: "high" },
    },
    skillPaths: { fixture: skill },
  });
  const soul = new Soul(store, directory, join(directory, "SOUL.md"));
  const version = soul.propose("# Pinned preferences", [
    { source: "fixture", excerpt: "Use explicit settings" },
  ]);
  soul.publishDraft(version);
  soul.approve(version);
  const run = store.create("support", "handoff-source", "codex", version, {
    soulSnapshot: soul.snapshotForNewRun(),
    retainedEvidence: "collected facts",
    workspaces: { "arcca-pdv": directory },
  });
  run.state = "investigating";
  store.save(run);
  const capabilities = {
    nativeSessions: true,
    read: true,
    edit: true,
    nativeBrowser: true,
    browserRequirement: "fixture",
  };
  const engines = new Map<string, Engine>();
  const add = (
    id: "codex" | "claude",
    operation: (input: StageInput) => Promise<typeof result>,
  ) => engines.set(id, { id, capabilities, execute: vi.fn(operation) });
  const executor = new StageExecutor(store, engines, soul, config);
  return {
    store,
    directory,
    config,
    run,
    engines,
    executor,
    add,
    close: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it("automatically hands off quota-limited work with workflow evidence, pinned settings and separate native sessions", async () => {
  const f = fixture();
  try {
    f.add("codex", async (input) => {
      input.onSession("codex-session");
      throw new NativeQuotaError();
    });
    f.add("claude", async (input) => {
      expect(input.sessionId).toBeNull();
      expect(input.options).toEqual({
        model: "fixture-claude",
        effort: "high",
      });
      expect(input.prompt).toContain("collected facts");
      expect(input.prompt).toContain("Pinned preferences");
      input.onSession("claude-session");
      return result;
    });
    expect(
      (
        await f.executor.execute(
          f.run,
          "Read",
          "fixture",
          "read",
          f.directory,
          new AbortController().signal,
        )
      ).status,
    ).toBe("passed");
    const saved = f.store.get(f.run.id);
    expect(saved.engine).toBe("claude");
    const recovered = new Store(join(f.directory, "state.db"));
    try {
      expect(recovered.get(f.run.id).engine).toBe("claude");
      expect(recovered.get(f.run.id).data.engineSessions).toMatchObject({
        codex: { id: "codex-session" },
        claude: { id: "claude-session" },
      });
    } finally {
      recovered.close();
    }
    expect(saved.sessionId).toBe("claude-session");
    expect(saved.data.engineSessions).toMatchObject({
      codex: { id: "codex-session" },
      claude: { id: "claude-session" },
    });
    expect(saved.data.engineHandoffs).toHaveLength(1);
    expect(saved.state).toBe("investigating");
    expect(saved.data.retainedEvidence).toBe("collected facts");
  } finally {
    f.close();
  }
});
it("keeps a running task's model pinned when the global settings change", async () => {
  const f = fixture();
  try {
    const received: unknown[] = [];
    f.add("codex", async (input) => {
      received.push(input.options);
      input.onSession(input.sessionId ?? "saved-session");
      return result;
    });
    await f.executor.execute(
      f.run,
      "Read",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
    );
    f.config.engines.codex.model = "different-model";
    await f.executor.execute(
      f.store.get(f.run.id),
      "Read again",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
    );
    expect(received).toEqual([
      { model: "fixture-codex", effort: "medium" },
      { model: "fixture-codex", effort: "medium" },
    ]);
  } finally {
    f.close();
  }
});
it("stops after both engines exhaust their quota without a fallback loop", async () => {
  const f = fixture();
  try {
    for (const id of ["codex", "claude"] as const)
      f.add(id, async (input) => {
        input.onSession(`${id}-session`);
        throw new NativeQuotaError();
      });
    await expect(
      f.executor.execute(
        f.run,
        "Read",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(NativeQuotaError);
    expect(f.engines.get("codex")!.execute).toHaveBeenCalledTimes(1);
    expect(f.engines.get("claude")!.execute).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});
it.each(["Permission denied", "Authentication failed", "Budget cap reached"])(
  "does not automatically switch for unrelated failure: %s",
  async (message) => {
    const f = fixture();
    try {
      f.add("codex", async () => {
        throw new Error(message);
      });
      f.add("claude", async () => result);
      await expect(
        f.executor.execute(
          f.run,
          "Read",
          "fixture",
          "read",
          f.directory,
          new AbortController().signal,
        ),
      ).rejects.toThrow(message);
      expect(f.engines.get("claude")!.execute).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
it("can disable fallback without discarding the saved native session", async () => {
  const f = fixture(false);
  try {
    f.add("codex", async (input) => {
      input.onSession("quota-session");
      throw new NativeQuotaError();
    });
    f.add("claude", async () => result);
    await expect(
      f.executor.execute(
        f.run,
        "Read",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(NativeQuotaError);
    expect(f.store.get(f.run.id).sessionId).toBe("quota-session");
    expect(f.engines.get("claude")!.execute).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it("keeps the implementation session when quota interrupts a fresh independent review", async () => {
  const f = fixture();
  try {
    f.run.sessionId = "legacy-implementation";
    f.run.state = "review";
    f.store.save(f.run);
    f.add("codex", async (input) => {
      expect(input.sessionId).toBeNull();
      input.onSession("partial-review");
      throw new NativeQuotaError();
    });
    f.add("claude", async (input) => {
      expect(input.sessionId).toBeNull();
      input.onSession("completed-review");
      return result;
    });
    await f.executor.execute(
      f.run,
      "Independent review",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
      true,
    );
    expect(f.store.get(f.run.id).data.engineSessions).toMatchObject({
      codex: { id: "legacy-implementation" },
    });
    expect(f.store.get(f.run.id).data.reviewSession).toBe("completed-review");
  } finally {
    f.close();
  }
});

it("resumes the saved operational review separately and supplies the exact implementation and artifacts", async () => {
  const f = fixture();
  try {
    f.run.kind = "operational";
    f.run.state = "review";
    f.run.sessionId = "implementation-session";
    f.run.data.reviewSession = "operational-review-session";
    f.run.data.operationalImplementation = {
      summary: "review these scripts",
      files: [{ path: "execute.sh", content: "reviewed contents" }],
    };
    f.run.data.operationalArtifacts = { directory: f.directory };
    f.store.save(f.run);
    f.add("codex", async (input) => {
      expect(input.sessionId).toBe("operational-review-session");
      expect(input.readDirectories).toContain(f.directory);
      expect(input.prompt).toContain("reviewed contents");
      input.onSession("operational-review-session");
      return result;
    });
    await f.executor.execute(
      f.run,
      "Independent review",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
      true,
    );
    expect(f.store.get(f.run.id).sessionId).toBe("implementation-session");
    f.run.data.inFlight = true;
    delete f.run.data.reviewSession;
    f.store.save(f.run);
    await expect(
      f.executor.execute(
        f.run,
        "Review",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow("no confirmed session");
  } finally {
    f.close();
  }
});

it("does not switch while the previous native process is still running", async () => {
  const f = fixture();
  try {
    f.add("codex", async (input) => {
      input.onProcess?.(process.pid);
      input.onSession("still-running");
      throw new NativeQuotaError();
    });
    f.add("claude", async () => result);
    await expect(
      f.executor.execute(
        f.run,
        "Read",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      ),
    ).rejects.toThrow("still alive");
    expect(f.engines.get("claude")!.execute).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it("recognizes quota through the Claude browser SDK without overriding permissions", async () => {
  const query = vi.fn(({ options }) =>
    (async function* () {
      yield {
        type: "assistant",
        error: "rate_limit",
        message: { content: [] },
      };
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: options.sessionId,
        errors: ["API Error: 429 rate_limit_error"],
      };
    })(),
  );
  await expect(
    new ClaudeEngine(
      undefined,
      { run: async (_input, operation) => operation() },
      query as never,
    ).execute({ ...input, mode: "browser", browserAuthorized: true }),
  ).rejects.toBeInstanceOf(NativeQuotaError);
});

it("carries family descriptions, current member and pinned workspaces into resumed and fresh feature sessions", async () => {
  const f = fixture(false);
  try {
    const member = {
      key: "SNOLA-CHILD",
      fields: {
        description: "COMPLETE_CHILD_ACCEPTANCE",
        issuetype: { name: "Story" },
        summary: "Child",
        status: { name: "To Do" },
      },
    };
    f.run.kind = "feature";
    f.run.data.family = {
      root: "PNOLA-EPIC",
      digest: "fixture",
      complete: true,
      members: [member],
      ancestors: [],
    };
    f.run.data.featureMember = member;
    f.run.data.analysisWorkspaces = { "arccanet-frontend": "/pinned/frontend" };
    f.run.data.analysisRevisions = { "arccanet-frontend": "pinned-commit" };
    f.store.save(f.run);
    f.add("codex", async (input) => {
      const data = JSON.parse(
        input.prompt.split("Task evidence (JSON):\n")[1]!,
      );
      expect(data.family.members[0].fields.description).toBe(
        "COMPLETE_CHILD_ACCEPTANCE",
      );
      expect(data.featureMember.key).toBe("SNOLA-CHILD");
      expect(data.analysisWorkspaces["arccanet-frontend"]).toBe(
        "/pinned/frontend",
      );
      expect(data.analysisRevisions["arccanet-frontend"]).toBe("pinned-commit");
      input.onSession("session");
      return result;
    });
    await f.executor.execute(
      f.run,
      "Analyze",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
    );
    await f.executor.execute(
      f.run,
      "Review",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
      true,
    );
  } finally {
    f.close();
  }
});

it("keeps the current full member while deferring oversized sibling descriptions", async () => {
  const f = fixture(false);
  try {
    const members = Array.from({ length: 4 }, (_, i) => ({
      key: `STORY-${i}`,
      fields: {
        description: "x".repeat(30000),
        issuetype: { name: "Story" },
        summary: "Child",
        status: { name: "To Do" },
      },
    }));
    f.run.kind = "feature";
    f.run.data.family = {
      root: "EPIC",
      digest: "large",
      complete: true,
      members,
      ancestors: [],
    };
    f.run.data.featureMember = members[0];
    f.add("codex", async (input) => {
      const data = JSON.parse(
        input.prompt.split("Task evidence (JSON):\n")[1]!,
      );
      expect(data.family.descriptionsDeferred).toBe(true);
      expect(data.family.members).toHaveLength(4);
      expect(data.family.members[0].fields).toBeUndefined();
      expect(data.featureMember.fields.description).toHaveLength(30000);
      return result;
    });
    await f.executor.execute(
      f.run,
      "Analyze",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
    );
  } finally {
    f.close();
  }
});
