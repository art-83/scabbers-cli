import { z } from "zod";
export const logConnectionSchema = z.strictObject({
  profile: z
    .string()
    .regex(/^[\w.@-]+$/)
    .optional(),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
});
const group = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\/aws\/lambda\/[\w./#-]+$/);
export const logQuerySchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("list_groups"),
    prefix: group,
    nextToken: z.string().max(2048).optional(),
  }),
  z.strictObject({
    operation: z.literal("filter_events"),
    group,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    pattern: z.string().min(1).max(512),
    nextToken: z.string().max(2048).optional(),
  }),
]);
export const logGroupsPageSchema = z.object({
  logGroups: z.array(z.object({ logGroupName: z.string() })),
  nextToken: z.string().optional(),
});
export const logEventsPageSchema = z.object({
  events: z.array(
    z.object({
      timestamp: z.number(),
      logStreamName: z.string(),
      message: z.string(),
    }),
  ),
  nextToken: z.string().optional(),
});
