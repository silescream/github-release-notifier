import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { githubClient, RateLimitError, type GitHubClient } from '../github/github.client.js';
import { emailService, type EmailService } from '../email/email.service.js';

const SCAN_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScannerService {
  private task: cron.ScheduledTask | null = null;
  private rateLimitedUntil = 0;
  private isRunning = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly github: GitHubClient,
    private readonly email: EmailService,
  ) {}

  start(schedule = '*/10 * * * *'): void {
    if (this.task) return;

    this.task = cron.schedule(schedule, () => {
      this.runScan().catch((err) => {
        console.error('[Scanner] Unhandled error during scan:', err);
      });
    });

    console.log(`[Scanner] Started with schedule: ${schedule}`);
  }

  stop(): void {
    if (!this.task) return;
    this.task.stop();
    this.task = null;
    console.log('[Scanner] Stopped');
  }

  async runScan(): Promise<void> {
    if (this.isRunning) {
      console.log('[Scanner] Previous scan still running, skipping');
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
      console.log(`[Scanner] Rate limited, skipping scan. Retry in ${retryInSec}s`);
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
          console.warn(
            `[Scanner] Rate limited by GitHub. Retry after ${err.retryAfter}s`,
          );
          break;
        }
        console.error(`[Scanner] Failed to fetch latest release for ${repo}:`, err);
        continue;
      }

      if (!latestTag) continue;

      const firstTimeSubs = subs.filter((s) => s.lastSeenTag === null);
      if (firstTimeSubs.length > 0) {
        try {
          await this.db.subscription.updateMany({
            where: { id: { in: firstTimeSubs.map((s) => s.id) } },
            data: { lastSeenTag: latestTag },
          });
        } catch (err) {
          console.error(`[Scanner] Failed to initialize lastSeenTag for ${repo}:`, err);
        }
      }

      for (const sub of subs.filter((s) => s.lastSeenTag !== null && s.lastSeenTag !== latestTag)) {
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
        } catch (err) {
          console.error(`[Scanner] Failed to process subscription ${sub.id} (${sub.email}):`, err);
        }
      }
    }
  }
}

export const scannerService = new ScannerService(prisma, githubClient, emailService);
