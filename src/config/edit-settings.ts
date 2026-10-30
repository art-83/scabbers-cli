import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Store } from "../storage/store.js";
import { choose } from "../tui/prompts.js";
import { Configuration } from "./configuration.js";

async function openEditor(path: string): Promise<void> {
  // Treat EDITOR/VISUAL as an executable, never as shell code.
  const editor = process.env.VISUAL || process.env.EDITOR || "nano";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [path], { stdio: "inherit", shell: false });
    child.on("error", () =>
      reject(
        new Error(
          "Cannot open editor. Set EDITOR to an installed editor executable.",
        ),
      ),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Editor exited without completing the edit")),
    );
  });
}

export async function editSettings(
  path: string,
  edit = openEditor,
  select = choose,
): Promise<boolean> {
  const original = readFileSync(path, "utf8");
  const directory = mkdtempSync(join(dirname(path), ".scabbers-edit-"));
  const draft = join(directory, "settings.json");
  const store = new Store(":memory:");
  try {
    writeFileSync(draft, original, { mode: 0o600 });
    for (;;) {
      await edit(draft);
      let parsed;
      try {
        parsed = new Configuration(store, draft).get();
        if (parsed.remoteEnabled && !JSON.parse(original).remoteEnabled)
          throw new Error(
            "Enable remote processing through the activation review instead",
          );
      } catch (error) {
        const retry = await select(
          error instanceof Error ? error.message : "Invalid settings",
          [
            { label: "Return to editor", value: "edit" },
            { label: "Discard changes", value: "discard" },
          ],
        );
        if (retry === "edit") continue;
        return false;
      }
      const action = await select("Valid settings. Save these changes?", [
        { label: "Save changes", value: "save" },
        { label: "Return to editor", value: "edit" },
        { label: "Discard changes", value: "discard" },
      ]);
      if (action === "edit") continue;
      if (action !== "save") return false;
      if (readFileSync(path, "utf8") !== original)
        throw new Error(
          "Settings changed outside this editor. Reopen Config to avoid overwriting newer changes.",
        );
      new Configuration(store, path).save(parsed);
      return true;
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
