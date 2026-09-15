// Simple in-memory rate limiter — per-IP fixed window
// Replace with Redis-backed limiter when scaled
const limits = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const entry = limits.get(key);
  if (!entry || now > entry.reset) {
    limits.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetMs: windowMs };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetMs: entry.reset - now };
  }
  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetMs: entry.reset - now };
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of limits.entries()) {
    if (now > v.reset) limits.delete(k);
  }
}, 60 * 1000).unref();

export function rateLimitHeaders(result: { remaining: number; resetMs: number }): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset-In": String(Math.ceil(result.resetMs / 1000)),
  };
}
