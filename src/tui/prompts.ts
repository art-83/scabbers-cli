import { createInterface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { stdin, stdout } from "node:process";

export interface Choice {
  label: string;
  value: string;
}

export async function text(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
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
    let rendered = false;
    const draw = () => {
      if (rendered) stdout.write(`\x1b[${choices.length}A\r\x1b[J`);
      else stdout.write(`${prompt}\n↑/↓ select · Enter confirm · Esc cancel\n`);
      stdout.write(
        choices
          .map((choice, i) => `${i === index ? "›" : " "} ${choice.label}\n`)
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
