import { dirname, join, resolve } from "node:path";
import {
  TextLog,
  redactLog,
  LogRedactor,
  LOG_RETENTION_DAYS,
} from "../logging/text-log.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Run, RunKind } from "../workflows/types/run.js";
export class Store {
  readonly db: DatabaseSync;
  readonly textLog: TextLog | undefined;
  loggingError: string | null = null;
  private lastLogCleanup = 0;
  private readonly logRedactor = new LogRedactor();
  constructor(path: string) {
    this.textLog =
      path === ":memory:"
        ? undefined
        : new TextLog(join(dirname(resolve(path)), "logs"));
    this.db = new DatabaseSync(path);
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > 1) {
      this.db.close();
      throw new Error(
        "Unsupported database schema version; explicit migration required",
      );
    }
    if (
      version === 0 &&
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all().length
    ) {
      this.db.close();
      throw new Error(
        "Unrecognized existing database; legacy state is never migrated implicitly",
      );
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', engine TEXT NOT NULL, sessionId TEXT,profileVersion TEXT NOT NULL,snapshot TEXT,data TEXT NOT NULL,error TEXT,paused INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,UNIQUE(kind,source));
   CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,runId TEXT,at INTEGER NOT NULL,message TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS locks(resource TEXT PRIMARY KEY,owner TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS effects(key TEXT PRIMARY KEY,runId TEXT NOT NULL,status TEXT NOT NULL,result TEXT);
   CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,runId TEXT NOT NULL,userId TEXT NOT NULL,channel TEXT,thread TEXT,question TEXT NOT NULL,options TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',answer TEXT,createdAt INTEGER NOT NULL,nextReminder INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
   CREATE UNIQUE INDEX IF NOT EXISTS pending_decision ON decisions(runId) WHERE status='pending';
   CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,decisionId TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS profiles(version TEXT PRIMARY KEY,content TEXT NOT NULL,evidence TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL);
   PRAGMA user_version=1;`);
    this.cleanLogs();
  }
  private cleanLogs(): void {
    const now = Date.now();
    if (now - this.lastLogCleanup < 3600000) return;
    this.db
      .prepare("DELETE FROM logs WHERE at < ?")
      .run(now - LOG_RETENTION_DAYS * 86400000);
    try {
      this.textLog?.cleanup();
      this.loggingError = null;
    } catch {
      this.loggingError =
        "Cannot maintain text logs; check state directory permissions and free disk space";
    }
    this.lastLogCleanup = now;
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  getSetting(key: string): unknown {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  create(
    kind: RunKind,
    source: string,
    engine: Run["engine"],
    profileVersion: string,
    data: Record<string, unknown>,
  ): Run {
    const now = Date.now();
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO runs(id,kind,source,engine,profileVersion,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        kind,
        source,
        engine,
        profileVersion,
        JSON.stringify(data),
        now,
        now,
      );
    const run = this.list().find(
      (r) => r.kind === kind && r.source === source,
    )!;
    if (inserted.changes)
      this.log(run.id, `Created ${kind} execution from ${source}`);
    return run;
  }
  list(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs ORDER BY createdAt,id")
      .all()
      .map((row) => ({ ...row, data: JSON.parse(String(row.data)) }) as Run);
  }
  get(id: string): Run {
    const run = this.list().find((r) => r.id === id);
    if (!run) throw new Error("Run not found");
    return run;
  }
  save(run: Run): void {
    const current = this.db
      .prepare("SELECT state FROM runs WHERE id=?")
      .get(run.id);
    if (current?.state === "cancelled" && run.state !== "cancelled") return;
    this.db
      .prepare(
        "UPDATE runs SET state=?,sessionId=?,snapshot=?,data=?,error=?,updatedAt=? WHERE id=?",
      )
      .run(
        run.state,
        run.sessionId,
        run.snapshot,
        JSON.stringify(run.data),
        run.error,
        Date.now(),
        run.id,
      );
  }
  log(id: string | null, message: string): void {
    this.cleanLogs();
    const redacted = this.logRedactor.redact(message, id ?? "runtime");
    const safe =
      redacted.length > 16000
        ? redacted.slice(0, 15900) + "\n[message truncated]"
        : redacted;
    this.db
      .prepare("INSERT INTO logs(runId,at,message) VALUES(?,?,?)")
      .run(id, Date.now(), safe);
    try {
      this.textLog?.write(safe, id);
      this.loggingError = null;
    } catch {
      this.loggingError =
        "Cannot write text logs; SQLite logs remain available. Check permissions and free disk space";
    }
  }
  logs(id: string | null, limit = 12): string[] {
    return this.db
      .prepare(
        "SELECT message FROM logs WHERE runId IS ? ORDER BY id DESC LIMIT ?",
      )
      .all(id, limit)
      .reverse()
      .map((r) => redactLog(String(r.message)));
  }
  acquire(resource: string, owner: string): boolean {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO locks VALUES(?,?)")
        .run(resource, owner).changes === 1
    );
  }
  release(owner: string): void {
    this.db.prepare("DELETE FROM locks WHERE owner=?").run(owner);
  }
  close(): void {
    this.db.close();
  }
}
