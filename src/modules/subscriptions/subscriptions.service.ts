import { randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { githubClient, RateLimitError, type GitHubClient } from '../github/github.client.js';
import { emailService, type EmailService } from '../email/email.service.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export interface SubscriptionDto {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class SubscriptionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly github: GitHubClient,
    private readonly email: EmailService,
  ) {}

  async subscribe(rawEmail: string, rawRepo: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const repo = rawRepo.trim();

    if (!EMAIL_REGEX.test(email)) {
      throw new ServiceError('INVALID_EMAIL', 400, 'Invalid email address');
    }

    if (!this.github.validateRepoFormat(repo)) {
      throw new ServiceError('INVALID_REPO', 400, 'Invalid repository format, expected owner/repo');
    }

    const existing = await this.db.subscription.findUnique({
      where: { email_repo: { email, repo } },
    });

    if (existing) {
      throw new ServiceError('ALREADY_EXISTS', 409, 'Email already subscribed to this repository');
    }

    let repoExists: boolean;
    try {
      repoExists = await this.github.checkRepoExists(repo);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      throw new ServiceError('GITHUB_ERROR', 503, 'Failed to verify repository');
    }

    if (!repoExists) {
      throw new ServiceError('REPO_NOT_FOUND', 404, 'Repository not found on GitHub');
    }

    const confirmToken = randomBytes(32).toString('hex');
    const unsubscribeToken = randomBytes(32).toString('hex');

    await this.db.subscription.create({
      data: { email, repo, confirmToken, unsubscribeToken },
    });

    await this.email.sendConfirmation(email, repo, confirmToken);
  }

  async confirmSubscription(token: string): Promise<void> {
    if (!TOKEN_REGEX.test(token)) {
      throw new ServiceError('INVALID_TOKEN', 400, 'Invalid token format');
    }

    const subscription = await this.db.subscription.findUnique({
      where: { confirmToken: token },
    });

    if (!subscription) {
      throw new ServiceError('NOT_FOUND', 404, 'Confirmation token not found');
    }

    await this.db.subscription.update({
      where: { id: subscription.id },
      data: { confirmed: true },
    });
  }

  async unsubscribe(token: string): Promise<void> {
    if (!TOKEN_REGEX.test(token)) {
      throw new ServiceError('INVALID_TOKEN', 400, 'Invalid token format');
    }

    const subscription = await this.db.subscription.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!subscription) {
      throw new ServiceError('NOT_FOUND', 404, 'Unsubscribe token not found');
    }

    await this.db.subscription.delete({ where: { id: subscription.id } });
  }

  async getSubscriptions(rawEmail: string): Promise<SubscriptionDto[]> {
    const email = rawEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      throw new ServiceError('INVALID_EMAIL', 400, 'Invalid email address');
    }

    const subscriptions = await this.db.subscription.findMany({
      where: { email, confirmed: true },
    });

    return subscriptions.map((sub) => ({
      email: sub.email,
      repo: sub.repo,
      confirmed: sub.confirmed,
      last_seen_tag: sub.lastSeenTag,
    }));
  }
}

export const subscriptionService = new SubscriptionService(prisma, githubClient, emailService);
