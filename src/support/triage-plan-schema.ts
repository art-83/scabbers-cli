import { z } from "zod";
export const triagePlanSchema = z.object({
  reportKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/),
  type: z.enum([
    "Bug",
    "Bug Crítico",
    "Ticket",
    "duplicate",
    "cancel",
    "product",
    "insufficient",
  ]),
  destinationKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9]+-\d+$/)
    .optional(),
  cancellationReason: z.string().optional(),
  summary: z.string().min(1),
  description: z.string().min(30),
  evidence: z.array(z.string()).min(1),
  ambiguous: z.literal(false),
});
