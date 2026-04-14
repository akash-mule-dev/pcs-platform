import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { SeedService } from './seed/seed.service.js';

const server = express();
let isReady = false;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());

  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:4200'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();

  try {
    const seeder = app.get(SeedService);
    await seeder.seed();
  } catch (err) {
    console.warn('Seed skipped:', (err as Error).message);
  }

  isReady = true;
  console.log('NestJS bootstrap complete');
}

let bootstrapError: any = null;
const bootstrapPromise = bootstrap().catch(err => {
  bootstrapError = err;
  console.error('NestJS bootstrap failed:', err.message);
});

async function handler(req: any, res: any) {
  if (!isReady) {
    await bootstrapPromise;
  }
  if (bootstrapError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Bootstrap failed',
      message: bootstrapError.message,
      stack: bootstrapError.stack?.split('\n').slice(0, 8),
    }));
  }
  server(req, res);
}

module.exports = handler;
