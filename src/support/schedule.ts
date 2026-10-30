import { DateTime } from "luxon";
import type { Config } from "../config/types/config.js";
import { weekdays } from "../config/types/schedule.js";
export class Schedule {
  constructor(private readonly config: NonNullable<Config["schedule"]>) {
    if (!DateTime.now().setZone(config.zone).isValid)
      throw new Error("Invalid schedule timezone");
    if (config.shifts.some((shift) => shift.start === shift.end))
      throw new Error("Schedule cannot have an empty window");
  }
  contains(timestamp: number): boolean {
    const local = DateTime.fromMillis(timestamp, { zone: this.config.zone });
    const minute = local.hour * 60 + local.minute;
    const parse = (v: string) =>
      Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]);
    return this.config.shifts.some((shift) => {
      const start = parse(shift.start),
        end = parse(shift.end);
      const today = weekdays[local.weekday - 1];
      if (end > start)
        return shift.day === today && minute >= start && minute < end;
      return (
        (shift.day === today && minute >= start) ||
        (shift.day === weekdays[local.minus({ days: 1 }).weekday - 1] &&
          minute < end)
      );
    });
  }
}
