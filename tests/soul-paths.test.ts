import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/types/config.js";
import { soulFile } from "../src/profile/soul-file.js";

it("resolves SOUL from ordered workspace paths, creates in the first and preserves legacy settings", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-paths-"));
  try {
    const settings = join(root, "settings.json");
    const first = join(root, "first");
    const second = join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    const config = configSchema.parse({
      paths: ["first", second],
      soulFile: "old.md",
    });
    expect(soulFile(config, settings)).toBe(join(first, "SOUL.md"));
    writeFileSync(join(second, "SOUL.md"), "Second profile");
    expect(soulFile(config, settings)).toBe(join(second, "SOUL.md"));
    writeFileSync(join(first, "SOUL.md"), "First profile");
    expect(soulFile(config, settings)).toBe(join(first, "SOUL.md"));
    expect(soulFile(configSchema.parse({ soulFile: "old.md" }), settings)).toBe(
      join(root, "old.md"),
    );
    expect(configSchema.safeParse({ paths: [" "] }).success).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
