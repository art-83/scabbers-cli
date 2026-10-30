import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { engineEnvironment } from "../engine-environment.js";
import { parse } from "smol-toml";

function toml(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return "[" + value.map(toml).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .map(([key, item]) => JSON.stringify(key) + " = " + toml(item))
        .join(",") +
      "}"
    );
  throw new Error("Invalid native browser configuration");
}

/** Use the installed first-party transport; do not copy extension tokens or browser state. */
export function nativeBrowserConfiguration(
  home = process.env.CODEX_HOME ?? join(homedir(), ".codex"),
): { args: string[]; environment: NodeJS.ProcessEnv } {
  const root = join(home, "plugins/cache/openai-bundled/unified-computer-use");
  if (!existsSync(root))
    throw new Error(
      "Official browser runtime missing. Install/reload the Chrome and Browser plugins in the Codex app.",
    );
  const versions = readdirSync(root).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  const file = ["latest", ...versions]
    .map((version) => join(root, version, ".mcp.json"))
    .find(existsSync);
  if (!file)
    throw new Error(
      "Official browser transport manifest unavailable; reload the Browser plugin",
    );
  const server = JSON.parse(readFileSync(file, "utf8")).mcpServers?.cua_repl;
  if (
    typeof server?.command !== "string" ||
    !Array.isArray(server.args) ||
    !server.env ||
    typeof server.env !== "object"
  )
    throw new Error("Invalid official browser transport manifest");
  const args: string[] = [];
  const userFile = join(home, "config.toml");
  if (existsSync(userFile)) {
    try {
      const user = parse(readFileSync(userFile, "utf8"));
      if (user.browser_use)
        args.push("-c", "browser_use=" + toml(user.browser_use));
    } catch {
      throw new Error(
        "Cannot read the engine's native browser policy; correct Codex config.toml before retrying",
      );
    }
  }
  for (const key of [
    "command",
    "args",
    "env",
    "env_vars",
    "enabled",
    "enabled_tools",
    "startup_timeout_sec",
    "tool_timeout_sec",
  ])
    if (server[key] !== undefined)
      args.push(
        "-c",
        `mcp_servers.cua_repl.${key}=${toml(key === "env" ? { ...server.env, BROWSER_USE_AVAILABLE_BACKENDS: "chrome", CUA_REPL_ENABLED_SURFACES: "browser" } : server[key])}`,
      );
  const environment = engineEnvironment();
  const bridgeKeys = [
    "BROWSER_USE_ACCESS_EXECUTOR_ID",
    "BROWSER_USE_ACCESS_PIPE_PATH",
    "BROWSER_USE_ACCESS_VERIFYING_IDENTITY",
  ];
  for (const name of bridgeKeys)
    if (server.env_vars?.includes(name) && process.env[name])
      environment[name] = process.env[name];
  return { args, environment };
}
