import { readFileSync } from "node:fs";
import type { Config } from "./types/config.js";
export function importLegacyReferences(path: string, current: Config): Config {
  const legacy = JSON.parse(readFileSync(path, "utf8"));
  return {
    ...current,
    remoteEnabled: false,
    slack: {
      ...current.slack,
      ...(typeof legacy.owner_slack_user_id === "string"
        ? { user: legacy.owner_slack_user_id }
        : {}),
      ...(typeof legacy.slack_token_ssm_parameter === "string"
        ? { tokenParameter: legacy.slack_token_ssm_parameter }
        : {}),
    },
    aws: {
      readOnlyLogs: false,
      ...(typeof legacy.aws_profile === "string"
        ? { profile: legacy.aws_profile }
        : {}),
      ...(typeof legacy.aws_region === "string"
        ? { region: legacy.aws_region }
        : {}),
    },
    ...(typeof legacy.jev_key_ssm_parameter === "string"
      ? { jevKeyParameter: legacy.jev_key_ssm_parameter }
      : {}),
  };
}
