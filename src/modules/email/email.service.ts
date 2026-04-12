import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config/env.js';

export class EmailService {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly isMockTransport: boolean;

  constructor() {
    this.from = config.smtp.from;

    const isSmtpConfigured =
      !!config.smtp.host && !!config.smtp.user && !!config.smtp.pass;

    if (isSmtpConfigured) {
      this.isMockTransport = false;
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });
    } else {
      this.isMockTransport = true;
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      console.warn('[EmailService] SMTP not configured — emails will be logged to console');
    }
  }

  async sendConfirmation(email: string, repo: string, token: string): Promise<void> {
    const confirmUrl = `${config.appBaseUrl}/confirmed.html?token=${token}`;

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: `Confirm your subscription to ${repo} releases`,
        text: `You subscribed to release notifications for ${repo}.\n\nConfirm your subscription:\n${confirmUrl}\n\nIf you did not subscribe, ignore this email.`,
        html: `
          <p>You subscribed to release notifications for <strong>${repo}</strong>.</p>
          <p><a href="${confirmUrl}">Confirm your subscription</a></p>
          <p style="color:#999;font-size:12px;">If you did not subscribe, ignore this email.</p>
        `,
      });

      if (this.isMockTransport) {
        console.log(`[EmailService] Confirmation email (mock):\n${JSON.stringify(info)}`);
      } else {
        console.log(`[EmailService] Confirmation sent to ${email}`);
      }
    } catch (err) {
      console.error(`[EmailService] Failed to send confirmation to ${email}:`, err);
      throw err;
    }
  }

  async sendReleaseNotification(
    email: string,
    repo: string,
    tag: string,
    unsubscribeToken: string,
  ): Promise<void> {
    const releaseUrl = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
    const unsubscribeUrl = `${config.appBaseUrl}/unsubscribed.html?token=${unsubscribeToken}`;

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: `New release: ${repo} ${tag}`,
        text: `New release ${tag} is available for ${repo}.\n\nView release: ${releaseUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
        html: `
          <p><strong>${repo}</strong> just published release <strong>${tag}</strong>.</p>
          <p><a href="${releaseUrl}">View release on GitHub</a></p>
          <p style="color:#999;font-size:12px;"><a href="${unsubscribeUrl}">Unsubscribe</a></p>
        `,
      });

      if (this.isMockTransport) {
        console.log(`[EmailService] Release notification email (mock):\n${JSON.stringify(info)}`);
      } else {
        console.log(`[EmailService] Release notification sent to ${email}`);
      }
    } catch (err) {
      console.error(`[EmailService] Failed to send release notification to ${email}:`, err);
      throw err;
    }
  }
}

export const emailService = new EmailService();
