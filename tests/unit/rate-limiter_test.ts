import { assertEquals } from "@std/assert";
import { SlidingWindowRateLimiter } from "../../src/shared/utils/rate-limiter.ts";

Deno.test("limiter permite até o máximo e bloqueia depois", () => {
  const now = 1_000;
  const limiter = new SlidingWindowRateLimiter(() => now);

  assertEquals(limiter.consume("ip", 3, 60_000).allowed, true);
  assertEquals(limiter.consume("ip", 3, 60_000).allowed, true);
  assertEquals(limiter.consume("ip", 3, 60_000).allowed, true);

  const blocked = limiter.consume("ip", 3, 60_000);
  assertEquals(blocked.allowed, false);
  assertEquals(blocked.remaining, 0);
  assertEquals(blocked.retryAfterSeconds, 60);
});

Deno.test("limiter libera a janela depois do tempo", () => {
  let now = 1_000;
  const limiter = new SlidingWindowRateLimiter(() => now);

  limiter.consume("ip", 1, 60_000);
  assertEquals(limiter.consume("ip", 1, 60_000).allowed, false);

  now += 60_001;
  assertEquals(limiter.consume("ip", 1, 60_000).allowed, true);
});

Deno.test("limiter isola chaves diferentes", () => {
  const limiter = new SlidingWindowRateLimiter(() => 1_000);

  assertEquals(limiter.consume("a", 1, 60_000).allowed, true);
  assertEquals(limiter.consume("b", 1, 60_000).allowed, true);
  assertEquals(limiter.consume("a", 1, 60_000).allowed, false);
});
