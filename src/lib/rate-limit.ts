/**
 * In-memory sliding-window rate limiter for early-stage Next.js runtime.
 * Designed with a clean interface that can easily be swapped with Upstash Redis / Cloudflare KV.
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

// In-memory store: key -> array of request timestamps (ms)
const requestStore = new Map<string, number[]>();

// Periodic cleanup to prevent memory unbounded growth
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleEntries(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, timestamps] of requestStore.entries()) {
    const valid = timestamps.filter((t) => now - t < 10 * 60 * 1000);
    if (valid.length === 0) {
      requestStore.delete(key);
    } else {
      requestStore.set(key, valid);
    }
  }
}

/**
 * Checks and records a rate limit hit for the given key and config.
 */
export function rateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  cleanupStaleEntries(now);

  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;

  const existing = requestStore.get(key) || [];
  const validTimestamps = existing.filter((t) => t > cutoff);

  if (validTimestamps.length >= config.limit) {
    const oldest = validTimestamps[0];
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000)
    );
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetSeconds,
    };
  }

  validTimestamps.push(now);
  requestStore.set(key, validTimestamps);

  const remaining = Math.max(0, config.limit - validTimestamps.length);
  return {
    success: true,
    limit: config.limit,
    remaining,
    resetSeconds: config.windowSeconds,
  };
}

/**
 * Extracts a client identifier (IP address) from standard proxy/CDN headers.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;

  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp.trim();

  const xRealIp = headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0];
    if (firstIp) return firstIp.trim();
  }

  return "127.0.0.1";
}

/**
 * Helper to check rate limit and return a standard HTTP 429 response if exceeded.
 */
export function checkRateLimit(
  request: Request,
  action: string,
  config: RateLimitConfig
): Response | null {
  const ip = getClientIp(request);
  const key = `${action}:${ip}`;
  const result = rateLimit(key, config);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please try again later.",
        retry_after: result.resetSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.resetSeconds),
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.resetSeconds),
        },
      }
    );
  }

  return null;
}
