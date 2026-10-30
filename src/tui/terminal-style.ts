import { stdout } from "node:process";
const color = (value: string, codes: string): string =>
  stdout.isTTY &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb"
    ? `\x1b[${codes}m${value}\x1b[0m`
    : value;
export const terminalStyle = {
  title: (value: string) => color(value, "1;35"),
  key: (value: string) => color(` ${value} `, "1;37;44"),
  muted: (value: string) => color(value, "2;37"),
  selected: (value: string) => color(value, "1;30;46"),
  option: (value: string) => color(value, "36"),
  success: (value: string) => color(value, "1;32"),
};
