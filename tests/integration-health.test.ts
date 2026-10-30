import { it, expect, vi, beforeEach, afterEach } from "vitest";
const slack = vi.hoisted(() => ({ auth: vi.fn(), history: vi.fn() }));
vi.mock("@slack/web-api", () => ({
  WebClient: class {
    auth = { test: slack.auth };
    conversations = { history: slack.history };
  },
}));
import { checkIntegrations } from "../src/integrations/health.js";
import { configSchema } from "../src/config/types/config.js";
import { Secrets } from "../src/integrations/secrets.js";
const config = configSchema.parse({
  remoteEnabled: false,
  jira: {
    baseUrl: "https://jira.example.com",
    email: "user@example.com",
    accountId: "assignee",
    project: "SNOLA",
  },
  gitlab: { baseUrl: "https://gitlab.example.com", projectId: "group/project" },
});
beforeEach(() => {
  slack.auth.mockReset().mockResolvedValue({ ok: true, team: "ARCCA" });
  slack.history.mockReset().mockResolvedValue({ ok: true, messages: [] });
  vi.spyOn(Secrets.prototype, "get").mockResolvedValue("fixture-token");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("verifies authentication and configured resource access using read-only calls even with automation off", async () => {
  const fetch = vi.fn(async (url: URL) => {
    const body = url.pathname.endsWith("myself")
      ? { accountId: "authenticated-user", active: true }
      : url.pathname.includes("/rest/api/3/project/")
        ? { key: "SNOLA" }
        : url.pathname.endsWith("/user")
          ? { id: 1, state: "active" }
          : { id: 2 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const health = await checkIntegrations(config);
  expect(health.map((item) => item.status)).toEqual([
    "connected",
    "connected",
    "connected",
  ]);
  expect(slack.history).toHaveBeenCalledWith({
    channel: config.slack.channel,
    limit: 1,
  });
  expect(fetch.mock.calls).toHaveLength(4);
  for (const call of vi.mocked(globalThis.fetch).mock.calls)
    expect(call[1]?.method).toBe("GET");
  expect(health.every((item) => item.checkedAt !== null)).toBe(true);
});

it("keeps failures independent, requires resource access, and never displays remote error details", async () => {
  slack.history.mockRejectedValue(new Error("fixture-token private-response"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("myself"))
        return new Response(
          JSON.stringify({ accountId: "user", active: true }),
        );
      return new Response("fixture-token private-response", { status: 403 });
    }),
  );
  const health = await checkIntegrations({ ...config, gitlab: undefined });
  expect(health.map((item) => item.status)).toEqual([
    "disconnected",
    "disconnected",
    "disconnected",
  ]);
  expect(health[2]?.detail).toBe("Not configured");
  expect(JSON.stringify(health)).not.toContain("fixture-token");
  expect(JSON.stringify(health)).not.toContain("private-response");
  slack.history.mockResolvedValue({ ok: true, messages: [] });
  const recovered = await checkIntegrations({ ...config, gitlab: undefined });
  expect(recovered.map((item) => item.status)).toEqual([
    "connected",
    "disconnected",
    "disconnected",
  ]);
});
