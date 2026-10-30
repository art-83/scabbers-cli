import type { Run } from "../../workflows/types/run.js";
import type { IntegrationHealth } from "../../integrations/types/integration-health.js";
import type { BrowserDiagnostic } from "../../browser/diagnostics.js";
export type View = {
  browserDiagnostic?: BrowserDiagnostic | null;
  integrations?: IntegrationHealth[];
  settingsFile?: string;
  soulFile?: string;
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
