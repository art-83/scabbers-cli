import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function discoverSkills(): Record<string, string> {
  const required = [
    ["nola-operations", "report-triage"],
    ["nola-engineering", "solution-analysis"],
    ["nola-engineering", "bug-reproduction"],
    ["nola-engineering", "delivery"],
    ["nola-engineering", "code-review"],
  ];
  const found: Record<string, string> = {};
  for (const [packageName, skill] of required) {
    const cached = join(homedir(), ".codex/plugins/cache/nola", packageName!);
    const versions = existsSync(cached)
      ? readdirSync(cached).sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true }),
        )
      : [];
    const paths = [
      ...versions.map((version) =>
        join(cached, version, "skills", skill!, "SKILL.md"),
      ),
      join(
        homedir(),
        ".claude/plugins/marketplaces/nola-skills/skills",
        packageName === "nola-operations" ? "operations" : "engineering",
        skill!,
        "SKILL.md",
      ),
    ];
    const path = paths.find((path) => existsSync(path));
    if (path) found[`${packageName}:${skill}`] = path;
  }
  return found;
}
