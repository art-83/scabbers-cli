import type { ProfileSnapshot } from "./types/profile-snapshot.js";
import { existsSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ProfileProposal } from "./types/profile-proposal.js";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { Store } from "../storage/store.js";
export class Soul {
  constructor(
    private readonly store: Store,
    private readonly directory: string,
    readonly sourceFile = join(directory, "SOUL.md"),
  ) {}
  private readonly cache = new Map<string, string>();
  publishDraft(version: string, replace = false): void {
    const row = this.store.db
      .prepare("SELECT content FROM profiles WHERE version=?")
      .get(version);
    if (!row) throw new Error("Unknown profile proposal");
    const content = String(row.content);
    if (existsSync(this.sourceFile)) {
      const current = readFileSync(this.sourceFile, "utf8");
      if (current === content) return;
      if (!replace)
        throw new Error(
          "SOUL source file already exists; explicitly select replacement to publish this revision",
        );
      if (
        !this.store.db
          .prepare("SELECT version FROM profiles WHERE content=?")
          .get(current)
      )
        this.propose(current, [
          {
            source: this.sourceFile,
            excerpt:
              "Previous external profile preserved before an explicitly requested replacement",
          },
        ]);
    }
    mkdirSync(dirname(this.sourceFile), { recursive: true, mode: 0o700 });
    const temporary = this.sourceFile + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.sourceFile);
  }
  private loadSource(): { version: string; content: string } | undefined {
    if (!existsSync(this.sourceFile)) return undefined;
    if (lstatSync(this.sourceFile).size > 64000)
      throw new Error("SOUL source exceeds the profile input budget");
    const content = readFileSync(this.sourceFile, "utf8");
    if (!content.trim() || Buffer.byteLength(content) > 64000)
      throw new Error("SOUL source must contain bounded Markdown content");
    if (
      /xox[baprs]-[\w-]+|AKIA[A-Z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[\w-]+\.[\w-]+\.[\w-]+|bearer\s+[\w.-]{20,}|(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*["'][^"']{6}/i.test(
        content,
      )
    )
      throw new Error(
        "Possible credential in SOUL source; remove secrets before loading a profile",
      );
    const existing = this.store.db
      .prepare(
        "SELECT version FROM profiles WHERE content=? ORDER BY approved DESC,createdAt DESC LIMIT 1",
      )
      .get(content);
    const version = existing
      ? String(existing.version)
      : this.propose(content, [
          {
            source: this.sourceFile,
            excerpt:
              "External SOUL.md file snapshot; preferences do not grant permissions",
          },
        ]);
    return { version, content };
  }
  prepareSource(): string | undefined {
    return this.loadSource()?.version;
  }
  snapshotForNewRun(): ProfileSnapshot {
    const loaded = this.loadSource();
    if (!loaded)
      throw new Error(
        "SOUL source file is missing; generate it with the SOUL skill",
      );
    const row = this.store.db
      .prepare("SELECT approved FROM profiles WHERE version=?")
      .get(loaded.version);
    if (!row?.approved)
      throw new Error(
        "SOUL source has an unreviewed revision; run scabbers --review-soul before new tasks",
      );
    if (this.store.getSetting("active-profile") !== loaded.version)
      this.store.setSetting("active-profile", loaded.version);
    return { ...loaded, source: this.sourceFile };
  }
  propose(
    content: string,
    evidence: { source: string; excerpt: string }[],
  ): string {
    if (!content.trim() || !evidence.length)
      throw new Error(
        "Profile proposals require content and explicit evidence",
      );
    const version = createHash("sha256")
      .update(content + JSON.stringify(evidence))
      .digest("hex");
    if (
      this.store.db
        .prepare("SELECT version FROM profiles WHERE version=?")
        .get(version)
    )
      return version;
    this.store.db
      .prepare("INSERT OR IGNORE INTO profiles VALUES(?,?,?,?,?)")
      .run(version, content, JSON.stringify(evidence), 0, Date.now());
    const path = join(this.directory, "profiles", version);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(join(path, "SOUL.md"), content, { mode: 0o600 });
    writeFileSync(
      join(path, "manifest.json"),
      JSON.stringify(
        {
          version,
          parentVersion: this.store.getSetting("active-profile") ?? null,
          createdAt: new Date().toISOString(),
          permissionPolicy: "Preferences never grant permissions",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    writeFileSync(
      join(path, "evidence.json"),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 },
    );
    return version;
  }
  latestProposal(version?: string): ProfileProposal | undefined {
    const row = this.store.db
      .prepare(
        version
          ? "SELECT * FROM profiles WHERE approved=0 AND version=?"
          : "SELECT * FROM profiles WHERE approved=0 ORDER BY createdAt DESC,rowid DESC LIMIT 1",
      )
      .get(...(version ? [version] : []));
    return row
      ? {
          version: String(row.version),
          content: String(row.content),
          path: join(
            this.directory,
            "profiles",
            String(row.version),
            "SOUL.md",
          ),
          evidenceCount: JSON.parse(String(row.evidence)).length,
        }
      : undefined;
  }
  approve(version: string): void {
    if (
      !this.store.db
        .prepare("SELECT version FROM profiles WHERE version=?")
        .get(version)
    )
      throw new Error("Unknown profile");
    const saved = this.store.db
      .prepare("SELECT content,evidence FROM profiles WHERE version=?")
      .get(version)!;
    const path = join(this.directory, "profiles", version);
    if (
      readFileSync(join(path, "SOUL.md"), "utf8") !== saved.content ||
      JSON.stringify(
        JSON.parse(readFileSync(join(path, "evidence.json"), "utf8")),
      ) !== JSON.stringify(JSON.parse(String(saved.evidence))) ||
      JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")).version !==
        version
    )
      throw new Error(
        "Profile artifacts changed; create a new versioned proposal before approval",
      );
    this.publishDraft(version, true);
    this.store.db
      .prepare("UPDATE profiles SET approved=1 WHERE version=?")
      .run(version);
    this.store.setSetting("active-profile", version);
  }
  read(version: string): string {
    const row = this.store.db
      .prepare("SELECT content FROM profiles WHERE version=? AND approved=1")
      .get(version);
    if (!row) throw new Error("Pinned profile not approved");
    const cached = this.cache.get(version);
    if (cached !== undefined) return cached;
    const content = readFileSync(
      join(this.directory, "profiles", version, "SOUL.md"),
      "utf8",
    );
    if (content !== row.content)
      throw new Error(
        "Pinned SOUL artifact changed; refusing a silent profile update",
      );
    this.cache.set(version, content);
    return content;
  }
  sources(paths: string[]): { source: string; excerpt: string }[] {
    if (paths.length > 10)
      throw new Error("Select at most ten bounded evidence excerpts");
    let total = 0;
    return paths.map((path) => {
      const source = realpathSync(path);
      if (
        !lstatSync(source).isFile() ||
        lstatSync(source).size > 2_000_000 ||
        /(?:\.env|credentials|auth\.json|id_rsa|token)/i.test(source)
      )
        throw new Error("Select bounded, non-secret history excerpts");
      const excerpt = readFileSync(source, "utf8");
      total += Buffer.byteLength(excerpt);
      if (total > 500000)
        throw new Error(
          "Selected evidence exceeds the profile input budget; prepare smaller excerpts",
        );
      if (
        /xox[baprs]-|AKIA[A-Z0-9]{16}|BEGIN .*PRIVATE KEY|"(?:access_token|refresh_token|api_key)"/i.test(
          excerpt,
        )
      )
        throw new Error(
          "Possible credential in selected source; prepare a sanitized excerpt",
        );
      return { source, excerpt };
    });
  }
}
