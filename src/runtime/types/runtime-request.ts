import type { z } from "zod";
import type { requestSchema } from "../protocol.js";
export type RuntimeRequest = z.infer<typeof requestSchema>;
