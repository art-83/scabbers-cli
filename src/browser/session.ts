import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { StageInput } from "../engines/types/stage-input.js";
import type { BrowserRuntime } from "../engines/abstractions/interface/browser-runtime.js";

export class BrowserSession implements BrowserRuntime {
  private static tail: Promise<void> = Promise.resolve();
  private readonly launched = new Set<string>();
  constructor(
    private readonly config: Config["browser"] = {},
    private readonly store?: Store,
  ) {}
  async run<T>(input: StageInput, execute: () => Promise<T>): Promise<T> {
    if (!input.browserAuthorized)
      throw new Error(
        "Browser navigation requires explicit authorization for the staging origins",
      );
    const previous = BrowserSession.tail;
    let release!: () => void;
    BrowserSession.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const owner = `${process.pid}:${input.runId}`;
    let acquired = false;
    try {
      if (input.signal?.aborted)
        throw new Error("Browser stage cancelled before launch");
      if (this.store) {
        const previousOwner = this.store.db
          .prepare("SELECT owner FROM locks WHERE resource=?")
          .get("native-browser")?.owner;
        if (typeof previousOwner === "string") {
          const pid = Number(previousOwner.split(":")[0]);
          try {
            if (pid > 0) process.kill(pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH")
              this.store.db
                .prepare("DELETE FROM locks WHERE resource=? AND owner=?")
                .run("native-browser", previousOwner);
          }
        }
        acquired = this.store.acquire("native-browser", owner);
        if (!acquired)
          throw new Error(
            "Native browser is busy with another Scabbers task; retry after it finishes",
          );
      }
      if (!this.launched.has(input.runId)) {
        await this.open();
        this.launched.add(input.runId);
      }
      return await execute();
    } finally {
      if (acquired)
        this.store!.db.prepare(
          "DELETE FROM locks WHERE resource=? AND owner=?",
        ).run("native-browser", owner);
      release();
    }
  }
  private async open(): Promise<void> {
    const names = this.config.executable
      ? [this.config.executable]
      : [
          "google-chrome-stable",
          "google-chrome",
          "chromium",
          "chromium-browser",
        ];
    let executable: string | undefined;
    for (const name of names) {
      const paths = isAbsolute(name)
        ? [name]
        : (process.env.PATH ?? "").split(":").map((path) => join(path, name));
      executable = paths.find((path) => {
        try {
          accessSync(path, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
      if (executable) break;
    }
    if (!executable)
      throw new Error(
        "Chrome/Chromium not found. Configure Browser > executable in Config.",
      );
    const args = [
      ...(this.config.profileDirectory
        ? [`--profile-directory=${this.config.profileDirectory}`]
        : []),
      "--new-window",
      "about:blank",
    ];
    const env = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XAUTHORITY",
      ].flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]]],
      ),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable!, args, {
        detached: true,
        stdio: "ignore",
        env,
      });
      child.once("error", () =>
        reject(
          new Error(
            "Cannot launch Chrome/Chromium; check your graphical session and browser profile",
          ),
        ),
      );
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }
}

export const defaultBrowserSession = new BrowserSession();
