import { accessSync, constants, realpathSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { engineEnvironment } from "../engine-environment.js";
import { defaultBrowserSession } from "../../browser/session.js";
import type { BrowserRuntime } from "../abstractions/interface/browser-runtime.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Engine } from "../abstractions/interface/engine.js";
import type { StageInput } from "../types/stage-input.js";
import { stageResultSchema, type StageResult } from "../types/stage-result.js";
import { ProcessRunner } from "../../runtime/process-runner.js";
export class ClaudeEngine implements Engine {
  readonly id = "claude" as const;
  readonly capabilities = {
    nativeSessions: true,
    read: true,
    edit: true,
    nativeBrowser: true,
    browserRequirement:
      "Claude --chrome requires connected official extension, native host, login and explicit navigation authorization",
  };
  constructor(
    private readonly processRunner = new ProcessRunner(),
    private readonly browser: BrowserRuntime = defaultBrowserSession,
    private readonly browserQuery: typeof query = query,
  ) {}
  async execute(input: StageInput): Promise<StageResult> {
    if (input.mode === "browser" && !input.browserAuthorized)
      throw new Error(
        "Native browser navigation requires explicit per-run authorization",
      );
    if (input.mode === "browser")
      return this.browser.run(input, () => this.executeBrowser(input));
    return this.executeNative(input);
  }
  private async executeBrowser(input: StageInput): Promise<StageResult> {
    const session = input.sessionId ?? randomUUID();
    input.onSession(session);
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 600000);
    try {
      const messages = this.browserQuery({
        prompt: input.prompt,
        options: {
          pathToClaudeCodeExecutable: (() => {
            for (const directory of (process.env.PATH ?? "").split(":")) {
              const candidate = join(directory, "claude");
              try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
              } catch {}
            }
            throw new Error("Claude CLI not found on PATH");
          })(),
          cwd: input.cwd,
          env: engineEnvironment(),
          abortController: controller,
          ...(input.sessionId ? { resume: session } : { sessionId: session }),
          additionalDirectories: [
            ...(input.directories ?? []),
            ...(input.readDirectories ?? []),
          ],
          settingSources: ["user"],
          strictMcpConfig: true,
          mcpServers: {},
          tools: ["Read", "Grep", "Glob"],
          permissionMode: "default",
          permissionPrompts: "host",
          extraArgs: { chrome: null },
          maxBudgetUsd: 5,
          outputFormat: {
            type: "json_schema",
            schema: z.toJSONSchema(stageResultSchema, { target: "draft-7" }),
          },
          spawnClaudeCodeProcess: (options) => {
            const child = spawn(options.command, options.args, {
              cwd: options.cwd,
              env: options.env,
              signal: options.signal,
              stdio: ["pipe", "pipe", "pipe"],
            });
            if (child.pid) input.onProcess?.(child.pid);
            return child;
          },
          canUseTool: async (tool, parameters) => {
            // Browser tools are preauthorized only inside the serialized browser stage.
            // The extension's independent site checks and explicit native denials remain authoritative.
            if (tool.startsWith("mcp__claude-in-chrome__"))
              return { behavior: "allow", updatedInput: parameters };
            return {
              behavior: "deny",
              message:
                "Only native Chrome tools are preauthorized in browser stages",
            };
          },
        },
      });
      for await (const message of messages) {
        if ("session_id" in message && message.session_id !== session)
          throw new Error("Claude did not confirm the saved native session");
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error)
            throw new Error(
              "Claude browser check failed; native session preserved",
            );
          return stageResultSchema.parse(
            message.structured_output ?? JSON.parse(message.result),
          );
        }
      }
      throw new Error("Claude ended without a browser result");
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
    }
  }
  private async executeNative(input: StageInput): Promise<StageResult> {
    const directories = input.directories ?? [input.cwd];
    const session = input.sessionId ?? randomUUID();
    input.onSession(session);
    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--max-budget-usd",
      "5",
      "--setting-sources",
      input.mode === "browser" ? "user" : "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--json-schema",
      JSON.stringify(z.toJSONSchema(stageResultSchema, { target: "draft-7" })),
      input.sessionId ? "--resume" : "--session-id",
      session,
    ];
    for (const directory of [
      ...directories,
      ...(input.readDirectories ?? []),
    ].filter((d) => d !== input.cwd))
      args.push("--add-dir", directory);
    if (input.mode === "browser")
      args.push(
        "--chrome",
        "--tools",
        "Read,Grep,Glob",
        "--allowedTools",
        "mcp__claude-in-chrome__*",
      );
    else args.push("--no-chrome");
    if (input.mode === "read")
      args.push(
        "--tools",
        "Read,Grep,Glob",
        "--allowedTools",
        "Read,Grep,Glob",
      );
    else if (input.mode === "edit")
      args.push(
        "--tools",
        "Read,Grep,Glob,Edit,Write",
        "--allowedTools",
        "Read,Grep,Glob," +
          directories.map((directory) => `Edit(/${directory}/**)`).join(","),
      );
    const result = await this.processRunner.run(
      "claude",
      args,
      input.cwd,
      input.prompt,
      () => {},
      input.signal,
      600_000,
      input.onProcess,
      engineEnvironment(),
    );
    if (result.code !== 0)
      throw new Error("Claude failed; native session preserved for recovery");
    const raw = JSON.parse(result.stdout);
    if (raw.session_id !== session || raw.is_error)
      throw new Error("Claude did not confirm the saved native session");
    return stageResultSchema.parse(
      raw.structured_output ?? JSON.parse(raw.result),
    );
  }
}
