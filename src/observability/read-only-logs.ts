import { ProcessRunner } from "../runtime/process-runner.js";
import { redactLog } from "../logging/log-redactor.js";
import {
  logConnectionSchema,
  logQuerySchema,
  logGroupsPageSchema,
  logEventsPageSchema,
} from "./log-query-schema.js";
import type { LogConnection, LogQuery } from "./types/log-query.js";

export class ReadOnlyLogs {
  private readonly connection: LogConnection;
  private requests = 0;
  constructor(
    connection: LogConnection,
    private readonly runner = new ProcessRunner(),
  ) {
    this.connection = logConnectionSchema.parse(connection);
  }
  async query(input: LogQuery, signal?: AbortSignal): Promise<unknown> {
    const query = logQuerySchema.parse(input);
    if (++this.requests > 20)
      throw new Error("Read-only log query budget exceeded for this stage");
    const args =
      query.operation === "list_groups"
        ? [
            "logs",
            "describe-log-groups",
            "--log-group-name-prefix",
            query.prefix,
            "--limit",
            "20",
          ]
        : [
            "logs",
            "filter-log-events",
            "--log-group-name",
            query.group,
            "--start-time",
            String(query.start),
            "--end-time",
            String(query.end),
            "--filter-pattern=" + query.pattern,
            "--limit",
            "100",
          ];
    if (
      query.operation === "filter_events" &&
      (query.end <= query.start || query.end - query.start > 86400000)
    )
      throw new Error(
        "Log queries require an explicit time window of at most 24 hours",
      );
    if (query.nextToken) args.push("--next-token=" + query.nextToken);
    args.push(
      "--region",
      this.connection.region,
      "--output",
      "json",
      "--no-cli-pager",
      "--no-paginate",
    );
    if (this.connection.profile)
      args.push("--profile=" + this.connection.profile);
    const result = await this.runner.run(
      "aws",
      args,
      process.cwd(),
      "",
      () => {},
      signal,
      30000,
      undefined,
      { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
    );
    if (result.code)
      throw new Error(
        "Read-only CloudWatch query failed; check the configured AWS session and logs read permissions. No production changes were attempted.",
      );
    if (query.operation === "list_groups") {
      const data = logGroupsPageSchema.parse(JSON.parse(result.stdout));
      return {
        groups: data.logGroups.map((g) => ({ name: g.logGroupName })),
        nextToken: data.nextToken ?? null,
        complete: !data.nextToken,
      };
    }
    const data = logEventsPageSchema.parse(JSON.parse(result.stdout));
    const output = {
      events: data.events.map((e) => ({
        at: e.timestamp,
        stream: e.logStreamName,
        message: redactLog(e.message).slice(0, 2000),
        truncated: e.message.length > 2000,
      })),
      nextToken: data.nextToken ?? null,
      complete: !data.nextToken,
    };
    if (Buffer.byteLength(JSON.stringify(output)) > 24000)
      throw new Error(
        "Log evidence exceeds 24 KB; narrow the incident window or filter and repeat the read-only query",
      );
    return output;
  }
}
