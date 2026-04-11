import { SubscriptionService, ServiceError } from './subscriptions.service.js';
import { RateLimitError, GitHubClient } from '../github/github.client.js';
import { EmailService } from '../email/email.service.js';
import { createPrismaMock } from '../../test-utils/prismaMock.js';

const mockSub = {
  id: 'sub-1',
  email: 'test@example.com',
  repo: 'facebook/react',
  confirmed: false,
  confirmToken: 'a'.repeat(64),
  unsubscribeToken: 'b'.repeat(64),
  lastSeenTag: null,
  createdAt: new Date(),
};

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let db: ReturnType<typeof createPrismaMock>;
  let github: jest.Mocked<GitHubClient>;
  let email: jest.Mocked<EmailService>;

  beforeEach(() => {
    db = createPrismaMock();
    github = {
      validateRepoFormat: jest.fn().mockReturnValue(true),
      checkRepoExists: jest.fn().mockResolvedValue(true),
      getLatestRelease: jest.fn(),
    } as unknown as jest.Mocked<GitHubClient>;
    email = {
      sendConfirmation: jest.fn().mockResolvedValue(undefined),
      sendReleaseNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailService>;

    service = new SubscriptionService(db as any, github, email);
  });

  describe('subscribe', () => {
    it('happy path — creates subscription and sends confirmation', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      db.subscription.create.mockResolvedValue(mockSub);

      await service.subscribe('test@example.com', 'facebook/react');

      expect(db.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'test@example.com', repo: 'facebook/react' }),
        }),
      );
      expect(email.sendConfirmation).toHaveBeenCalledWith(
        'test@example.com',
        'facebook/react',
        expect.any(String),
      );
    });

    it('normalizes email to lowercase and trims whitespace', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      db.subscription.create.mockResolvedValue(mockSub);

      await service.subscribe('  TEST@EXAMPLE.COM  ', '  facebook/react  ');

      expect(db.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'test@example.com', repo: 'facebook/react' }),
        }),
      );
    });

    it('throws 400 on invalid email', async () => {
      await expect(service.subscribe('not-an-email', 'facebook/react')).rejects.toMatchObject({
        code: 'INVALID_EMAIL',
        status: 400,
      });
    });

    it('throws 400 on invalid repo format', async () => {
      github.validateRepoFormat.mockReturnValue(false);
      await expect(service.subscribe('test@example.com', 'badformat')).rejects.toMatchObject({
        code: 'INVALID_REPO',
        status: 400,
      });
    });

    it('throws 409 on duplicate subscription', async () => {
      db.subscription.findUnique.mockResolvedValue(mockSub);
      await expect(service.subscribe('test@example.com', 'facebook/react')).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
        status: 409,
      });
    });

    it('throws 404 when repo not found on GitHub', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      github.checkRepoExists.mockResolvedValue(false);

      await expect(service.subscribe('test@example.com', 'owner/missing')).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404,
      });
    });

    it('rethrows RateLimitError from GitHub', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      github.checkRepoExists.mockRejectedValue(new RateLimitError(30));

      await expect(service.subscribe('test@example.com', 'facebook/react')).rejects.toBeInstanceOf(
        RateLimitError,
      );
    });

    it('rolls back subscription if email fails to send', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      db.subscription.create.mockResolvedValue(mockSub);
      email.sendConfirmation.mockRejectedValue(new Error('SMTP down'));

      await expect(service.subscribe('test@example.com', 'facebook/react')).rejects.toMatchObject({
        code: 'EMAIL_ERROR',
        status: 503,
      });

      expect(db.subscription.delete).toHaveBeenCalledWith({ where: { id: mockSub.id } });
    });
  });

  describe('confirmSubscription', () => {
    const validToken = 'a'.repeat(64);

    it('sets confirmed=true for valid token', async () => {
      db.subscription.findUnique.mockResolvedValue(mockSub);

      await service.confirmSubscription(validToken);

      expect(db.subscription.update).toHaveBeenCalledWith({
        where: { id: mockSub.id },
        data: { confirmed: true },
      });
    });

    it('throws 400 on invalid token format', async () => {
      await expect(service.confirmSubscription('short')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
        status: 400,
      });
    });

    it('throws 404 when token not found', async () => {
      db.subscription.findUnique.mockResolvedValue(null);

      await expect(service.confirmSubscription(validToken)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('unsubscribe', () => {
    const validToken = 'b'.repeat(64);

    it('deletes subscription for valid token', async () => {
      db.subscription.findUnique.mockResolvedValue(mockSub);

      await service.unsubscribe(validToken);

      expect(db.subscription.delete).toHaveBeenCalledWith({ where: { id: mockSub.id } });
    });

    it('throws 400 on invalid token format', async () => {
      await expect(service.unsubscribe('toolshort')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
        status: 400,
      });
    });

    it('throws 404 when token not found', async () => {
      db.subscription.findUnique.mockResolvedValue(null);

      await expect(service.unsubscribe(validToken)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('getSubscriptions', () => {
    it('returns DTO list for confirmed subscriptions', async () => {
      db.subscription.findMany.mockResolvedValue([
        { ...mockSub, confirmed: true, lastSeenTag: 'v1.0.0' },
      ]);

      const result = await service.getSubscriptions('test@example.com');

      expect(result).toEqual([
        {
          email: 'test@example.com',
          repo: 'facebook/react',
          confirmed: true,
          last_seen_tag: 'v1.0.0',
        },
      ]);
    });

    it('throws 400 on invalid email', async () => {
      await expect(service.getSubscriptions('bad')).rejects.toMatchObject({
        code: 'INVALID_EMAIL',
        status: 400,
      });
    });
  });
});
