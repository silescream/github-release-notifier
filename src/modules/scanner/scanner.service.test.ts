import { ScannerService } from './scanner.service.js';
import { RateLimitError, GitHubClient } from '../github/github.client.js';
import { EmailService } from '../email/email.service.js';
import { createPrismaMock } from '../../test-utils/prismaMock.js';

const makeSub = (overrides: Partial<typeof baseSub> = {}) => ({ ...baseSub, ...overrides });

const baseSub = {
  id: 'sub-1',
  email: 'test@example.com',
  repo: 'facebook/react',
  confirmed: true,
  confirmToken: 'a'.repeat(64),
  unsubscribeToken: 'b'.repeat(64),
  lastSeenTag: 'v17.0.0',
  createdAt: new Date(),
};

describe('ScannerService', () => {
  let scanner: ScannerService;
  let db: ReturnType<typeof createPrismaMock>;
  let github: jest.Mocked<GitHubClient>;
  let email: jest.Mocked<EmailService>;

  beforeEach(() => {
    db = createPrismaMock();
    github = {
      validateRepoFormat: jest.fn(),
      checkRepoExists: jest.fn(),
      getLatestRelease: jest.fn(),
    } as unknown as jest.Mocked<GitHubClient>;
    email = {
      sendConfirmation: jest.fn(),
      sendReleaseNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailService>;

    scanner = new ScannerService(db as any, github, email);
  });

  it('sends notification and updates tag when new release found', async () => {
    db.subscription.findMany.mockResolvedValue([makeSub({ lastSeenTag: 'v17.0.0' })]);
    github.getLatestRelease.mockResolvedValue('v18.0.0');
    db.subscription.update.mockResolvedValue({} as any);

    await scanner.runScan();

    expect(email.sendReleaseNotification).toHaveBeenCalledWith(
      'test@example.com',
      'facebook/react',
      'v18.0.0',
      baseSub.unsubscribeToken,
    );
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: baseSub.id },
      data: { lastSeenTag: 'v18.0.0' },
    });
  });

  it('does nothing when tag is unchanged', async () => {
    db.subscription.findMany.mockResolvedValue([makeSub({ lastSeenTag: 'v18.0.0' })]);
    github.getLatestRelease.mockResolvedValue('v18.0.0');

    await scanner.runScan();

    expect(email.sendReleaseNotification).not.toHaveBeenCalled();
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  it('sends notification when lastSeenTag is null and release exists', async () => {
    db.subscription.findMany.mockResolvedValue([makeSub({ lastSeenTag: null as unknown as string })]);
    github.getLatestRelease.mockResolvedValue('v18.0.0');
    db.subscription.update.mockResolvedValue({} as any);

    await scanner.runScan();

    expect(email.sendReleaseNotification).toHaveBeenCalledWith(
      'test@example.com',
      'facebook/react',
      'v18.0.0',
      baseSub.unsubscribeToken,
    );
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: baseSub.id },
      data: { lastSeenTag: 'v18.0.0' },
    });
  });

  it('skips repo when getLatestRelease returns null', async () => {
    db.subscription.findMany.mockResolvedValue([makeSub()]);
    github.getLatestRelease.mockResolvedValue(null);

    await scanner.runScan();

    expect(email.sendReleaseNotification).not.toHaveBeenCalled();
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  it('sets rateLimitedUntil and stops on RateLimitError, does not crash', async () => {
    db.subscription.findMany.mockResolvedValue([
      makeSub({ repo: 'facebook/react' }),
      makeSub({ id: 'sub-2', repo: 'vercel/next.js' }),
    ]);
    github.getLatestRelease.mockRejectedValue(new RateLimitError(120));

    await expect(scanner.runScan()).resolves.toBeUndefined();

    expect(email.sendReleaseNotification).not.toHaveBeenCalled();
  });

  it('skips scan when rate limited', async () => {
    db.subscription.findMany.mockResolvedValue([makeSub()]);
    github.getLatestRelease.mockRejectedValue(new RateLimitError(3600));

    await scanner.runScan();
    await scanner.runScan();

    expect(github.getLatestRelease).toHaveBeenCalledTimes(1);
  });

  it('makes one GitHub request per unique repo', async () => {
    db.subscription.findMany.mockResolvedValue([
      makeSub({ id: 'sub-1', email: 'a@example.com' }),
      makeSub({ id: 'sub-2', email: 'b@example.com' }),
    ]);
    github.getLatestRelease.mockResolvedValue('v18.0.0');
    db.subscription.update.mockResolvedValue({} as any);

    await scanner.runScan();

    expect(github.getLatestRelease).toHaveBeenCalledTimes(1);
    expect(email.sendReleaseNotification).toHaveBeenCalledTimes(2);
  });

  it('continues processing other subscriptions if one update fails', async () => {
    db.subscription.findMany.mockResolvedValue([
      makeSub({ id: 'sub-1', email: 'a@example.com', lastSeenTag: 'v17.0.0' }),
      makeSub({ id: 'sub-2', email: 'b@example.com', lastSeenTag: 'v17.0.0' }),
    ]);
    github.getLatestRelease.mockResolvedValue('v18.0.0');
    email.sendReleaseNotification
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce(undefined);
    db.subscription.update.mockResolvedValue({} as any);

    await scanner.runScan();

    expect(email.sendReleaseNotification).toHaveBeenCalledTimes(2);
    expect(db.subscription.update).toHaveBeenCalledTimes(1);
  });

  it('returns early without querying DB when no subscriptions exist', async () => {
    db.subscription.findMany.mockResolvedValue([]);

    await scanner.runScan();

    expect(github.getLatestRelease).not.toHaveBeenCalled();
  });

  it('skips second concurrent scan if first is still running', async () => {
    let resolveFirst!: () => void;
    const firstScanPending = new Promise<void>((res) => (resolveFirst = res));

    db.subscription.findMany.mockReturnValueOnce(firstScanPending.then(() => []));

    const first = scanner.runScan();
    const second = scanner.runScan();

    resolveFirst();
    await Promise.all([first, second]);

    expect(db.subscription.findMany).toHaveBeenCalledTimes(1);
  });
});
