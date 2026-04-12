import { buildApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './db/client.js';
import { scannerService } from './modules/scanner/scanner.service.js';

async function start() {
  const app = buildApp();

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
    scannerService.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
