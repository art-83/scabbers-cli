import { afterEach, expect, it, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { ValidatedMemberAnalysis } from "../src/features/validated-member-analysis.js";
import { FeatureAnalysis } from "../src/features/analysis.js";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const member = (key: string) => ({
    key,
    fields: {
      issuetype: { name: "Story" },
      description: "Verified criteria",
      summary: key,
      project: { key: "SNOLA" },
    },
  });
  const run = store.create("feature", "member-analysis", "codex", "profile", {
    family: {
      root: "SNOLA-1",
      complete: true,
      digest: "fixture",
      ancestors: [],
      members: [member("SNOLA-1"), member("SNOLA-2")],
    },
    scopeMembers: ["SNOLA-1", "SNOLA-2"],
    featureAnalyses: { "SNOLA-1": { summary: "Prior verified analysis" } },
    analysisWorkspaces: { "arcca-pdv": "/pinned" },
    analysisRevisions: { "arcca-pdv": "original-commit" },
  });
  run.state = "investigating";
  run.sessionId = "existing-session";
  store.save(run);
  const valid = {
    key: "SNOLA-2",
    summary: "Read actual code",
    acceptance: ["Preserve ordering"],
    approach: "Extend the existing query and preserve legacy behavior.",
    dependencies: [],
  };
  const invalid = {
    ...valid,
    approach: {
      recommendation: "Extend the existing query",
      boundaries: ["Preserve legacy behavior"],
    },
  };
  return { store, run, valid, invalid };
}
it("repairs an object approach in member analysis and preserves existing session, revision and sibling analyses", async () => {
  const f = fixture();
  const executor = {
    execute: vi
      .fn()
      .mockImplementationOnce(async (_run, instruction) => {
        const schema = JSON.parse(
          instruction.split("Exact member data schema: ")[1],
        );
        expect(schema.properties.approach.type).toBe("string");
        return { status: "passed", data: f.invalid };
      })
      .mockImplementationOnce(async (run, _instruction, _skill, mode, cwd) => {
        expect(run.data.memberRepair.rejected.approach).toEqual(
          f.invalid.approach,
        );
        expect(mode).toBe("read");
        expect(cwd).toBe("/pinned");
        return { status: "passed", data: f.valid };
      }),
  };
  const decisions = { ask: vi.fn() };
  await new FeatureAnalysis(
    f.store,
    executor as never,
    decisions as never,
  ).investigate(f.run, "/pinned", new AbortController().signal);
  const resumed = f.store.get(f.run.id);
  expect(resumed.data.featureAnalyses).toEqual({
    "SNOLA-1": { summary: "Prior verified analysis" },
    "SNOLA-2": f.valid,
  });
  expect(resumed.sessionId).toBe("existing-session");
  expect(resumed.data.analysisRevisions).toEqual({
    "arcca-pdv": "original-commit",
  });
  expect(resumed.data.memberRepair).toBeUndefined();
  expect(decisions.ask).not.toHaveBeenCalled();
  expect(executor.execute).toHaveBeenCalledTimes(2);
});
it.each(["invalid-type", "wrong-card"])(
  "caps member repair attempts across restarts: %s",
  async (kind) => {
    const f = fixture(),
      invalid =
        kind === "invalid-type" ? f.invalid : { ...f.valid, key: "SNOLA-999" };
    const executor = {
      execute: vi.fn(async () => ({ status: "passed", data: invalid })),
    };
    await expect(
      new ValidatedMemberAnalysis(f.store, executor as never).read(
        f.run,
        "SNOLA-2",
        invalid,
        "/pinned",
        new AbortController().signal,
      ),
    ).rejects.toThrow("two automatic repairs");
    expect(executor.execute).toHaveBeenCalledTimes(2);
    await expect(
      new ValidatedMemberAnalysis(f.store, executor as never).read(
        f.store.get(f.run.id),
        "SNOLA-2",
        invalid,
        "/pinned",
        new AbortController().signal,
      ),
    ).rejects.toThrow("two automatic repairs");
    expect(executor.execute).toHaveBeenCalledTimes(2);
  },
);
it("does not consume a second member's repair budget", async () => {
  const f = fixture();
  f.run.data.memberRepair = {
    target: "SNOLA-1",
    attempts: 2,
    rejected: {},
    diagnostic: "Prior failed repair",
  };
  f.store.save(f.run);
  const executor = {
    execute: vi.fn(async () => ({ status: "passed", data: f.valid })),
  };
  expect(
    (
      await new ValidatedMemberAnalysis(f.store, executor as never).read(
        f.run,
        "SNOLA-2",
        f.invalid,
        "/pinned",
        new AbortController().signal,
      )
    ).key,
  ).toBe("SNOLA-2");
  expect(executor.execute).toHaveBeenCalledTimes(1);
});
it("does not convert a contract repair into a product question", async () => {
  const f = fixture(),
    executor = {
      execute: vi.fn(async () => ({
        status: "question",
        question: "Choose text or object",
      })),
    };
  await expect(
    new ValidatedMemberAnalysis(f.store, executor as never).read(
      f.run,
      "SNOLA-2",
      f.invalid,
      "/pinned",
      new AbortController().signal,
    ),
  ).rejects.toThrow("maintainer inspection required");
  expect(
    f.store.db.prepare("SELECT count(*) as n FROM decisions").get()?.n,
  ).toBe(0);
});
it("honors cancellation before launching repairs", async () => {
  const f = fixture(),
    executor = { execute: vi.fn() },
    abort = new AbortController();
  abort.abort();
  await expect(
    new ValidatedMemberAnalysis(f.store, executor as never).read(
      f.run,
      "SNOLA-2",
      f.invalid,
      "/pinned",
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(executor.execute).not.toHaveBeenCalled();
});
