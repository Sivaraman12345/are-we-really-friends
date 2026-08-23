import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/**
 * Distributed Rate Limiting for A.W.R.F.
 * Uses Upstash Redis in production with automatic in-memory sliding-window fallback for local dev.
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

// ── In-Memory Fallback Store (for Local Dev) ─────────────────────────
const memoryStore = new Map<string, number[]>();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupMemoryStore(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, timestamps] of memoryStore.entries()) {
    const valid = timestamps.filter((t) => now - t < 10 * 60 * 1000);
    if (valid.length === 0) {
      memoryStore.delete(key);
    } else {
      memoryStore.set(key, valid);
    }
  }
}

function memoryRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  cleanupMemoryStore(now);

  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;

  const existing = memoryStore.get(key) || [];
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
  memoryStore.set(key, validTimestamps);

  const remaining = Math.max(0, config.limit - validTimestamps.length);
  return {
    success: true,
    limit: config.limit,
    remaining,
    resetSeconds: config.windowSeconds,
  };
}

// ── Upstash Redis Client (Production) ────────────────────────────────
let redisClient: Redis | null = null;
const limiterCache = new Map<string, Ratelimit>();

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
      return redisClient;
    } catch (err) {
      console.warn("Failed to initialize Upstash Redis, falling back to in-memory:", err);
    }
  }
  return null;
}

function getUpstashLimiter(config: RateLimitConfig): Ratelimit | null {
  const redis = getRedisClient();
  if (!redis) return null;

  const cacheKey = `${config.limit}:${config.windowSeconds}`;
  let limiter = limiterCache.get(cacheKey);

  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
      analytics: false,
      prefix: "awrf_ratelimit",
    });
    limiterCache.set(cacheKey, limiter);
  }

  return limiter;
}

/**
 * Checks and records a rate limit hit for the given key and config.
 * Uses Upstash Redis when configured, falls back to in-memory sliding window.
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const upstashLimiter = getUpstashLimiter(config);

  if (upstashLimiter) {
    try {
      const res = await upstashLimiter.limit(key);
      const now = Date.now();
      const resetSeconds = Math.max(1, Math.ceil((res.reset - now) / 1000));

      return {
        success: res.success,
        limit: res.limit,
        remaining: res.remaining,
        resetSeconds,
      };
    } catch (error) {
      console.error("Upstash rate limit call failed, falling back to memory:", error);
    }
  }

  // Development / fallback in-memory rate limiting
  return memoryRateLimit(key, config);
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
export async function checkRateLimit(
  request: Request,
  action: string,
  config: RateLimitConfig
): Promise<Response | null> {
  const ip = getClientIp(request);
  const key = `${action}:${ip}`;
  const result = await rateLimit(key, config);

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
