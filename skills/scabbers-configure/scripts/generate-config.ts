import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--"))
    throw new Error(`Required argument: ${name}`);
  return resolve(value);
}
function rejectSecrets(value: unknown): void {
  const raw = JSON.stringify(value);
  if (
    /xox[baprs]-[\w-]+|AKIA[A-Z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[\w-]+\.[\w-]+\.[\w-]+|bearer\s+[\w.-]{20,}/i.test(
      raw,
    )
  )
    throw new Error(
      "Possible secret detected; use environment names or SSM references",
    );
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (
        /^(?:token|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)$/i.test(
          key,
        )
      )
        throw new Error(`Secret field is not allowed: ${key}`);
      visit(child);
    }
  };
  visit(value);
}
async function main(): Promise<void> {
  const project = argument("--project"),
    input = argument("--discovery"),
    output = argument("--output");
  const reportPath = output + ".discovery.json";
  if (existsSync(output) || existsSync(reportPath))
    throw new Error(
      "Output already exists; choose a new path to preserve the previous configuration",
    );
  const source = JSON.parse(readFileSync(input, "utf8"));
  rejectSecrets(source);
  if (
    !source.config ||
    typeof source.config !== "object" ||
    Array.isArray(source.config) ||
    !Array.isArray(source.evidence) ||
    !Array.isArray(source.unresolved)
  )
    throw new Error(
      "Discovery input requires config, evidence and unresolved arrays",
    );
  const modulePath = join(project, "dist/config/types/config.js");
  if (!existsSync(modulePath))
    throw new Error(
      "Compiled Scabbers schema missing; build the selected project first",
    );
  const { configSchema } = await import(pathToFileURL(modulePath).href);
  const schemaPath = join(project, "assets/settings.schema.json");
  const raw = {
    paths: [],
    ...(existsSync(schemaPath)
      ? { $schema: pathToFileURL(schemaPath).href }
      : {}),
    ...source.config,
    schedule: {
      zone: "America/Sao_Paulo",
      shifts: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
        (day) => ({ day, start: "09:00", end: "18:00" }),
      ),
      ...source.config.schedule,
    },
    remoteEnabled: false,
  };
  const parsed = configSchema.strict().safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Invalid configuration fields: " +
        parsed.error.issues
          .map(
            (issue: { path: unknown[]; message: string }) =>
              issue.path.join(".") + ": " + issue.message,
          )
          .join("; "),
    );
  const config = parsed.data;
  new Intl.DateTimeFormat("pt-BR", { timeZone: config.schedule.zone });
  rejectSecrets(config);
  const unresolved = new Set<string>(source.unresolved);
  if (!config.paths.length)
    unresolved.add(
      "paths: ask the user for one or more Arcca repository/workspace directories for SOUL.md",
    );
  if (!config.slack.user)
    unresolved.add("slack.user: verified Slack member ID required");
  if (!config.jira)
    unresolved.add(
      "jira: verified site, account identity and NOLA project required",
    );
  if (!config.gitlab)
    unresolved.add("gitlab: verified project connection required");
  if (!config.repositories.length)
    unresolved.add(
      "repositories: select web repositories with verified staging endpoints and test argv",
    );
  if (!Object.keys(config.skillPaths).length)
    unresolved.add(
      "skillPaths: required installed NOLA catalog skills not discovered",
    );
  const display = (value: string) => {
    const [hours, minutes] = value.split(":");
    const hour = Number(hours);
    return `${hour % 12 || 12}:${minutes} ${hour < 12 ? "AM" : "PM"}`;
  };
  const report = {
    generatedAt: new Date().toISOString(),
    locale: "pt-BR",
    displayTimeFormat: "h:mm A",
    scheduleDisplay: {
      zone: config.schedule.zone,
      shifts: config.schedule.shifts.map(
        (shift: { day: string; start: string; end: string }) => ({
          day: shift.day,
          start: display(shift.start),
          end: display(shift.end),
        }),
      ),
    },
    defaults: {
      schedule:
        "Monday–Friday, 9 AM–6 PM, America/Sao_Paulo unless explicitly overridden",
      workers: 3,
    },
    evidence: source.evidence,
    unresolved: [...unresolved],
    remoteEnabled: false,
  };
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, JSON.stringify(config, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    unlinkSync(output);
    throw error;
  }
  console.log(
    JSON.stringify({
      config: output,
      report: reportPath,
      remoteEnabled: false,
      unresolved: unresolved.size,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Configuration generation failed",
  );
  process.exitCode = 1;
});
