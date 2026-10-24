import { CronExpressionParser } from "cron-parser";

/** Thrown when a cron expression or timezone can't be parsed. */
export class InvalidScheduleError extends Error {
  constructor(cronExpression: string, timezone: string, cause?: unknown) {
    super(`Invalid schedule "${cronExpression}" in timezone "${timezone}"`, { cause });
    this.name = "InvalidScheduleError";
  }
}

/**
 * Next occurrence of `cronExpression` strictly after `from`, evaluated in the owner's
 * IANA `timezone` (so "0 9 * * *" means 09:00 local time, DST included).
 */
export function computeNextRunAt(cronExpression: string, timezone: string, from: Date = new Date()): Date {
  try {
    return CronExpressionParser.parse(cronExpression, { currentDate: from, tz: timezone })
      .next()
      .toDate();
  } catch (err) {
    throw new InvalidScheduleError(cronExpression, timezone, err);
  }
}

export function isValidSchedule(cronExpression: string, timezone: string): boolean {
  try {
    computeNextRunAt(cronExpression, timezone);
    return true;
  } catch {
    return false;
  }
}

/** Thrown when a one-off is asked for a moment that has already passed. */
export class PastTimeError extends Error {
  constructor(date: string, time: string, timezone: string) {
    super(`${date} ${time} in ${timezone} has already passed`);
    this.name = "PastTimeError";
  }
}

/**
 * The instant a one-off for local `date` (YYYY-MM-DD) at `time` runs, given its yearly `cron`.
 * Throws PastTimeError if that moment has passed (the cron's next match would be next year).
 */
export function oneOffRunAt(cron: string, date: string, time: string, timezone: string, now = new Date()): Date {
  const next = computeNextRunAt(cron, timezone, now);
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(next);
  if (localDate !== date) throw new PastTimeError(date, time, timezone);
  return next;
}
