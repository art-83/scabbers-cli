import { it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Configuration } from "../src/config/configuration.js";
it("uses an editable validated settings.json as the source of truth instead of SQLite configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-settings-"));
  const store = new Store(":memory:");
  const path = join(directory, "settings.json");
  const settings = new Configuration(store, path);
  try {
    settings.save({
      engine: "codex",
      schedule: {
        zone: "America/Sao_Paulo",
        days: [7],
        start: "09:00",
        end: "18:00",
      },
    });
    expect(JSON.parse(readFileSync(path, "utf8")).schedule).toEqual({
      zone: "America/Sao_Paulo",
      shifts: [{ day: "Sunday", start: "09:00", end: "18:00" }],
    });
    expect(store.getSetting("config")).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).engine).toBe("codex");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    writeFileSync(path, JSON.stringify({ workers: 5 }));
    expect(settings.get().workers).toBe(5);
    writeFileSync(path, '{"workers":');
    expect(() => settings.get()).toThrow("Cannot parse");
    writeFileSync(path, JSON.stringify({ slack: { inventedField: true } }));
    expect(() => settings.get()).toThrow("slack");
    expect(() =>
      settings.save({
        schedule: {
          zone: "Unknown/Zone",
          days: [1],
          start: "09:00",
          end: "18:00",
        },
      }),
    ).toThrow("timezone");
    expect(() =>
      settings.save({
        schedule: {
          zone: "America/Sao_Paulo",
          days: [1],
          start: "09:00",
          end: "09:00",
        },
      }),
    ).toThrow("must differ");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("copies earlier CLI settings once and never resurrects SQLite preferences after the file becomes authoritative", () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-settings-migration-"));
  const store = new Store(":memory:");
  const path = join(directory, "settings.json");
  const settings = new Configuration(store, path);
  try {
    store.setSetting("config", { workers: 7 });
    expect(settings.get().workers).toBe(7);
    expect(store.getSetting("config")).toEqual({ workers: 7 });
    writeFileSync(path, '{"workers":2}');
    expect(settings.get().workers).toBe(2);
    unlinkSync(path);
    expect(settings.get().workers).toBe(3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("preserves an existing demand private owner when global settings switch to another Slack account", async () => {
  const { DecisionService } =
    await import("../src/decisions/decision-service.js");
  const store = new Store(":memory:");
  const run = store.create(
    "support",
    "C:owner-fixture",
    "codex",
    "profile",
    {},
  );
  const opened: string[] = [];
  const messaging = {
    openPrivate: async (user: string) => {
      opened.push(user);
      return "DPRIVATE";
    },
    find: async () => undefined,
    post: async () => "100",
  };
  try {
    const first = new DecisionService(store, messaging as never, "UORIGINAL");
    const decision = await first.ask(run.id, "First decision", ["A"], 1000);
    expect(
      first.accept({
        id: decision.id,
        user: "UORIGINAL",
        channel: "DPRIVATE",
        thread: "100",
        receipt: "r1",
        version: 1,
        answer: "A",
        at: 2000,
      }),
    ).toBe(true);
    const reconfigured = new DecisionService(
      store,
      messaging as never,
      "UNEWOWNER",
    );
    const second = await reconfigured.ask(
      run.id,
      "Second decision",
      ["B"],
      3000,
    );
    expect(second.userId).toBe("UORIGINAL");
    expect(opened).toEqual(["UORIGINAL", "UORIGINAL"]);
  } finally {
    store.close();
  }
});
