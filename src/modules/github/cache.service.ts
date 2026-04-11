import { Redis } from 'ioredis';
import { config } from '../../config/env.js';

const TTL_SECONDS = 600;

export class CacheService {
  private readonly redis: Redis | null = null;
  private redisAvailable = false;
  private readonly map = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    if (config.redisUrl) {
      try {
        this.redis = new Redis(config.redisUrl, { lazyConnect: true });
        this.redis.connect()
          .then(() => {
            this.redisAvailable = true;
          })
          .catch((err: Error) => {
            console.error('[Cache] Failed to connect to Redis, falling back to in-memory:', err.message);
          });
        this.redis.on('error', () => {
          this.redisAvailable = false;
        });
        this.redis.on('ready', () => {
          this.redisAvailable = true;
        });
      } catch (err) {
        console.error('[Cache] Failed to initialize Redis client, falling back to in-memory:', err);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis && this.redisAvailable) {
      try {
        return await this.redis.get(key);
      } catch {
        return this.getFromMap(key);
      }
    }
    return this.getFromMap(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.redis && this.redisAvailable) {
      try {
        await this.redis.set(key, value, 'EX', TTL_SECONDS);
        return;
      } catch {
        // fall through to map
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  }

  private getFromMap(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }
}

export const cacheService = new CacheService();
