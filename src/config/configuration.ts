import { RepositoryCatalog } from "./repository-catalog.js";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configSchema, type Config } from "./types/config.js";
import type { Store } from "../storage/store.js";
import { migrateBrowser } from "./types/browser.js";
import { migrateSchedule } from "./types/schedule.js";
export function stateDirectory(): string {
  const directory = resolve(
    process.env.SCABBERS_HOME || join(homedir(), ".local/state/scabbers"),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}
export function settingsFile(): string {
  return resolve(
    process.env.SCABBERS_SETTINGS ||
      (process.env.SCABBERS_HOME
        ? join(process.env.SCABBERS_HOME, "settings.json")
        : join(
            process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
            "scabbers/settings.json",
          )),
  );
}
export class Configuration {
  constructor(
    private readonly store: Store,
    readonly path = settingsFile(),
  ) {}
  exists(): boolean {
    return existsSync(this.path);
  }
  validate(input: unknown): Config {
    const parsed = configSchema
      .strict()
      .safeParse(migrateBrowser(migrateSchedule(input)));
    if (!parsed.success)
      throw new Error(
        `Invalid settings in ${this.path}: ` +
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
      );
    const config = parsed.data;
    if (config.schedule) {
      try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: config.schedule.zone });
      } catch {
        throw new Error(
          `Invalid settings in ${this.path}: schedule.zone must be a valid timezone`,
        );
      }
    }
    return config;
  }
  get(): Config {
    if (this.exists()) {
      let input: unknown;
      try {
        input = JSON.parse(readFileSync(this.path, "utf8"));
      } catch {
        throw new Error(
          `Cannot parse ${this.path}; correct the JSON before continuing`,
        );
      }
      const config = this.validate(input);
      if (!this.store.getSetting("settings-file-migrated"))
        this.store.setSetting("settings-file-migrated", true);
      this.establishWatermark(config);
      return config;
    }
    const previous = this.store.getSetting("config");
    if (previous && !this.store.getSetting("settings-file-migrated")) {
      const config = this.save(previous);
      this.store.setSetting("settings-file-migrated", true);
      return config;
    }
    return this.validate({});
  }
  effective(): Config {
    return new RepositoryCatalog().resolve(this.get());
  }
  save(input: unknown): Config {
    const config = this.validate(input);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, this.path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    this.store.setSetting("settings-file-migrated", true);
    this.establishWatermark(config);
    return config;
  }
  private establishWatermark(config: Config): void {
    if (
      config.schedule &&
      this.store.getSetting(`slack-watermark:${config.slack.channel}`) ===
        undefined
    )
      this.store.setSetting(
        `slack-watermark:${config.slack.channel}`,
        (Date.now() / 1000).toFixed(6),
      );
  }
}
