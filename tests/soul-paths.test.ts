import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/types/config.js";
import { soulFile } from "../src/profile/soul-file.js";
import { Store } from "../src/storage/store.js";

it("resolves personal SOUL beside selected settings regardless of workspace profiles, preserving explicit overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-paths-"));
  try {
    const settings = join(root, "settings.json");
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    writeFileSync(
      join(workspace, "SOUL.md"),
      "Workspace profile must not be selected",
    );
    const config = configSchema.parse({ paths: [workspace] });
    expect(soulFile(config, settings)).toBe(join(root, "SOUL.md"));
    expect(
      soulFile({ ...config, soulFile: "custom/profile.md" }, settings),
    ).toBe(join(root, "custom/profile.md"));
    expect(
      soulFile(
        { ...config, soulFile: join(workspace, "explicit.md") },
        settings,
      ),
    ).toBe(join(workspace, "explicit.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("the actual skill writer creates a private configuration SOUL without changing workspace files or activating its proposal", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-soul-writer-"));
  try {
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "SOUL.md"), "Existing project profile");
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ paths: [workspace] }),
    );
    const content = "# Personal profile\nPrefer concise explanations.\n";
    const input = join(root, "input.json");
    writeFileSync(
      input,
      JSON.stringify({
        content,
        evidence: [
          {
            source: "selected user note",
            excerpt: "Prefer concise explanations",
          },
        ],
      }),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "skills/scabbers-soul/scripts/propose-soul.ts",
          "--project",
          process.cwd(),
          "--state",
          root,
          "--input",
          input,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(result.path).toBe(join(root, "SOUL.md"));
    expect(readFileSync(result.path, "utf8")).toBe(content);
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(workspace, "SOUL.md"), "utf8")).toBe(
      "Existing project profile",
    );
    const store = new Store(join(root, "scabbers.db"));
    try {
      expect(store.getSetting("active-profile")).toBeUndefined();
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
