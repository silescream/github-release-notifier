import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { githubClient, RateLimitError, type GitHubClient } from '../github/github.client.js';
import { emailService, type EmailService } from '../email/email.service.js';
import { scannerNotificationsTotal } from '../metrics/metrics.registry.js';
import type { ServiceLogger } from '../../types.js';

const SCAN_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScannerService {
  private task: cron.ScheduledTask | null = null;
  private rateLimitedUntil = 0;
  private isRunning = false;
  private logger: ServiceLogger = console;

  constructor(
    private readonly db: PrismaClient,
    private readonly github: GitHubClient,
    private readonly email: EmailService,
  ) {}

  setLogger(logger: ServiceLogger): void {
    this.logger = logger;
  }

  start(schedule = '*/10 * * * *'): void {
    if (this.task) return;

    this.task = cron.schedule(schedule, () => {
      this.runScan().catch((err) => {
        this.logger.error('[Scanner] Unhandled error during scan:', err);
      });
    });

    this.logger.info(`[Scanner] Started with schedule: ${schedule}`);
  }

  stop(): void {
    if (!this.task) return;
    this.task.stop();
    this.task = null;
    this.logger.info('[Scanner] Stopped');
  }

  async runScan(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('[Scanner] Previous scan still running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      await this.scan();
    } finally {
      this.isRunning = false;
    }
  }

  private async scan(): Promise<void> {
    if (Date.now() < this.rateLimitedUntil) {
      const retryInSec = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
      this.logger.info(`[Scanner] Rate limited, skipping scan. Retry in ${retryInSec}s`);
      return;
    }

    const subscriptions = await this.db.subscription.findMany({
      where: { confirmed: true },
    });

    if (subscriptions.length === 0) return;

    const byRepo = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const group = byRepo.get(sub.repo) ?? [];
      group.push(sub);
      byRepo.set(sub.repo, group);
    }

    let first = true;
    for (const [repo, subs] of byRepo) {
      if (!first) await sleep(SCAN_DELAY_MS);
      first = false;

      let latestTag: string | null;
      try {
        latestTag = await this.github.getLatestRelease(repo);
      } catch (err) {
        if (err instanceof RateLimitError) {
          this.rateLimitedUntil = Date.now() + err.retryAfter * 1000;
          this.logger.warn(`[Scanner] Rate limited by GitHub. Retry after ${err.retryAfter}s`);
          break;
        }
        this.logger.error(`[Scanner] Failed to fetch latest release for ${repo}:`, err);
        continue;
      }

      if (!latestTag) continue;

      for (const sub of subs.filter((s) => s.lastSeenTag !== latestTag)) {
        try {
          await this.email.sendReleaseNotification(
            sub.email,
            repo,
            latestTag,
            sub.unsubscribeToken,
          );

          await this.db.subscription.update({
            where: { id: sub.id },
            data: { lastSeenTag: latestTag },
          });

          scannerNotificationsTotal.inc();
        } catch (err) {
          this.logger.error(`[Scanner] Failed to process subscription ${sub.id} (${sub.email}):`, err);
        }
      }
    }
  }
}

export const scannerService = new ScannerService(prisma, githubClient, emailService);
