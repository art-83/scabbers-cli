import { createInterface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { stdin, stdout } from "node:process";
import { terminalStyle as style } from "./terminal-style.js";

export interface Choice {
  label: string;
  value: string;
}

export async function text(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(style.option(prompt));
  } finally {
    rl.close();
  }
}

export function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    return Promise.reject(new Error("Secret entry requires a terminal"));
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw,
      wasPaused = stdin.isPaused();
    stdout.write(
      `${style.title(prompt)}\n${style.muted("Input hidden · ")}${style.key("Enter")}${style.muted(" Confirm · ")}${style.key("Esc")}${style.muted(" Cancel")}\n`,
    );
    const cleanup = () => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(wasRaw);
      if (wasPaused) stdin.pause();
    };
    const onKey = (input: string, key: Key) => {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        reject(new Error("Secret entry cancelled"));
      } else if (key.name === "return") {
        cleanup();
        stdout.write(
          (value.trim()
            ? style.success("✓ Credential entered (hidden)")
            : style.muted("No credential entered")) + "\n",
        );
        resolve(value.trim());
      } else if (key.name === "backspace") value = value.slice(0, -1);
      else if (key.ctrl && key.name === "u") value = "";
      else if (
        !key.ctrl &&
        !key.meta &&
        input &&
        !/[\x00-\x1f\x7f]/.test(input) &&
        value.length + input.length <= 16000
      )
        value += input;
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on("keypress", onKey);
    stdin.resume();
  });
}

export function choose(
  prompt: string,
  choices: readonly Choice[],
  initial = choices[0]?.value,
): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    return Promise.reject(new Error("Interactive choices require a terminal"));
  if (!choices.length) return Promise.reject(new Error("No choices available"));
  return new Promise((resolve, reject) => {
    let index = Math.max(
      0,
      choices.findIndex((choice) => choice.value === initial),
    );
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    let rendered = false,
      printedRows = 0;
    const truncate = (value: string) => {
      const width = Math.max(12, (stdout.columns || 80) - 5);
      const letters = Array.from(value.replace(/[\x00-\x1f\x7f]/g, " "));
      return letters.length > width
        ? letters.slice(0, width - 1).join("") + "…"
        : letters.join("");
    };
    const draw = () => {
      if (rendered) stdout.write(`\x1b[${printedRows}A\r\x1b[J`);
      else
        stdout.write(
          `${style.title(prompt)}\n${style.key("↑/↓")}${style.muted(" Select │ ")}${style.key("Enter")}${style.muted(" Confirm │ ")}${style.key("Esc")}${style.muted(" Cancel")}\n`,
        );
      const count = Math.max(
        1,
        Math.min(choices.length, (stdout.rows || 24) - 6),
      );
      const start = Math.max(
        0,
        Math.min(choices.length - count, index - Math.floor(count / 2)),
      );
      printedRows = count;
      stdout.write(
        choices
          .slice(start, start + count)
          .map((choice, i) =>
            i + start === index
              ? style.selected(` › ${truncate(choice.label)} `) + "\n"
              : style.option(`   ${truncate(choice.label)}`) + "\n",
          )
          .join(""),
      );
      rendered = true;
    };
    const cleanup = () => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(wasRaw);
      if (wasPaused) stdin.pause();
    };
    const onKey = (_: string, key: Key) => {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        reject(new Error("Selection cancelled"));
      } else if (key.name === "return") {
        cleanup();
        stdout.write(
          `\x1b[${printedRows}A\r\x1b[J${style.success("✓ " + truncate(choices[index]!.label))}\n`,
        );
        resolve(choices[index]!.value);
      } else if (key.name === "up" || key.name === "down") {
        index =
          (index + (key.name === "up" ? -1 : 1) + choices.length) %
          choices.length;
        draw();
      }
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on("keypress", onKey);
    stdin.resume();
    draw();
  });
}
