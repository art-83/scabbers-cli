import { fileURLToPath } from "node:url";
import type { LogConnection } from "../observability/types/log-query.js";
import { logConnectionSchema } from "../observability/log-query-schema.js";
export function productionLogsServer(connection: LogConnection) {
  return {
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL("../observability/logs-server.js", import.meta.url),
      ),
      JSON.stringify(logConnectionSchema.parse(connection)),
    ],
  };
}
