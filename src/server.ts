import { buildApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './db/client.js';
import { scannerService } from './modules/scanner/scanner.service.js';
import { emailService } from './modules/email/email.service.js';
import { cacheService } from './modules/github/cache.service.js';

async function start() {
  const app = buildApp();

  cacheService.setLogger(app.log);
  emailService.setLogger(app.log);
  scannerService.setLogger(app.log);

  try {
    await prisma.$connect();

    await app.listen({
      port: config.port,
      host: config.host,
    });

    scannerService.start();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
  
    try {
      scannerService.stop();
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error({ error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start();
