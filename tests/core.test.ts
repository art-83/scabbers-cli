import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Workflow } from "../src/workflows/workflow.js";
import { Schedule } from "../src/support/schedule.js";
import { ScopePolicy } from "../src/development/scope-policy.js";
import { hasTriage } from "../src/support/triage-detector.js";
import { Effects } from "../src/runtime/effects.js";
import { Intake } from "../src/support/intake.js";
import { configSchema } from "../src/config/types/config.js";
import { DecisionService } from "../src/decisions/decision-service.js";
import { WorkerPool } from "../src/runtime/worker-pool.js";
import { Soul } from "../src/profile/soul.js";
const stores: Store[] = [];
const directories: string[] = [];
const db = () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-test-"));
  directories.push(directory);
  const store = new Store(join(directory, "state.db"));
  stores.push(store);
  return { store, directory };
};
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  directories
    .splice(0)
    .forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const schedule = configSchema.parse({
  schedule: {
    zone: "America/Sao_Paulo",
    shifts: [{ day: "Friday", start: "14:00", end: "20:00" }],
  },
}).schedule!;
const stamp = (s: string) => new Date(s).getTime();
describe("Durable workflows", () => {
  it("restores a saved XState snapshot and native session without replaying earlier transitions", () => {
    const { store, directory } = db();
    let run = store.create("development", "NOLA-1", "claude", "p", {});
    const machine = new Workflow(store);
    machine.transition(run, "START");
    run.sessionId = "native-session";
    store.save(run);
    machine.transition(run, "FORM");
    const second = new Store(join(directory, "state.db"));
    stores.push(second);
    run = second.get(run.id);
    expect(run.state).toBe("eligibility");
    expect(run.sessionId).toBe("native-session");
    expect(() => new Workflow(second).transition(run, "GREEN")).toThrow();
    new Workflow(second).transition(run, "REJECT");
    expect(second.get(run.id).state).toBe("handoff");
  });
  it("does not allow fixing without eligibility and failing regression", () => {
    const { store } = db();
    const run = store.create("development", "NOLA-2", "claude", "p", {});
    expect(() => new Workflow(store).transition(run, "FAILING")).toThrow();
  });
  it("deduplicates sources across connections", () => {
    const { store, directory } = db();
    const second = new Store(join(directory, "state.db"));
    stores.push(second);
    const a = store.create("support", "C:1", "claude", "p", {});
    const b = second.create("support", "C:1", "codex", "q", {});
    expect(a.id).toBe(b.id);
    expect(b.engine).toBe("claude");
  });
  it("holds resource locks atomically across connections", () => {
    const { store, directory } = db();
    const second = new Store(join(directory, "state.db"));
    stores.push(second);
    expect(store.acquire("worktree", "one")).toBe(true);
    expect(second.acquire("worktree", "two")).toBe(false);
    store.release("one");
    expect(second.acquire("worktree", "two")).toBe(true);
  });
  it("pins old SOUL revisions after another version is approved", () => {
    const { store, directory } = db();
    const soul = new Soul(store, directory);
    const first = soul.propose("First preference", [
      { source: "human", excerpt: "First evidence" },
    ]);
    soul.approve(first);
    const run = store.create("support", "C:3", "claude", first, {});
    const next = soul.propose("Next preference", [
      { source: "human", excerpt: "Correction" },
    ]);
    soul.approve(next);
    expect(soul.read(store.get(run.id).profileVersion)).toBe(
      "First preference",
    );
  });
});
describe("Schedule and report backfill", () => {
  it("uses each named day's own intervals, supports split shifts and rejects invalid day names", () => {
    const config = configSchema.parse({
      schedule: {
        zone: "America/Sao_Paulo",
        shifts: [
          { day: "Monday", start: "08:00", end: "12:00" },
          { day: "Friday", start: "14:00", end: "20:00" },
          { day: "Monday", start: "15:00", end: "17:00" },
        ],
      },
    });
    const s = new Schedule(config.schedule!);
    expect(s.contains(stamp("2026-11-02T08:00:00-03:00"))).toBe(true);
    expect(s.contains(stamp("2026-11-02T12:00:00-03:00"))).toBe(false);
    expect(s.contains(stamp("2026-11-02T14:30:00-03:00"))).toBe(false);
    expect(s.contains(stamp("2026-11-02T15:00:00-03:00"))).toBe(true);
    expect(s.contains(stamp("2026-10-30T08:00:00-03:00"))).toBe(false);
    expect(s.contains(stamp("2026-10-30T14:00:00-03:00"))).toBe(true);
    expect(s.contains(stamp("2026-10-30T20:00:00-03:00"))).toBe(false);
    for (const day of ["monday", "Fryday", 5])
      expect(
        configSchema.safeParse({
          schedule: {
            zone: "America/Sao_Paulo",
            shifts: [{ day, start: "08:00", end: "12:00" }],
          },
        }).success,
      ).toBe(false);
  });
  it("evaluates received time in the configured timezone with exclusive end", () => {
    const s = new Schedule(schedule);
    expect(s.contains(stamp("2026-10-30T17:00:00Z"))).toBe(true);
    expect(s.contains(stamp("2026-10-30T23:00:00Z"))).toBe(false);
    expect(s.contains(stamp("2026-10-30T16:59:59Z"))).toBe(false);
  });
  it("handles overnight windows and daylight-saving timezone transitions", () => {
    const s = new Schedule({
      zone: "America/New_York",
      shifts: [{ day: "Saturday", start: "22:00", end: "03:00" }],
    });
    expect(s.contains(stamp("2026-11-01T06:30:00Z"))).toBe(true);
    expect(s.contains(stamp("2026-11-01T08:00:00Z"))).toBe(false);
  });
  it("backfills all missed eligible reports outside the present shift, ignores bots and preserves cursor on failure", async () => {
    const { store } = db();
    store.setSetting("active-profile", "p");
    store.setSetting("slack-watermark:C0BU8TX3NTW", "1");
    const messages = [
      { ts: String(stamp("2026-10-30T18:00:00Z") / 1000), text: "one" },
      { ts: String(stamp("2026-10-30T19:00:00Z") / 1000), text: "two" },
      {
        ts: String(stamp("2026-10-30T20:00:00Z") / 1000),
        text: "bot",
        bot_id: "bot",
      },
      { ts: String(stamp("2026-10-31T18:00:00Z") / 1000), text: "outside" },
    ];
    const slack = {
      historyPage: vi.fn(),
      history: vi.fn().mockResolvedValue(messages),
      replies: vi.fn().mockResolvedValue([]),
    };
    slack.historyPage = vi.fn().mockImplementation(async () => ({
      messages: await slack.history(),
      nextCursor: null,
    }));
    const intake = new Intake(
      store,
      slack as never,
      configSchema.parse({ schedule }),
    );
    const now = stamp("2026-11-02T18:00:00Z");
    await intake.sweep(now);
    expect(store.list()).toHaveLength(2);
    await intake.sweep(now);
    expect(store.list()).toHaveLength(2);
    const cursor = store.getSetting("slack-watermark:C0BU8TX3NTW");
    slack.replies.mockRejectedValueOnce(new Error("offline"));
    await expect(intake.sweep(now + 1000)).rejects.toThrow("offline");
    expect(store.getSetting("slack-watermark:C0BU8TX3NTW")).toBe(cursor);
  });
  it("does not classify ordinary mentions of engines as triage", () => {
    expect(
      hasTriage([
        { ts: "1", text: "Claude, Codex and ChatGPT investigated this bug" },
      ]),
    ).toBe(false);
    expect(
      hasTriage([
        { ts: "2", text: "nola-bug-management/report-triage/NOLA-55" },
      ]),
    ).toBe(true);
  });
});
describe("Remote effects", () => {
  it("never performs a write twice after response loss, reconciling persisted pending state", async () => {
    const { store } = db();
    const effects = new Effects(store);
    const write = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(
      effects.once("r", "marker", async () => undefined, write),
    ).rejects.toThrow();
    expect(
      await effects.once("r", "marker", async () => "existing-id", write),
    ).toBe("existing-id");
    expect(
      await effects.once("r", "marker", async () => undefined, write),
    ).toBe("existing-id");
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("blocks uncertain absent writes instead of retrying blindly", async () => {
    const { store } = db();
    const effects = new Effects(store);
    await expect(
      effects.once(
        "r",
        "marker",
        async () => undefined,
        async () => {
          throw new Error("timeout");
        },
      ),
    ).rejects.toThrow();
    const write = vi.fn();
    await expect(
      effects.once("r", "marker", async () => undefined, write),
    ).rejects.toThrow("uncertain");
    expect(write).not.toHaveBeenCalled();
  });
});
describe("Private decisions", () => {
  it("requires author, DM, thread, version and current state, then deduplicates replies", async () => {
    const { store } = db();
    const run = store.create("support", "C:1", "claude", "p", {});
    const slack = {
      web: {
        conversations: { open: async () => ({ channel: { id: "DPRIVATE" } }) },
      },
      openPrivate: async () => "DPRIVATE",
      post: vi.fn().mockResolvedValue("100"),
      find: async () => undefined,
    };
    const service = new DecisionService(store, slack as never, "UOWNER");
    const d = await service.ask(run.id, "Expected behavior?", ["A", "B"], 1000);
    const reply = {
      id: d.id,
      user: "UOWNER",
      channel: "DPRIVATE",
      thread: "100",
      receipt: "reply-1",
      version: 1,
      answer: "A",
      at: 2000,
    };
    expect(service.accept({ ...reply, user: "UOTHER" })).toBe(false);
    expect(service.accept({ ...reply, channel: "CPUBLIC" })).toBe(false);
    expect(service.accept({ ...reply, version: 0 })).toBe(false);
    expect(service.accept({ ...reply, at: 999 })).toBe(false);
    expect(service.accept({ ...reply, at: Number.NaN })).toBe(false);
    expect(service.accept(reply)).toBe(true);
    expect(service.accept(reply)).toBe(false);
  });
  it("persists ten-minute reminders and stops after answer or pause", async () => {
    const { store } = db();
    const run = store.create("support", "C:1", "claude", "p", {});
    const slack = {
      web: {
        conversations: { open: async () => ({ channel: { id: "DPRIVATE" } }) },
      },
      openPrivate: async () => "DPRIVATE",
      post: vi.fn().mockResolvedValue("100"),
      find: async () => undefined,
      replies: async () => [],
    };
    const service = new DecisionService(store, slack as never, "UOWNER");
    const d = await service.ask(run.id, "Question", ["A"], 1000);
    expect(slack.post).toHaveBeenCalledTimes(2);
    await service.poll(600999);
    expect(slack.post).toHaveBeenCalledTimes(2);
    await service.poll(601000);
    expect(slack.post).toHaveBeenCalledTimes(3);
    await service.poll(601001);
    expect(slack.post).toHaveBeenCalledTimes(3);
    store.db.prepare("UPDATE runs SET paused=1 WHERE id=?").run(run.id);
    await service.poll(1300000);
    expect(slack.post).toHaveBeenCalledTimes(3);
    store.db.prepare("UPDATE runs SET paused=0 WHERE id=?").run(run.id);
    expect(
      service.accept({
        id: d.id,
        user: "UOWNER",
        channel: "DPRIVATE",
        thread: "100",
        receipt: "answer",
        version: 1,
        answer: "A",
        at: 1300001,
      }),
    ).toBe(true);
    await service.poll(2000000);
    expect(slack.post).toHaveBeenCalledTimes(3);
  });
});
describe("Worker isolation and product scope", () => {
  it("queues excess workers and leaves other runs runnable while one awaits a decision", async () => {
    const { store } = db();
    const first = store.create("support", "C:1", "claude", "p", {});
    store.create("support", "C:2", "claude", "p", {});
    store.create("support", "C:3", "claude", "p", {});
    const releases: (() => void)[] = [];
    const step = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const pool = new WorkerPool(store, 2, step);
    await pool.tick();
    expect(step).toHaveBeenCalledTimes(2);
    await pool.tick();
    expect(step).toHaveBeenCalledTimes(2);
    pool.control(first.id, "pause");
    expect(store.get(first.id).paused).toBe(1);
    releases.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    await pool.tick();
    expect(step).toHaveBeenCalledTimes(4);
    releases.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
  });
  it("prevents stale worker saves from undoing pause/cancellation", () => {
    const { store } = db();
    const stale = store.create("support", "C:1", "claude", "p", {});
    store.db
      .prepare("UPDATE runs SET paused=1,state='cancelled' WHERE id=?")
      .run(stale.id);
    stale.state = "investigating";
    store.save(stale);
    expect(store.get(stale.id).state).toBe("cancelled");
    expect(store.get(stale.id).paused).toBe(1);
  });
  it("excludes all Totem/SmartPOS and mixed dependencies before editing", () => {
    const scope = new ScopePolicy();
    expect(() => scope.assert(["arcca-pdv"], ["web"])).not.toThrow();
    for (const product of ["Totem", "SmartPOS", "noah-smart-pos"])
      expect(() => scope.assert(["arcca-pdv"], ["web", product])).toThrow();
    expect(() => scope.assert(["noah-smart-pos"], ["web"])).toThrow();
    expect(() => scope.assert([], ["web"])).toThrow();
  });
});
describe("Persisted evidence guards", () => {
  it("does not accept an eligibility event merely because the state allows it", () => {
    const { store } = db();
    const run = store.create("development", "NOLA-GUARD", "codex", "p", {});
    const flow = new Workflow(store);
    flow.transition(run, "START");
    flow.transition(run, "FORM");
    expect(() => flow.transition(run, "ELIGIBLE")).toThrow("JEV");
    run.data.jev = { classification: "A-candidate" };
    run.data.form = {
      repositories: ["arcca-pdv"],
      products: ["web", "SmartPOS"],
    };
    expect(() => flow.transition(run, "ELIGIBLE")).toThrow("SmartPOS");
  });
});
it("refuses a future schema instead of resetting its version or silently migrating legacy state", () => {
  const { store, directory } = db();
  store.db.exec("PRAGMA user_version=2");
  expect(() => new Store(join(directory, "state.db"))).toThrow("migration");
  expect(store.db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
});
