import { LOG_RETENTION_DAYS } from "../logging/text-log.js";
import { soulFile } from "../profile/soul-file.js";
import { BrowserSession } from "../browser/session.js";
import { checkIntegrations, pendingHealth } from "../integrations/health.js";
import type { Engine } from "../engines/abstractions/interface/engine.js";
import { createHash } from "node:crypto";
import { existsSync as exists } from "node:fs";
import { createServer } from "node:net";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "../storage/store.js";
import { Configuration } from "../config/configuration.js";
import { Secrets } from "../integrations/secrets.js";
import { Soul } from "../profile/soul.js";
import { ClaudeEngine } from "../engines/claude/claude-engine.js";
import { CodexEngine } from "../engines/codex/codex-engine.js";
import { SlackClient } from "../integrations/slack/slack-client.js";
import { JiraClient } from "../integrations/jira/jira-client.js";
import { ConfiguredJudge } from "../integrations/jev/configured-judge.js";
import { DecisionService } from "../decisions/decision-service.js";
import { SocketListener } from "../integrations/slack/socket-listener.js";
import { Intake } from "../support/intake.js";
import { StageExecutor } from "./stage-executor.js";
import { Pipeline } from "./pipeline.js";
import { WorkerPool } from "./worker-pool.js";
import { requestSchema } from "./protocol.js";
export async function daemon(directory: string): Promise<void> {
  const lock = join(directory, "runtime.pid"),
    socketPath = join(directory, "runtime.sock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error("Runtime already running");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    unlinkSync(lock);
  }
  writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const store = new Store(join(directory, "scabbers.db"));
  store.db.exec("DELETE FROM locks");
  const configuration = new Configuration(store);
  let config = configuration.get();
  let integrations = pendingHealth();
  let healthBusy = false,
    nextHealthCheck = 0;
  let settingsPending = false,
    settingsError: string | null = null;
  let pool: WorkerPool | undefined,
    decisions: DecisionService | undefined,
    intake: Intake | undefined,
    socket: SocketListener | undefined;
  let runtimeError: string | null = null;
  let nextSweep = 0,
    retry = 1000,
    ticking = false;
  let stopping = false;
  const activationDigest = () =>
    createHash("sha256").update(JSON.stringify(config)).digest("hex");
  const server = createServer((connection) => {
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 16000) {
        connection.destroy();
        return;
      }
      if (!buffer.includes("\n")) return;
      try {
        const input = requestSchema.parse(JSON.parse(buffer.split("\n")[0]!));
        let response: unknown;
        if (input.action === "status")
          response = {
            pid: process.pid,
            settingsFile: configuration.path,
            soulFile: soulFile(config, configuration.path),
            settingsPending,
            settingsError,
            integrations,
            logging: {
              directory: store.textLog?.directory,
              retentionDays: LOG_RETENTION_DAYS,
              error: store.loggingError,
            },
            browserDiagnostic: store.getSetting("browser-diagnostic") ?? null,
            remoteEnabled: config.remoteEnabled,
            engine: config.engine,
            workers: config.workers,
            profile: store.getSetting("active-profile") ?? null,
            runtimeError,
            activation: {
              digest: activationDigest(),
              schedule: config.schedule,
              slack: config.slack,
              jira: config.jira
                ? {
                    baseUrl: config.jira.baseUrl,
                    accountId: config.jira.accountId,
                  }
                : null,
              repositories: config.repositories.map((r) => ({
                name: r.name,
                path: r.path,
                stagingUrl: r.stagingUrl,
              })),
              skills: Object.keys(config.skillPaths),
            },
            runs: store.list().map((run) => ({
              ...run,
              data: {
                destination: run.data.destination,
                issueKey: run.data.issueKey,
              },
              snapshot: null,
              logs: store.logs(run.id),
            })),
            decisions:
              decisions?.list() ??
              store.db.prepare("SELECT * FROM decisions").all(),
          };
        else if (input.action === "activate") {
          if (
            input.digest !== activationDigest() ||
            input.digest !==
              createHash("sha256")
                .update(JSON.stringify(configuration.get()))
                .digest("hex")
          )
            throw new Error("Settings changed; review activation again");
          if (
            !store.getSetting("active-profile") ||
            !config.schedule ||
            !config.slack.user ||
            !config.jira ||
            !config.repositories.length
          )
            throw new Error(
              "Setup incomplete: approve SOUL and configure schedule, owner, Jira and NOLA web repositories",
            );
          for (const skill of [
            "nola-operations:report-triage",
            "nola-engineering:solution-analysis",
            "nola-engineering:bug-reproduction",
            "nola-engineering:delivery",
            "nola-engineering:code-review",
          ])
            if (!config.skillPaths[skill] || !exists(config.skillPaths[skill]))
              throw new Error("Missing required skill: " + skill);
          config.remoteEnabled = true;
          configuration.save(config);
          nextSweep = 0;
          response = { activated: true };
        } else if (input.action === "stop") {
          response = { stopping: true };
          setTimeout(shutdown, 20);
        } else {
          if (pool) pool.control(input.id, input.action);
          else {
            const run = store.get(input.id);
            run.paused = input.action === "resume" ? 0 : 1;
            if (input.action === "resume") run.error = null;
            if (input.action === "cancel") run.state = "cancelled";
            store.save(run);
            store.db
              .prepare("UPDATE runs SET paused=? WHERE id=?")
              .run(run.paused, run.id);
          }
          response = { ok: true };
        }
        connection.end(JSON.stringify(response) + "\n");
      } catch (error) {
        connection.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Invalid request",
          }) + "\n",
        );
      }
    });
    connection.on("error", () => {});
  });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    store.log(null, "Runtime shutdown requested; interrupting active stages");
    clearInterval(timer);
    pool?.shutdown();
    void socket?.stop();
    server.close();
    try {
      unlinkSync(socketPath);
      unlinkSync(lock);
    } catch {}
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      chmodSync(socketPath, 0o600);
      store.log(
        null,
        `Runtime started (pid ${process.pid}); automation ${config.remoteEnabled ? "active" : "off"}`,
      );
      resolve();
    });
  });
  const initialize = async () => {
    if (!config.remoteEnabled) return;
    if (!config.slack.user || !config.schedule)
      throw new Error(
        "Configure Slack owner identity and schedule before enabling remote processing",
      );
    const secrets = new Secrets(config.aws, config.credentialKeys);
    const slack = new SlackClient(
      await secrets.get(
        "SCABBERS_SLACK_BOT_TOKEN",
        config.slack.tokenParameter,
      ),
    );
    const auth = await slack.web.auth.test();
    if (auth.team?.toUpperCase() !== "ARCCA")
      throw new Error("Slack authentication did not confirm workspace ARCCA");
    decisions = new DecisionService(store, slack, config.slack.user);
    const soul = new Soul(
      store,
      directory,
      soulFile(config, configuration.path),
    );
    intake = new Intake(store, slack, config, soul);
    let jira: JiraClient | undefined;
    if (config.jira) {
      try {
        jira = new JiraClient(
          config.jira,
          await secrets.get("SCABBERS_JIRA_TOKEN"),
          store,
        );
      } catch {
        store.log(
          null,
          "Jira credentials unavailable; affected reports will request connection setup privately",
        );
      }
    }
    const jev = new ConfiguredJudge(config);
    const browser = new BrowserSession(config.browser, store);
    const engines = new Map<string, Engine>([
      ["claude", new ClaudeEngine(undefined, browser)],
      ["codex", new CodexEngine(undefined, browser)],
    ] as const);
    const executor = new StageExecutor(store, engines, soul, config);
    const pipeline = new Pipeline(
      store,
      config,
      executor,
      slack,
      decisions,
      jira,
      jev,
      directory,
    );
    pool = new WorkerPool(
      store,
      config.workers,
      (run, signal) => pipeline.step(run, signal),
      async (run, message) => {
        const d = await decisions!.ask(
          run.id,
          `Checkpoint ${run.state} blocked for ${run.source}: ${message}\nResolve the stated access/configuration issue directly, then retry this saved checkpoint. Never send passwords or tokens.`,
          ["Retry checkpoint", "Pause"],
        );
        return d.id;
      },
    );
    try {
      const appToken = await secrets.get(
        "SCABBERS_SLACK_APP_TOKEN",
        config.slack.appTokenParameter,
      );
      socket = new SocketListener(
        appToken,
        () => {
          nextSweep = 0;
        },
        (payload) => decisions!.action(payload),
      );
      await socket.start();
    } catch {
      store.log(
        null,
        "Socket Mode unavailable; using paginated history and private-thread polling. Configure app token separately.",
      );
    }
  };
  let nextInitialization = 0,
    nextDecisionPoll = 0;
  const tick = async () => {
    if (ticking || stopping) return;
    ticking = true;
    try {
      let loaded;
      try {
        loaded = configuration.get();
        settingsError = null;
      } catch (error) {
        settingsError =
          error instanceof Error ? error.message : "Invalid settings file";
        return;
      }
      const changed = JSON.stringify(loaded) !== JSON.stringify(config);
      settingsPending = changed;
      if (changed) {
        if (pool?.activeCount) return;
        const thisOwner = (id: string) =>
          store.db
            .prepare(
              "SELECT userId FROM decisions WHERE runId=? ORDER BY createdAt LIMIT 1",
            )
            .get(id)?.userId ?? config.slack.user;
        for (const run of store.list()) {
          if (!run.data.ownerSlackUser && config.slack.user) {
            run.data.ownerSlackUser = thisOwner(run.id);
            store.save(run);
          }
        }
        await socket?.stop();
        socket = undefined;
        pool = undefined;
        decisions = undefined;
        intake = undefined;
        config = loaded;
        integrations = pendingHealth();
        nextHealthCheck = 0;
        settingsPending = false;
        nextInitialization = 0;
        nextSweep = 0;
        nextDecisionPoll = 0;
        store.log(
          null,
          "Validated settings.json changes applied at an idle stage boundary",
        );
      }
      if (!healthBusy && Date.now() >= nextHealthCheck) {
        healthBusy = true;
        nextHealthCheck = Date.now() + 60000;
        const fingerprint = activationDigest();
        void checkIntegrations(config)
          .then((result) => {
            if (!stopping && fingerprint === activationDigest())
              integrations = result;
          })
          .catch(() => {
            if (fingerprint === activationDigest())
              integrations = pendingHealth().map((item) => ({
                ...item,
                status: "disconnected",
                detail: "Connection check failed",
                checkedAt: Date.now(),
              }));
          })
          .finally(() => {
            healthBusy = false;
          });
      }
      if (config.remoteEnabled && !pool && Date.now() >= nextInitialization) {
        try {
          await initialize();
          runtimeError = null;
          retry = 1000;
        } catch (error) {
          runtimeError =
            error instanceof Error
              ? error.message
              : "Runtime initialization failed";
          store.log(null, runtimeError);
          nextInitialization = Date.now() + retry;
          retry = Math.min(retry * 2, 300000);
        }
      }
      if (pool) {
        await pool.tick();
        const operations: Promise<void>[] = [];
        if (Date.now() >= nextDecisionPoll) {
          nextDecisionPoll = Date.now() + 15000;
          operations.push(
            decisions!.poll().catch((error) => {
              nextDecisionPoll = Date.now() + 30000;
              throw error;
            }),
          );
        }
        if (Date.now() >= nextSweep) {
          nextSweep = Date.now() + 60000;
          operations.push(
            intake!
              .sweep()
              .then(() => {
                retry = 1000;
              })
              .catch((error) => {
                nextSweep = Date.now() + retry;
                retry = Math.min(retry * 2, 300000);
                throw error;
              }),
          );
        }
        const results = await Promise.allSettled(operations);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          runtimeError =
            failure.reason instanceof Error
              ? failure.reason.message
              : "Connection temporarily unavailable";
          store.log(null, runtimeError);
        } else if (operations.length) runtimeError = null;
      }
    } catch (error) {
      runtimeError =
        error instanceof Error
          ? error.message
          : "Runtime settings/connection refresh failed";
      try {
        store.log(null, runtimeError);
      } catch {}
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  void tick();
}
