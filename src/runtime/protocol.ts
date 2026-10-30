import { z } from "zod";
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.enum(["pause", "resume", "cancel"]),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("stop"),
    pid: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("activate"), digest: z.string().length(64) }),
]);
