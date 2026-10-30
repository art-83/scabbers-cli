import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stateDirectory } from "../config/configuration.js";

export class CredentialStore {
  private readonly path: string;
  constructor(directory = stateDirectory()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "credentials.json");
  }
  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    const stat = lstatSync(this.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 128000 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error("Cannot read private credential storage");
    chmodSync(this.path, 0o600);
    let values;
    try {
      values = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      throw new Error("Invalid private credential storage");
    }
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.values(values).some((value) => typeof value !== "string")
    )
      throw new Error("Invalid private credential storage");
    return values;
  }
  private write(values: Record<string, string>): void {
    const temp = this.path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, JSON.stringify(values) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temp, this.path);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  get(reference: string): string {
    const value = this.read()[reference];
    if (!value)
      throw new Error(
        "Stored credential unavailable; reconnect this integration in Config",
      );
    return value;
  }
  set(value: string): string {
    const token = value.trim();
    if (!token || token.length > 16000 || /\s/.test(token))
      throw new Error("Token must be non-empty and contain no whitespace");
    const reference = "local:" + randomUUID();
    this.write({ ...this.read(), [reference]: token });
    return reference;
  }
  remove(reference: string): void {
    const values = this.read();
    delete values[reference];
    this.write(values);
  }
}
