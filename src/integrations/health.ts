import { WebClient } from "@slack/web-api";
import type { Config } from "../config/types/config.js";
import type { IntegrationHealth } from "./types/integration-health.js";
import { HttpClient } from "./http-client.js";
import { Secrets } from "./secrets.js";

export function pendingHealth(): IntegrationHealth[] {
  return (["Slack", "Jira", "GitLab"] as const).map((name) => ({
    name,
    status: "checking",
    detail: "Waiting for connection check",
    checkedAt: null,
  }));
}

export async function checkIntegrations(
  config: Config,
  secrets = new Secrets(config.aws, config.credentialKeys),
): Promise<IntegrationHealth[]> {
  const check = async (
    name: IntegrationHealth["name"],
    configured: boolean,
    probe: () => Promise<void>,
  ): Promise<IntegrationHealth> => {
    if (!configured)
      return {
        name,
        status: "disconnected",
        detail: "Not configured",
        checkedAt: Date.now(),
      };
    try {
      await probe();
      return {
        name,
        status: "connected",
        detail: "Authentication and configured resource access verified",
        checkedAt: Date.now(),
      };
    } catch {
      // Never display remote error bodies, URLs, credential values or SSM output.
      return {
        name,
        status: "disconnected",
        detail:
          "Connection not verified; check credentials, network and permissions",
        checkedAt: Date.now(),
      };
    }
  };
  return Promise.all([
    check("Slack", !!config.slack.channel, async () => {
      const token = await secrets.get(
        "SCABBERS_SLACK_BOT_TOKEN",
        config.slack.tokenParameter,
      );
      const web = new WebClient(token, {
        timeout: 15000,
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
      });
      const auth = await web.auth.test();
      if (!auth.ok || auth.team?.toUpperCase() !== "ARCCA")
        throw new Error("Unexpected Slack workspace");
      const history = await web.conversations.history({
        channel: config.slack.channel,
        limit: 1,
      });
      if (!history.ok) throw new Error("Channel access unavailable");
    }),
    check("Jira", !!config.jira, async () => {
      const jira = config.jira!;
      const token = await secrets.get("SCABBERS_JIRA_TOKEN");
      const http = new HttpClient(jira.baseUrl, {
        Authorization:
          "Basic " + Buffer.from(jira.email + ":" + token).toString("base64"),
      });
      const user = await http.request("/rest/api/3/myself");
      if (!user.accountId || user.active === false)
        throw new Error("No active Jira identity");
      const project = await http.request(
        "/rest/api/3/project/" + encodeURIComponent(jira.project),
      );
      if (project.key !== jira.project)
        throw new Error("Project access unavailable");
    }),
    check("GitLab", !!config.gitlab, async () => {
      const gitlab = config.gitlab!;
      const token = await secrets.get("SCABBERS_GITLAB_TOKEN");
      const http = new HttpClient(gitlab.baseUrl, { "PRIVATE-TOKEN": token });
      const user = await http.request("/api/v4/user");
      if (!user.id || user.state !== "active")
        throw new Error("No active GitLab identity");
      const project = await http.request(
        "/api/v4/projects/" + encodeURIComponent(gitlab.projectId),
      );
      if (!project.id) throw new Error("Project access unavailable");
    }),
  ]);
}
