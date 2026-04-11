import { GitHubClient, RateLimitError } from './github.client.js';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return {
    status,
    json: async () => body,
    headers: {
      get: (key: string) => headers[key] ?? null,
    },
  } as unknown as Response;
}

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient();
  });

  describe('validateRepoFormat', () => {
    it('accepts valid owner/repo', () => {
      expect(client.validateRepoFormat('facebook/react')).toBe(true);
      expect(client.validateRepoFormat('my-org/my.repo_123')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(client.validateRepoFormat('nodotslash')).toBe(false);
      expect(client.validateRepoFormat('/repo')).toBe(false);
      expect(client.validateRepoFormat('owner/')).toBe(false);
      expect(client.validateRepoFormat('')).toBe(false);
    });

    it('trims whitespace before validating', () => {
      expect(client.validateRepoFormat('  facebook/react  ')).toBe(true);
    });
  });

  describe('checkRepoExists', () => {
    it('returns true on 200', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200));
      await expect(client.checkRepoExists('facebook/react')).resolves.toBe(true);
    });

    it('returns false on 404', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(404));
      await expect(client.checkRepoExists('owner/nonexistent')).resolves.toBe(false);
    });

    it('throws RateLimitError on 429 with Retry-After header', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(429, undefined, { 'Retry-After': '30' }));

      await expect(client.checkRepoExists('facebook/react')).rejects.toBeInstanceOf(RateLimitError);
    });

    it('sets correct retryAfter from Retry-After header', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(429, undefined, { 'Retry-After': '45' }));

      try {
        await client.checkRepoExists('facebook/react');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfter).toBe(45);
      }
    });

    it('throws generic error on unexpected status', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(500));
      await expect(client.checkRepoExists('facebook/react')).rejects.toThrow('GitHub API error: 500');
    });
  });

  describe('getLatestRelease', () => {
    it('returns tag_name on 200', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, { tag_name: 'v18.0.0' }));
      await expect(client.getLatestRelease('facebook/react')).resolves.toBe('v18.0.0');
    });

    it('returns null on 404', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(404));
      await expect(client.getLatestRelease('owner/no-releases')).resolves.toBeNull();
    });

    it('throws RateLimitError on 429', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(429, undefined, { 'Retry-After': '60' }));
      await expect(client.getLatestRelease('facebook/react')).rejects.toBeInstanceOf(RateLimitError);
    });
  });
});
