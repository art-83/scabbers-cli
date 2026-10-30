import { z } from "zod";

export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z.strictObject({
  zone: z.string(),
  shifts: z
    .array(
      z
        .strictObject({
          day: z.enum(weekdays),
          start: time,
          end: time,
        })
        .refine((shift) => shift.start !== shift.end, {
          message: "Support start/end must differ",
          path: ["end"],
        }),
    )
    .min(1),
});

const legacySchedule = z.strictObject({
  zone: z.string(),
  days: z.array(z.number().int().min(1).max(7)).min(1),
  start: time,
  end: time,
});

/** Preserve existing intervals when reading settings from earlier releases. */
export function migrateSchedule(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const config = input as Record<string, unknown>;
  const parsed = legacySchedule.safeParse(config.schedule);
  if (!parsed.success) return input;
  const { zone, days, start, end } = parsed.data;
  return {
    ...config,
    schedule: {
      zone,
      shifts: days.map((day) => ({ day: weekdays[day - 1], start, end })),
    },
  };
}
