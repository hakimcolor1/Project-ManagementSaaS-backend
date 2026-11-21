import { Redis } from "@upstash/redis";
import { env } from "../config/env.js";

/**
 * Optional Upstash Redis cache. Without the two env vars (and always in tests) every call is a
 * no-op, and a Redis error is logged and ignored: the cache can never break a request.
 */
const redis =
  env.NODE_ENV !== "test" && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export const cacheKeys = {
  projectStats: (projectId: string) => `project:${projectId}:stats`,
  adminStats: "admin:stats",
} as const;

export const CACHE_TTL = { projectStats: 5 * 60, adminStats: 60 } as const;

function warn(action: string, error: unknown): void {
  console.warn(`[cache] ${action} failed, continuing without cache:`, (error as Error).message);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    return await redis.get<T>(key);
  } catch (error) {
    warn("get", error);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    warn("set", error);
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (error) {
    warn("delete", error);
  }
}

/** Reads from the cache, or computes the value and stores it. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>) {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
