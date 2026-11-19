/**
 * Server clock offset tracker (serverTimeMs - localDateNowMs) so countdowns
 * and window expiry checks remain accurate when the tablet clock is skewed.
 */

let serverClockOffsetMs = 0;
let hasServerClockSample = false;

export function recordServerTime(
  timestamp: string | null | undefined,
  localNowMs: number = Date.now(),
): number | null {
  if (typeof timestamp !== 'string') return null;
  const trimmed = timestamp.trim();
  if (!trimmed) return null;
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs) || !Number.isFinite(localNowMs)) {
    return null;
  }
  serverClockOffsetMs = parsedMs - localNowMs;
  hasServerClockSample = true;
  return serverClockOffsetMs;
}

export function recordServerTimeFromHeaders(
  headers: { get(name: string): string | null } | null | undefined,
  localNowMs: number = Date.now(),
): number | null {
  if (!headers || typeof headers.get !== 'function') {
    return null;
  }
  const dateHeader = headers.get('Date') ?? headers.get('date');
  return recordServerTime(dateHeader, localNowMs);
}

export function getServerClockOffsetMs(): number {
  return hasServerClockSample ? serverClockOffsetMs : 0;
}

export function getServerNowMs(localNowMs: number = Date.now()): number {
  return localNowMs + (hasServerClockSample ? serverClockOffsetMs : 0);
}

export function resetServerClock(): void {
  serverClockOffsetMs = 0;
  hasServerClockSample = false;
}
