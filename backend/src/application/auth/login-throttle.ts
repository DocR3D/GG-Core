// src/application/auth/login-throttle.ts

/**
 * Brakes on the offline admin password (/auth/local): after `maxFailures` wrong passwords from one address within
 * `windowMs`, that address is refused until the window passes. The password is long and random, so guessing it is
 * unrealistic anyway; this keeps it so (10 tries a minute against 16 random characters).
 * The window is short on purpose: behind Docker's port forwarding every browser may show the same address (the
 * bridge gateway - checked on the dev stack), so one player typing wrong passwords would lock every admin out;
 * at worst they wait a minute. In memory: a backend restart forgets the counters, which is fine.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds before a new try is accepted, 0 when allowed. */
  retryAfterSec(address: string): number {
    const f = this.current(address);
    if (!f || f.count < this.maxFailures) return 0;
    return Math.ceil((f.since + this.windowMs - this.now()) / 1000);
  }

  failed(address: string): void {
    const f = this.current(address);
    this.failures.set(address, f ? { count: f.count + 1, since: f.since } : { count: 1, since: this.now() });
  }

  succeeded(address: string): void {
    this.failures.delete(address);
  }

  private current(address: string) {
    const f = this.failures.get(address);
    if (f && this.now() - f.since >= this.windowMs) {
      this.failures.delete(address);
      return undefined;
    }
    return f;
  }
}
