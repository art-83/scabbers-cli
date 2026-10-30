import type { Config } from "../config/types/config.js";
import type { Store } from "../storage/store.js";
import type { Engine } from "../engines/abstractions/interface/engine.js";
import { CodexEngine } from "../engines/codex/codex-engine.js";
import { ClaudeEngine } from "../engines/claude/claude-engine.js";
import { BrowserSession } from "./session.js";

export type BrowserDiagnostic = {
  status: "checking" | "connected" | "blocked";
  engine: string;
  origin: string;
  summary: string;
  checkedAt: number;
  sessionId: string | null;
  processId?: number;
};

export async function checkNativeBrowser(
  store: Store,
  config: Config,
  engine?: Engine,
): Promise<BrowserDiagnostic> {
  const previous = store.getSetting("browser-diagnostic") as
    BrowserDiagnostic | undefined;
  const endpoint =
    config.browser.testOrigin ??
    previous?.origin ??
    config.repositories[0]?.stagingUrl;
  if (!endpoint)
    throw new Error(
      "Select a read-only test origin or configure a staging endpoint in Browser settings before testing",
    );
  const origin = new URL(endpoint).origin;
  if (previous?.processId) {
    try {
      process.kill(previous.processId, 0);
      throw new Error("Previous browser check is still running");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  let diagnostic: BrowserDiagnostic = {
    status: "checking",
    engine: config.engine,
    origin,
    summary: "Checking the official browser connection (read-only)",
    checkedAt: Date.now(),
    sessionId:
      previous?.engine === config.engine && previous.origin === origin
        ? previous.sessionId
        : null,
  };
  store.setSetting("browser-diagnostic", diagnostic);
  store.log(
    null,
    `Browser diagnostic: starting ${config.engine} read-only check for ${origin}`,
  );
  const browser = new BrowserSession(config.browser, store);
  const adapter =
    engine ??
    (config.engine === "codex"
      ? new CodexEngine(undefined, browser)
      : new ClaudeEngine(undefined, browser));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const result = await adapter.execute({
      runId: `browser-check:${config.engine}:${origin}`,
      stage: "browser-read-only-check",
      cwd: process.cwd(),
      sessionId: diagnostic.sessionId,
      mode: "browser",
      browserAuthorized: true,
      allowedOrigins: [origin],
      signal: controller.signal,
      onActivity: (message) =>
        store.log(null, `Browser diagnostic · ${config.engine}: ${message}`),
      onSession: (sessionId) => {
        diagnostic.sessionId = sessionId;
        store.setSetting("browser-diagnostic", diagnostic);
      },
      onProcess: (processId) => {
        diagnostic.processId = processId;
        store.setSetting("browser-diagnostic", diagnostic);
      },
      prompt: `This is an explicitly authorized READ-ONLY browser connectivity check for ${origin}. Use ONLY native browser tools for the selected engine. Open a NEW Chrome tab at that exact origin using the existing signed-in profile. Read the returned documentation and observe the visible page title, URL and one heading. Do not inspect other tabs, click application buttons, enter data, submit forms, change permissions, publish, use CDP/Playwright alternatives or bypass any native permission decision. A login page can confirm browser connectivity but does not confirm application authentication; say so. If a native permission gate refuses access, return status question with the blocked origin, summary and question explaining where the user can approve that site and then retry. Do not claim that the configured test target changes the extension's permissions, and never wait for input in an invisible terminal. Return status passed only with actual visible page evidence.`,
    });
    diagnostic = {
      ...diagnostic,
      status: result.status === "passed" ? "connected" : "blocked",
      summary: result.summary,
      checkedAt: Date.now(),
    };
  } catch (error) {
    store.log(
      null,
      `Browser diagnostic failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    diagnostic = {
      ...diagnostic,
      status: "blocked",
      summary:
        "Native browser connection not verified. Check browser/plugin setup and the site's permission in the selected engine’s browser permissions; then retry. No site permissions were changed.",
      checkedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
  store.log(
    null,
    `Browser diagnostic ${diagnostic.status}: ${diagnostic.summary}`,
  );
  delete diagnostic.processId;
  store.setSetting("browser-diagnostic", diagnostic);
  return diagnostic;
}
