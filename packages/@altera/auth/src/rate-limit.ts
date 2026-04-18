/**
 * Very small in-process rate limiter. Sliding window (fixed-window approximation).
 * Sufficient for single-node Phase 1. Replace with Redis/SQL if scaling.
 */
export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
  }

  check(key: string, now: number = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAtMs <= now) {
      const fresh = { count: 1, resetAtMs: now + this.windowMs };
      this.buckets.set(key, fresh);
      return { allowed: true, remaining: this.max - 1, resetAtMs: fresh.resetAtMs };
    }
    bucket.count += 1;
    const allowed = bucket.count <= this.max;
    return {
      allowed,
      remaining: Math.max(0, this.max - bucket.count),
      resetAtMs: bucket.resetAtMs,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
