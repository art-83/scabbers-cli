import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
function argument(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0) {
    if (required) throw new Error("Required argument: " + name);
    return undefined;
  }
  if (!value || value.startsWith("--"))
    throw new Error("Required value for " + name);
  return resolve(value);
}
async function main(): Promise<void> {
  const project = argument("--project")!,
    input = argument("--input")!;
  const raw = JSON.parse(readFileSync(input, "utf8"));
  if (
    typeof raw.content !== "string" ||
    !raw.content.trim() ||
    Buffer.byteLength(raw.content) > 64000 ||
    !Array.isArray(raw.evidence) ||
    !raw.evidence.length ||
    raw.evidence.length > 20 ||
    raw.evidence.some(
      (item: any) =>
        typeof item?.source !== "string" ||
        !item.source.trim() ||
        typeof item?.excerpt !== "string" ||
        !item.excerpt.trim(),
    )
  )
    throw new Error(
      "Supply bounded SOUL content and non-empty source/excerpt evidence records",
    );
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized) > 500000)
    throw new Error("Profile input exceeds the selected evidence budget");
  if (
    /xox[baprs]-[\w-]+|AKIA[A-Z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[\w-]+\.[\w-]+\.[\w-]+|bearer\s+[\w.-]{20,}|(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*["'][^"']{6}/i.test(
      [
        raw.content,
        ...raw.evidence.flatMap((item: any) => [item.source, item.excerpt]),
        serialized,
      ].join("\n"),
    )
  )
    throw new Error(
      "Possible credential in profile input; use sanitized evidence",
    );
  if (!existsSync(join(project, "dist/profile/soul.js")))
    throw new Error(
      "Compiled Scabbers profile writer missing; build the selected project first",
    );
  const { stateDirectory } = await import(
    pathToFileURL(join(project, "dist/config/configuration.js")).href
  );
  const { Store } = await import(
    pathToFileURL(join(project, "dist/storage/store.js")).href
  );
  const { Soul } = await import(
    pathToFileURL(join(project, "dist/profile/soul.js")).href
  );
  const overrideState = argument("--state", false);
  const directory = overrideState ?? stateDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const store = new Store(join(directory, "scabbers.db"));
  try {
    const previousActive = store.getSetting("active-profile") ?? null;
    const { Configuration } = await import(
      pathToFileURL(join(project, "dist/config/configuration.js")).href
    );
    const { soulFile } = await import(
      pathToFileURL(join(project, "dist/profile/soul-file.js")).href
    );
    const configuration = new Configuration(
      store,
      ...(overrideState ? [join(directory, "settings.json")] : []),
    );
    const soul = new Soul(
      store,
      directory,
      soulFile(configuration.get(), configuration.path),
    );
    const version = soul.propose(
      raw.content,
      raw.evidence.map((item: any) => ({
        source: item.source,
        excerpt: item.excerpt,
      })),
    );
    soul.publishDraft(version, process.argv.includes("--replace"));
    const row = store.db
      .prepare("SELECT approved FROM profiles WHERE version=?")
      .get(version);
    console.log(
      JSON.stringify({
        version,
        path: soul.sourceFile,
        snapshotPath: join(directory, "profiles", version, "SOUL.md"),
        status: row.approved ? "already-approved" : "pending-review",
        activeProfile: previousActive,
      }),
    );
  } finally {
    store.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "SOUL proposal failed",
  );
  process.exitCode = 1;
});
