import { it, expect, vi } from "vitest";
import {
  browserOrigins,
  originsCovered,
} from "../src/browser/origin-policy.js";
import { configSchema } from "../src/config/types/config.js";
import { checkNativeBrowser } from "../src/browser/diagnostics.js";
import { BrowserSession } from "../src/browser/session.js";
import { Store } from "../src/storage/store.js";
import type { Engine } from "../src/engines/abstractions/interface/engine.js";
import type { StageInput } from "../src/engines/types/stage-input.js";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeBrowserConfiguration } from "../src/engines/codex/native-browser.js";
import { Configuration } from "../src/config/configuration.js";

it("loads native user browser restrictions without importing unrelated servers and migrates the old list to a diagnostic target only", () => {
  const home = mkdtempSync(join(tmpdir(), "scabbers-native-policy-"));
  const store = new Store(":memory:");
  try {
    const plugin = join(
      home,
      "plugins/cache/openai-bundled/unified-computer-use/1",
    );
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      join(plugin, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          cua_repl: {
            command: process.execPath,
            args: ["fixture.js"],
            env: { CUA_REPL_ENABLED_SURFACES: "browser" },
            enabled: true,
          },
        },
      }),
    );
    writeFileSync(
      join(home, "config.toml"),
      '[browser_use.default_origin_policy]\naccess = "deny"\n[mcp_servers.unrelated]\ncommand = "fixture-private-command"\n',
    );
    const native = nativeBrowserConfiguration(home);
    expect(native.args.join(" ")).toContain(
      'browser_use={"default_origin_policy" = {"access" = "deny"}}',
    );
    expect(native.args.join(" ")).not.toContain("fixture-private-command");
    expect(native.args.join(" ")).toContain("mcp_servers.cua_repl");
    const path = join(home, "settings.json");
    const settings = new Configuration(store, path);
    settings.save({
      browser: { approvedOrigins: ["https://staging.nolasistemas.com"] },
    });
    expect(settings.get().browser.testOrigin).toBe(
      "https://staging.nolasistemas.com",
    );
    expect(readFileSync(path, "utf8")).not.toContain("approvedOrigins");
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

it("bounds browser scope to exact HTTPS origins without granting related hosts, ports or redirect destinations", () => {
  const approved = ["https://staging.nolasistemas.com"];
  expect(
    originsCovered(
      browserOrigins(["https://staging.nolasistemas.com/orders"]),
      approved,
    ),
  ).toBe(true);
  for (const endpoint of [
    "https://nolasistemas.com",
    "https://api.staging.nolasistemas.com",
    "https://staging.nolasistemas.com.evil.example",
    "https://staging.nolasistemas.com:444",
    "https://login.example.com",
  ])
    expect(originsCovered(browserOrigins([endpoint]), approved)).toBe(false);
  expect(originsCovered([], approved)).toBe(false);
  for (const origin of [
    "http://staging.nolasistemas.com",
    "https://staging.nolasistemas.com/path",
    "https://user:secret@staging.nolasistemas.com",
    "https://*.nolasistemas.com",
  ])
    expect(
      configSchema.safeParse({ browser: { testOrigin: origin } }).success,
    ).toBe(false);
});

it("records a visible blocked diagnostic and resumes the same native session for a later read-only verification", async () => {
  const store = new Store(":memory:");
  const config = configSchema.parse({
    engine: "codex",
    browser: { testOrigin: "https://staging.nolasistemas.com" },
  });
  const execute = vi.fn(async (input: StageInput) => {
    input.onSession("fixture-native-session");
    return {
      status: "question",
      summary: "Native origin approval refused",
      question: "Approve this staging site in the browser settings",
      options: ["Retry"],
      evidence: [],
      data: {},
    };
  });
  try {
    const first = await checkNativeBrowser(store, config, {
      execute,
    } as unknown as Engine);
    expect(first.status).toBe("blocked");
    expect(store.getSetting("browser-diagnostic")).toMatchObject({
      summary: "Native origin approval refused",
      sessionId: "fixture-native-session",
    });
    execute.mockImplementationOnce(async (input) => {
      expect(input.sessionId).toBe("fixture-native-session");
      expect(input.prompt).toContain("READ-ONLY");
      expect(input.allowedOrigins).toEqual([
        "https://staging.nolasistemas.com",
      ]);
      return {
        status: "passed",
        summary:
          "Observed staging login page; application login remains pending",
        question: null,
        options: [],
        evidence: ["Visible heading"],
        data: {},
      } as never;
    });
    expect(
      (
        await checkNativeBrowser(store, config, {
          execute,
        } as unknown as Engine)
      ).status,
    ).toBe("connected");
    expect(store.list()).toHaveLength(0);
  } finally {
    store.close();
  }
});

it("serializes native browser stages and releases only its own browser lock", async () => {
  const store = new Store(":memory:");
  const browser = new BrowserSession({}, store);
  const launch = vi.spyOn(browser as any, "open").mockResolvedValue(undefined);
  const input: StageInput = {
    runId: "fixture",
    stage: "e2e",
    prompt: "",
    cwd: process.cwd(),
    sessionId: null,
    mode: "browser",
    browserAuthorized: true,
    onSession: () => {},
  };
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const order: string[] = [];
  try {
    store.acquire("worktree", "fixture");
    const first = browser.run(input, async () => {
      order.push("first");
      await wait;
      order.push("first done");
    });
    const second = browser.run(input, async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["first"]);
    finish();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "first done", "second"]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(store.acquire("native-browser", "another")).toBe(true);
    expect(store.acquire("worktree", "another")).toBe(false);
  } finally {
    finish();
    store.close();
    launch.mockRestore();
  }
});
