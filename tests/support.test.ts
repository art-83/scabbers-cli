import { it, expect, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { configSchema } from "../src/config/types/config.js";
import { Intake } from "../src/support/intake.js";
import { SupportProcessor } from "../src/support/support-processor.js";
import { Workflow } from "../src/workflows/workflow.js";
it("admits the verified report workflow bot while excluding Scabbers and other bot loops", async () => {
  const store = new Store(":memory:");
  store.setSetting("active-profile", "approved");
  store.setSetting("slack-watermark:C0BU8TX3NTW", "0");
  const ts = String(new Date("2026-10-30T18:00:00Z").getTime() / 1000);
  const messaging = {
    history: async () => [
      {
        ts,
        text: "report from workflow",
        bot_id: "B0C0B2WU7PU",
        subtype: "bot_message",
      },
      {
        ts: ts + ".1",
        text: "Scabbers update",
        bot_id: "BSCABBERS",
        subtype: "bot_message",
      },
    ],
    replies: async () => [],
  };
  Object.assign(messaging, {
    historyPage: async () => ({
      messages: await messaging.history(),
      nextCursor: null,
    }),
  });
  try {
    await new Intake(
      store,
      messaging as never,
      configSchema.parse({
        schedule: {
          zone: "America/Sao_Paulo",
          shifts: [{ day: "Friday", start: "14:00", end: "20:00" }],
        },
      }),
    ).sweep(new Date("2026-10-31T18:00:00Z").getTime());
    expect(store.list()).toHaveLength(1);
  } finally {
    store.close();
  }
});
it("extracts Jira evidence from a later thread reply, as observed in the real support workflow", async () => {
  const store = new Store(":memory:");
  const run = store.create("support", "C:1", "codex", "p", {
    channel: "C",
    thread: "1",
    text: "Report without a Jira key in the root",
  });
  new Workflow(store).transition(run, "START");
  const evidence = vi.fn().mockResolvedValue({
    key: "SNOLA-99",
    fields: { issuetype: { name: "Report" } },
  });
  const messaging = {
    replies: async () => [
      { ts: "1", text: "Report root" },
      { ts: "2", text: "https://arcca.atlassian.net/browse/SNOLA-99" },
    ],
  };
  const executor = {
    execute: vi.fn().mockResolvedValue({
      status: "passed",
      summary: "Observed objective route",
      evidence: ["code"],
      question: null,
      options: [],
      data: {
        reportKey: "SNOLA-99",
        type: "Bug",
        summary: "Bug",
        description:
          "Observed defect with specific verified evidence and route",
        evidence: ["code"],
        ambiguous: false,
      },
    }),
  };
  try {
    await new SupportProcessor(
      store,
      configSchema.parse({}),
      executor,
      messaging as never,
      {} as never,
      { evidence } as never,
    ).process(run, new AbortController().signal);
    expect(evidence).toHaveBeenCalledWith("SNOLA-99");
    expect(store.get(run.id).state).toBe("routing");
  } finally {
    store.close();
  }
});
it("persists a page cursor with a fixed upper bound and resumes beyond a failed backlog page", async () => {
  const store = new Store(":memory:");
  store.setSetting("active-profile", "p");
  store.setSetting("slack-watermark:C0BU8TX3NTW", "0");
  const first = String(Date.parse("2026-10-30T18:00:00Z") / 1000),
    second = String(Date.parse("2026-10-30T19:00:00Z") / 1000);
  let failed = false;
  const messaging = {
    historyPage: vi.fn(async (_channel, _oldest, _latest, cursor) => {
      if (cursor === "page2" && !failed) {
        failed = true;
        throw new Error("rate limited");
      }
      return cursor === "page2"
        ? { messages: [{ ts: second, text: "second" }], nextCursor: null }
        : { messages: [{ ts: first, text: "first" }], nextCursor: "page2" };
    }),
    replies: async () => [],
  };
  const intake = new Intake(
    store,
    messaging as never,
    configSchema.parse({
      schedule: {
        zone: "America/Sao_Paulo",
        shifts: [{ day: "Friday", start: "14:00", end: "20:00" }],
      },
    }),
  );
  try {
    const time = Date.parse("2026-11-02T18:00:00Z");
    await expect(intake.sweep(time)).rejects.toThrow("rate limited");
    expect(store.list()).toHaveLength(1);
    expect(store.getSetting("slack-watermark:C0BU8TX3NTW")).toBe("0");
    expect(store.getSetting("slack-scan:C0BU8TX3NTW")).toMatchObject({
      cursor: "page2",
    });
    await intake.sweep(time + 60000);
    expect(store.list()).toHaveLength(2);
    expect(messaging.historyPage.mock.calls[2]![3]).toBe("page2");
    expect(messaging.historyPage.mock.calls[2]![2]).toBe(
      (time / 1000).toFixed(6),
    );
    expect(store.getSetting("slack-watermark:C0BU8TX3NTW")).toBe(
      (time / 1000).toFixed(6),
    );
  } finally {
    store.close();
  }
});
