/**
 * A sliding-window limiter held in module memory.
 *
 * Honest about what it is: serverless instances do not share memory, so a
 * caller spread across instances gets roughly `limit × instances`. It is not a
 * security control. It exists because `/api/call` mints AssemblyAI tokens and
 * sessions bill on socket-open duration, so the failure it prevents is a
 * stranger quietly draining the demo's credits — and for that, "roughly" is
 * enough. Anything stronger needs a shared store, which this project does not
 * have and will not grow for a nine-day build.
 */
const windows = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    windows.set(key, hits);
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, retryAfterSeconds };
  }

  hits.push(now);
  windows.set(key, hits);

  // Keep the map from growing without bound across a long-lived instance.
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (v.every((t) => t <= cutoff)) windows.delete(k);
  }

  return { ok: true, retryAfterSeconds: 0 };
}

/** Test seam. Not used in the request path. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Vercel sets `x-forwarded-for`; the left-most entry is the client. Falls back
 * to a single shared bucket, which is deliberately strict rather than open: an
 * unidentifiable caller should not get an unlimited allowance.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
