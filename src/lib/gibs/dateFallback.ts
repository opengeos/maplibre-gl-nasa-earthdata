/**
 * Default-date fallback for time-enabled GIBS layers.
 *
 * GIBS sometimes advertises a default (latest) date in its WMTS capabilities
 * that has no imagery behind it: every tile at that date is a 404, so adding
 * the layer at its default date draws nothing. These helpers probe one world
 * tile at the default date and, when it is missing, step back through the
 * advertised time domain (a bounded number of steps) to the newest date with
 * imagery. A default date that works costs one tile request.
 */
import { buildTileUrl } from "./tileUrl";
import type { GibsLayer, GibsTimeDimension } from "./types";

/** How many earlier dates are probed before giving up on the fallback. */
export const DEFAULT_FALLBACK_MAX_STEPS = 3;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/;

interface TimeInterval {
  start: string;
  end: string;
  period?: { years: number; months: number; days: number };
}

function parseInterval(value: string): TimeInterval | null {
  const [start, end, period] = value.split("/");
  if (!start || !DATE_ONLY.test(start)) return null;
  if (end === undefined) return { start, end: start };
  if (!DATE_ONLY.test(end)) return null;
  const match = period ? PERIOD.exec(period) : null;
  const years = Number(match?.[1] ?? 0);
  const months = Number(match?.[2] ?? 0);
  const days = Number(match?.[3] ?? 0);
  // A zero (or unparseable) period cannot be stepped through.
  if (years + months + days === 0) return { start, end };
  return { start, end, period: { years, months, days } };
}

/**
 * Moves a date by whole periods: forward for positive `steps`, back for negative.
 */
function shiftPeriod(
  date: string,
  period: NonNullable<TimeInterval["period"]>,
  steps: number,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const years = period.years * steps;
  const months = period.months * steps;
  // Clamp the day to the target month so 2024-03-31 minus P1M is 2024-02-29,
  // not the Date.UTC rollover 2024-03-02 (a date GIBS never advertises).
  const lastDay = new Date(
    Date.UTC(year + years, month + months, 0),
  ).getUTCDate();
  const shifted = new Date(
    Date.UTC(
      year + years,
      month - 1 + months,
      Math.min(day, lastDay) + period.days * steps,
    ),
  );
  return shifted.toISOString().slice(0, 10);
}

/**
 * The newest date on an interval's period grid (its start plus whole periods)
 * that comes before `current`. The grid is anchored at the interval's start, so
 * a `current` that is not on it (a default date off the grid) does not shift
 * the dates that follow.
 */
function gridDateBefore(
  interval: TimeInterval | undefined,
  current: string,
): string | undefined {
  if (!interval?.period || interval.start >= current) return undefined;
  const { period } = interval;
  let steps = 0;
  while (shiftPeriod(interval.start, period, steps + 1) < current) steps += 1;
  return shiftPeriod(interval.start, period, steps);
}

/**
 * Lists the dates of a GIBS time domain that come before `from`, newest first.
 *
 * Each step takes the newest advertised date before the current one: a date
 * on the period grid of an interval that contains it, or the end of an
 * interval that lies wholly before it (overlapping intervals are all
 * considered). Only date-only (`YYYY-MM-DD`)
 * domains are handled; sub-daily domains return no dates.
 *
 * @param time - The layer's time dimension from the capabilities document.
 * @param from - The date to step back from (usually the default date).
 * @param count - The maximum number of dates to return.
 * @returns Up to `count` earlier dates, newest first.
 */
export function previousGibsDates(
  time: GibsTimeDimension,
  from: string,
  count: number,
): string[] {
  if (!DATE_ONLY.test(from)) return [];
  const intervals = time.values
    .map(parseInterval)
    .filter((interval): interval is TimeInterval => interval !== null);
  const dates: string[] = [];
  let current = from;
  while (dates.length < count) {
    // The newest advertised date before `current` across every interval:
    // the end of an interval that is wholly earlier, or the grid date before
    // `current` of an interval that contains it. Overlapping intervals can
    // each offer one, and the newest wins.
    let next: string | undefined;
    for (const interval of intervals) {
      const candidate =
        interval.end < current
          ? interval.end
          : interval.start <= current
            ? gridDateBefore(interval, current)
            : undefined;
      if (candidate !== undefined && (next === undefined || candidate > next)) {
        next = candidate;
      }
    }
    if (!next) break;
    dates.push(next);
    current = next;
  }
  return dates;
}

/**
 * Builds the URL of the zoom-0 tile of a GIBS layer at a date.
 *
 * @param layer - The GIBS catalog layer.
 * @param date - The ISO 8601 date to request.
 * @returns The concrete tile URL.
 */
export function gibsProbeTileUrl(layer: GibsLayer, date: string): string {
  return buildTileUrl(layer, date)
    .replace("{z}", "0")
    .replace("{y}", "0")
    .replace("{x}", "0");
}

/**
 * The fetch the tile probes use. Only the response status is read, so any
 * function that resolves to an object with a `status` works (useful in tests
 * or to route probes through an application's own HTTP client).
 */
export type ProbeFetch = (url: string) => Promise<Pick<Response, "status">>;

/**
 * Asks whether a tile is missing.
 *
 * @param fetchImpl - The fetch used for the probe.
 * @param url - The concrete tile URL.
 * @returns `true` for a missing tile (404/204), `false` for one that loaded,
 *   and `null` when the response does not say.
 */
async function tileMissing(
  fetchImpl: ProbeFetch,
  url: string,
): Promise<boolean | null> {
  try {
    const { status } = await fetchImpl(url);
    if (status === 404 || status === 204) return true;
    if (status >= 200 && status < 300) return false;
    // Any other status (a 5xx, a throttle) is not an answer about the date.
    return null;
  } catch {
    // A network failure says nothing about the date: leave it alone.
    return null;
  }
}

/**
 * Finds the date a newly added GIBS layer should show when its default date
 * has no imagery.
 *
 * @param layer - The GIBS catalog layer (must be time-enabled).
 * @param fetchImpl - The fetch used for the tile probes.
 * @param maxSteps - How many earlier dates to try.
 * @returns The newest earlier date whose world tile exists, or `null` when the
 *   default date works, the probe could not tell, or no earlier date in range
 *   has imagery.
 */
export async function findGibsFallbackDate(
  layer: GibsLayer,
  fetchImpl: ProbeFetch,
  maxSteps: number = DEFAULT_FALLBACK_MAX_STEPS,
): Promise<string | null> {
  const time = layer.time;
  if (!time || !DATE_ONLY.test(time.default)) return null;
  if (
    (await tileMissing(fetchImpl, gibsProbeTileUrl(layer, time.default))) !==
    true
  ) {
    return null;
  }
  for (const date of previousGibsDates(time, time.default, maxSteps)) {
    const missing = await tileMissing(fetchImpl, gibsProbeTileUrl(layer, date));
    if (missing === false) return date;
    if (missing === null) return null;
  }
  return null;
}

/** How long one tile probe may take, by default, before it is abandoned. */
export const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/**
 * Wraps `fetch` so each request is aborted after `timeoutMs`. An aborted probe
 * rejects, which the fallback treats as "cannot tell" and keeps the default
 * date.
 *
 * @param timeoutMs - The per-request timeout in milliseconds.
 * @param fetchImpl - The fetch to wrap (defaults to the global `fetch`).
 * @returns A {@link ProbeFetch} that aborts slow requests.
 */
export function fetchWithTimeout(
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): ProbeFetch {
  return async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
