/**
 * "Last played …" in words, in the roughest honest unit.
 *
 * Its own file because two screens now say it about the same fact: the
 * menu's RESUME button, and every occupied row of the slot picker. One
 * copy means the menu and the slot list can never describe the same save
 * differently.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Calendar-rough on purpose: the line answers "is this the game I remember", not "when exactly". */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * "just now", "3 minutes ago", "yesterday", "2 weeks ago". A stamp in the
 * future (a phone whose clock was set back) reads as "just now" rather
 * than as a negative number, and a stamp that does not parse reads as
 * "some time ago": the save is still real, only its clock is not, and
 * inventing a time for it would not be.
 */
export function timeAgo(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'some time ago';
  const ago = nowMs - then;
  if (ago < MINUTE_MS) return 'just now';
  if (ago < HOUR_MS) return plural(Math.floor(ago / MINUTE_MS), 'minute');
  if (ago < DAY_MS) return plural(Math.floor(ago / HOUR_MS), 'hour');
  if (ago < 2 * DAY_MS) return 'yesterday';
  if (ago < 7 * DAY_MS) return plural(Math.floor(ago / DAY_MS), 'day');
  if (ago < MONTH_MS) return plural(Math.floor(ago / (7 * DAY_MS)), 'week');
  if (ago < YEAR_MS) return plural(Math.floor(ago / MONTH_MS), 'month');
  return plural(Math.floor(ago / YEAR_MS), 'year');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
