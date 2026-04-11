import { config } from '../../config/env.js';
import { cacheService } from './cache.service.js';
import { githubRateLimitHitsTotal } from '../metrics/metrics.registry.js';

const GITHUB_API = 'https://api.github.com';
const REPO_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export class RateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super(`GitHub API rate limit exceeded. Retry after ${retryAfter} seconds.`);
    this.name = 'RateLimitError';
  }
}

export class GitHubClient {
  private readonly headers: Record<string, string>;

  constructor(token?: string) {
    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-release-notifier/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  validateRepoFormat(repo: string): boolean {
    return REPO_REGEX.test(repo.trim());
  }

  async checkRepoExists(repo: string): Promise<boolean> {
    const cacheKey = `repo:exists:${repo.trim()}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached === 'true';

    const response = await this.request(`/repos/${repo.trim()}`);

    if (response.status === 200) {
      await cacheService.set(cacheKey, 'true');
      return true;
    }
    if (response.status === 404) return false;
    if (response.status === 429) {
      githubRateLimitHitsTotal.inc();
      throw new RateLimitError(this.parseRetryAfter(response));
    }

    throw new Error(`GitHub API error: ${response.status}`);
  }

  async getLatestRelease(repo: string): Promise<string | null> {
    const response = await this.request(`/repos/${repo.trim()}/releases/latest`);

    if (response.status === 200) {
      const data = (await response.json()) as { tag_name: string };
      return data.tag_name;
    }

    if (response.status === 404) return null;
    if (response.status === 429) {
      githubRateLimitHitsTotal.inc();
      throw new RateLimitError(this.parseRetryAfter(response));
    }

    throw new Error(`GitHub API error: ${response.status}`);
  }

  private async request(endpoint: string): Promise<Response> {
    try {
      return await fetch(`${GITHUB_API}${endpoint}`, { headers: this.headers });
    } catch {
      throw new Error('Failed to reach GitHub API: network error');
    }
  }

  private parseRetryAfter(response: Response): number {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '', 10);
    if (!Number.isNaN(retryAfter)) return retryAfter;

    const resetAt = parseInt(response.headers.get('X-RateLimit-Reset') ?? '', 10);
    if (!Number.isNaN(resetAt)) return Math.max(0, resetAt - Math.floor(Date.now() / 1000));

    return 60;
  }
}

export const githubClient = new GitHubClient(config.githubToken);
