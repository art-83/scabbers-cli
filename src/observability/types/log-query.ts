import type { z } from "zod";
import type {
  logConnectionSchema,
  logQuerySchema,
} from "../log-query-schema.js";
export type LogConnection = z.infer<typeof logConnectionSchema>;
export type LogQuery = z.infer<typeof logQuerySchema>;
