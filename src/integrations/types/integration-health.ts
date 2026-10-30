export type IntegrationHealth = {
  name: "Slack" | "Jira" | "GitLab";
  status: "checking" | "connected" | "disconnected";
  detail: string;
  checkedAt: number | null;
};
