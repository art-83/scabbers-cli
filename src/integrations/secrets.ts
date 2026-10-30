import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config/types/config.js";
export class Secrets {
  constructor(private readonly aws: Config["aws"]) {}
  async get(environment: string, parameter?: string): Promise<string> {
    const value = process.env[environment]?.trim();
    if (value) return value;
    if (!parameter)
      throw new Error(
        `Missing ${environment}; configure environment or an SSM reference. Never send credentials through Slack.`,
      );
    const args = [
      "ssm",
      "get-parameter",
      "--name",
      parameter,
      "--with-decryption",
      "--query",
      "Parameter.Value",
      "--output",
      "text",
    ];
    if (this.aws.profile) args.push("--profile", this.aws.profile);
    if (this.aws.region) args.push("--region", this.aws.region);
    try {
      const { stdout } = await promisify(execFile)("aws", args, {
        timeout: 30_000,
        maxBuffer: 32_000,
      });
      if (!stdout.trim() || stdout.trim() === "None") throw 0;
      return stdout.trim();
    } catch {
      throw new Error(
        `Cannot read configured SSM reference for ${environment}; check AWS session and permissions`,
      );
    }
  }
}
