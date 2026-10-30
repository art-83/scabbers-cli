import { engineEnvironment } from "../engine-environment.js";
import { defaultBrowserSession } from "../../browser/session.js";
import type { BrowserRuntime } from "../abstractions/interface/browser-runtime.js";
import { nativeBrowserConfiguration } from "./native-browser.js";
import type { Engine } from "../abstractions/interface/engine.js";
import type { StageInput } from "../types/stage-input.js";
import { stageResultSchema, type StageResult } from "../types/stage-result.js";
import { ProcessRunner } from "../../runtime/process-runner.js";
export class CodexEngine implements Engine {
  readonly id = "codex" as const;
  readonly capabilities = {
    nativeSessions: true,
    read: true,
    edit: true,
    nativeBrowser: true,
    browserRequirement:
      "Requires the installed official Codex browser runtime, Chrome extension, signed-in profile and native site permission. Denied access remains blocked.",
  };
  constructor(
    private readonly processRunner = new ProcessRunner(),
    private readonly browser: BrowserRuntime = defaultBrowserSession,
    private readonly nativeConfiguration = nativeBrowserConfiguration,
  ) {}
  async execute(input: StageInput): Promise<StageResult> {
    if (input.mode === "browser" && !input.browserAuthorized)
      throw new Error(
        "Native browser navigation requires explicit authorization",
      );
    if (input.mode === "browser")
      return this.browser.run(input, () => this.executeNative(input));
    return this.executeNative(input);
  }
  private async executeNative(input: StageInput): Promise<StageResult> {
    const native =
      input.mode === "browser" ? this.nativeConfiguration() : undefined;
    let session: string | null = input.sessionId;
    let text = "";
    const args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "-c",
      `approval_policy="${input.mode === "browser" ? "on-request" : "never"}"`,
      "-c",
      `sandbox_mode="${input.mode === "read" ? "read-only" : "workspace-write"}"`,
      "-c",
      "sandbox_workspace_write.network_access=false",
    ];
    if (native) args.push(...native.args);
    if (input.mode === "edit" && input.directories?.length)
      args.push(
        "-c",
        "sandbox_workspace_write.writable_roots=" +
          JSON.stringify(input.directories),
      );
    if (session) args.push("resume", session);
    args.push("-");
    const result = await this.processRunner.run(
      "codex",
      args,
      input.cwd,
      input.prompt +
        (native
          ? "\nUse only the official mcp__cua_repl browser tools with Chrome. Follow the tool's first-call entrypoint and returned documentation. Staging scope origins (not a native permission grant): " +
            JSON.stringify(input.allowedOrigins ?? []) +
            ". Never bypass native origin permissions, use CDP/Playwright substitutes, inspect existing unrelated tabs or claim success without observed UI evidence. If native permission is refused/unavailable, return status question with the exact origin and explain that the user must approve it in Codex Settings > Computer Use > Chrome > Manage, then retry this saved session. Do not wait for input in an invisible terminal."
          : "") +
        "\nReturn only JSON matching: " +
        JSON.stringify({
          status: "passed|failed|blocked|question",
          summary: "string",
          evidence: ["observed evidence"],
          question: null,
          options: [],
          data: {},
        }),
      (line) => {
        const event = JSON.parse(line);
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          input.onActivity?.("Assistant: " + event.item.text);
        if (
          ["item.started", "item.completed"].includes(event.type) &&
          ["command_execution", "mcp_tool_call"].includes(event.item?.type)
        ) {
          input.onActivity?.(
            `${event.type}: ${event.item.type} ${event.item.tool ?? event.item.command ?? ""}`,
          );
          if (
            event.item.type === "command_execution" &&
            event.item.aggregated_output
          )
            input.onActivity?.(
              "Command output: " + event.item.aggregated_output,
            );
        }
        if (event.type === "error" || event.type === "turn.failed")
          input.onActivity?.(
            "Engine error: " +
              JSON.stringify(event.error ?? event.message ?? "failed"),
          );
        if (event.type === "thread.started") {
          if (session && session !== event.thread_id)
            throw new Error("Session mismatch");
          session = event.thread_id;
          input.onSession(session!);
        }
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          text = event.item.text;
      },
      input.signal,
      600_000,
      input.onProcess,
      native?.environment ?? engineEnvironment(),
      (line) => input.onActivity?.("stderr: " + line),
    );
    if (result.code || !session)
      throw new Error("Codex failed; inspect saved session before retry");
    return stageResultSchema.parse(JSON.parse(text));
  }
}
