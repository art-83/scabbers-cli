import { it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Soul } from "../src/profile/soul.js";
import { StageExecutor } from "../src/runtime/stage-executor.js";
import { configSchema } from "../src/config/types/config.js";
import type { Engine } from "../src/engines/abstractions/interface/engine.js";
it("loads the external SOUL for a new execution once, keeps edits out of existing sessions and restores its pinned content after recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-soul-source-"));
  const path = join(directory, "SOUL.md");
  const db = join(directory, "state.db");
  const skill = join(directory, "SKILL.md");
  writeFileSync(skill, "Read the selected local evidence.");
  const store = new Store(db);
  const config = configSchema.parse({ skillPaths: { fixture: skill } });
  const soul = new Soul(store, directory, path);
  const version = soul.propose("# PROFILE_ALPHA\nPrefer explicit JSON.", [
    { source: "human", excerpt: "Use editable JSON" },
  ]);
  soul.publishDraft(version);
  expect(() => soul.snapshotForNewRun()).toThrow("unreviewed");
  soul.approve(version);
  const captured = soul.snapshotForNewRun();
  expect(captured.content).toContain("PROFILE_ALPHA");
  const run = store.create(
    "support",
    "source-fixture",
    "codex",
    captured.version,
    { soulSnapshot: captured },
  );
  let session = 0;
  const prompts: string[] = [];
  const engine: Engine = {
    id: "codex",
    capabilities: {
      nativeSessions: true,
      read: true,
      edit: true,
      nativeBrowser: false,
      browserRequirement: "Unavailable",
    },
    execute: vi.fn(async (input) => {
      prompts.push(input.prompt);
      input.onSession(input.sessionId ?? `native-${++session}`);
      return {
        status: "passed",
        summary: "Fixture observation",
        evidence: ["fixture"],
        question: null,
        options: [],
        data: {},
      };
    }),
  };
  try {
    const executor = new StageExecutor(
      store,
      new Map([["codex", engine]]),
      soul,
      config,
    );
    await executor.execute(
      run,
      "Observe",
      "fixture",
      "read",
      directory,
      new AbortController().signal,
    );
    expect(prompts[0]).toContain("PROFILE_ALPHA");
    writeFileSync(path, "# PROFILE_BETA\nPrefer explicit alternatives.");
    await executor.execute(
      store.get(run.id),
      "Next step",
      "fixture",
      "read",
      directory,
      new AbortController().signal,
    );
    expect(prompts[1]).not.toContain("PROFILE_ALPHA");
    expect(prompts[1]).not.toContain("PROFILE_BETA");
    expect(prompts[1]).toContain("already loaded");
    expect(() => soul.snapshotForNewRun()).toThrow("unreviewed");
    const next = soul.prepareSource()!;
    soul.approve(next);
    expect(soul.snapshotForNewRun().content).toContain("PROFILE_BETA");
    unlinkSync(path);
    const recoveredStore = new Store(db);
    try {
      const resumed = new StageExecutor(
        recoveredStore,
        new Map([["codex", engine]]),
        new Soul(recoveredStore, directory, path),
        config,
      );
      await resumed.execute(
        recoveredStore.get(run.id),
        "Resume",
        "fixture",
        "read",
        directory,
        new AbortController().signal,
      );
      expect(prompts[2]).not.toContain("PROFILE_BETA");
      await resumed.execute(
        recoveredStore.get(run.id),
        "Independent review",
        "fixture",
        "read",
        directory,
        new AbortController().signal,
        true,
      );
      expect(prompts[3]).toContain("PROFILE_ALPHA");
      expect(prompts[3]).not.toContain("PROFILE_BETA");
    } finally {
      recoveredStore.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
