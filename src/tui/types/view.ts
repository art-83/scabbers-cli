import type { Run } from "../../workflows/types/run.js";
import type { IntegrationHealth } from "../../integrations/types/integration-health.js";
export type View = {
  integrations?: IntegrationHealth[];
  settingsFile?: string;
  settingsPending?: boolean;
  settingsError?: string | null;
  activation: {
    digest: string;
    schedule: unknown;
    slack: unknown;
    jira: unknown;
    repositories: unknown[];
    skills: string[];
  };
  pid: number;
  remoteEnabled: boolean;
  engine: string;
  workers: number;
  profile: string | null;
  runtimeError: string | null;
  runs: (Run & { logs: string[] })[];
  decisions: { runId: string; question: string; status: string }[];
};
