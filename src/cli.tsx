#!/usr/bin/env node
import { soulFile } from "./profile/soul-file.js";
import { Soul } from "./profile/soul.js";
import { reviewSoul } from "./profile/review-soul.js";
import { render } from "ink";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDirectory } from "./config/configuration.js";
import { Configuration } from "./config/configuration.js";
import { Store } from "./storage/store.js";
import { setup } from "./config/setup.js";
import { daemon } from "./runtime/daemon.js";
import { request } from "./runtime/client.js";
import { App } from "./tui/app.js";
const help = `Scabbers · NOLA support and development\n\nscabbers                  Open Support / Development / Config panel; detach with q\nscabbers --configure      Guided first setup and SOUL proposal/review\nscabbers --review-soul    Review an existing skill-generated SOUL proposal\nscabbers --doctor         Local configuration/capability diagnostics (no remote writes)\nscabbers --status         Runtime status JSON\nscabbers --stop           Stop local runtime (keeps data and sessions)\nscabbers --config FILE    Import non-secret JSON; remote processing forced OFF\nscabbers --help           Show help\n\nState: SCABBERS_HOME or ~/.local/state/scabbers. Node >=24 required.\n`;
async function main(): Promise<void> {
  if (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.argv.includes("--daemon")
  )
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  if (process.argv.includes("--help")) {
    console.log(help);
    return;
  }
  const directory = stateDirectory();
  if (process.argv.includes("--daemon")) {
    await daemon(directory);
    return;
  }
  if (process.argv.includes("--stop")) {
    console.log(await request(directory, { action: "stop" }));
    return;
  }
  if (process.argv.includes("--status")) {
    console.log(
      JSON.stringify(await request(directory, { action: "status" }), null, 2),
    );
    return;
  }
  const store = new Store(join(directory, "scabbers.db"));
  const configuration = new Configuration(store);
  if (process.argv.includes("--review-soul")) {
    try {
      await reviewSoul(
        new Soul(
          store,
          directory,
          soulFile(configuration.get(), configuration.path),
        ),
      );
    } finally {
      store.close();
    }
    return;
  }
  if (process.argv.includes("--configure")) {
    try {
      await request(directory, { action: "stop" });
    } catch {}
    await setup(store, directory);
    store.close();
    return;
  }
  const configIndex = process.argv.indexOf("--config");
  if (configIndex >= 0) {
    const path = process.argv[configIndex + 1];
    if (!path) throw new Error("Configuration JSON path required");
    configuration.save({
      ...JSON.parse(readFileSync(path, "utf8")),
      remoteEnabled: false,
    });
    store.close();
    console.log(
      "Configuration saved; remote processing OFF. The runtime reloads valid changes at the next idle stage boundary.",
    );
    return;
  }
  if (process.argv.includes("--doctor")) {
    const config = configuration.get();
    const active = store.getSetting("active-profile");
    const probe = async (command: string) => {
      try {
        return (
          await promisify(execFile)(command, ["--version"], {
            timeout: 5000,
            maxBuffer: 2000,
          })
        ).stdout.trim();
      } catch {
        return "not available; install/authenticate this engine independently";
      }
    };
    const [claudeVersion, codexVersion] = await Promise.all([
      probe("claude"),
      probe("codex"),
    ]);
    console.log(
      JSON.stringify(
        {
          node: process.version,
          engines: { claude: claudeVersion, codex: codexVersion },
          claudeChromeHostPresent: existsSync(
            join(homedir(), ".claude/chrome/chrome-native-host"),
          ),
          stateDirectory: directory,
          settingsFile: configuration.path,
          soulFile: soulFile(config, configuration.path),
          remoteEnabled: config.remoteEnabled,
          engine: config.engine,
          workers: config.workers,
          profile: active ?? "First SOUL review required",
          schedule: config.schedule ?? "Configure support windows and timezone",
          slackUser: config.slack.user ?? "Configure owner member ID",
          credentials: Object.fromEntries(
            [
              "SCABBERS_SLACK_BOT_TOKEN",
              "SCABBERS_SLACK_APP_TOKEN",
              "SCABBERS_JIRA_TOKEN",
              "SCABBERS_GITLAB_TOKEN",
              "TYPESAFE_API_KEY",
            ].map((name) => [
              name,
              process.env[name]
                ? "present (not displayed)"
                : "not in process environment; SSM references may be configured",
            ]),
          ),
          repositories: config.repositories.map((r) => ({
            name: r.name,
            path: r.path,
            stagingUrl: r.stagingUrl,
          })),
          skills: config.skillPaths,
          capabilities: {
            claudeBrowser:
              "Official --chrome; requires host, extension, login, explicit per-run navigation authorization",
            codexBrowser:
              "No verified supported CLI browser transport; E2E blocked",
            slackDM:
              "Paginated polling supported; message.im and interactivity need app configuration for live buttons",
          },
        },
        null,
        2,
      ),
    );
    store.close();
    return;
  }
  const loadedSettings = configuration.get();
  const sourceSoul = new Soul(
    store,
    directory,
    soulFile(loadedSettings, configuration.path),
  );
  const sourceVersion = sourceSoul.prepareSource();
  if (
    process.stdin.isTTY &&
    (!configuration.exists() ||
      !store.getSetting("active-profile") ||
      (sourceVersion && sourceSoul.latestProposal(sourceVersion)))
  )
    await setup(store, directory);
  store.close();
  try {
    await request(directory, { action: "status" });
  } catch {
    const log = openSync(join(directory, "runtime.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), "--daemon"],
      { detached: true, stdio: ["ignore", log, log], env: process.env },
    );
    child.unref();
    let connected = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await request(directory, { action: "status" });
        connected = true;
        break;
      } catch {}
    }
    if (!connected)
      throw new Error(
        "Runtime did not start. Inspect " + join(directory, "runtime.log"),
      );
  }
  if (!process.stdin.isTTY) {
    console.log(
      JSON.stringify(await request(directory, { action: "status" }), null, 2),
    );
    return;
  }
  await render(<App directory={directory} />).waitUntilExit();
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Scabbers failed");
  process.exitCode = 1;
});
