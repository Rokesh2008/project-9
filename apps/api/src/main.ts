import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { readFileSync } from 'node:fs';
import { securityMiddleware, loginAccountLimiter, SafeExceptionFilter, validateProductionConfiguration } from './security/http-security';
import { DistributedRateLimiter } from './security/distributed-rate-limiter';
import { PrismaService } from './common/prisma.service';

async function bootstrap() {
  validateProductionConfiguration();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const express = require('express') as typeof import('express');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // Cloud Run adds the final trusted proxy hop; local/direct requests trust no proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.K_SERVICE ? 1 : false);
  const distributed = process.env.HORIZONTAL_STATE === 'true';
  const limiter = distributed ? new DistributedRateLimiter(app.get(PrismaService), process.env.AUTH_TOKEN_SECRET ?? '') : undefined;
  app.use(securityMiddleware(process.env, distributed));
  if (limiter) app.use(limiter.middleware());
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',').map(s => s.trim()) ?? ['http://localhost:5173'], exposedHeaders: ['X-Request-ID', 'Retry-After'], maxAge: 600 });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(limiter ? limiter.middleware(true) : loginAccountLimiter());
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = new DocumentBuilder()
    .setTitle('Project 9 - Member 3 API')
    .setDescription('Integration, advisory AI, agent approval, analytics and fallback import API')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency')
    .addApiKey({ type: 'apiKey', name: 'x-integration-api-key', in: 'header' }, 'integration-key')
    .build();
  // Explicit references let serverless file tracing include Swagger's assets.
  // Register these before Swagger's static middleware, whose directory is dynamic.
  const swaggerAssets = [
    ['/api/docs/swagger-ui-bundle.js', 'application/javascript', require.resolve('swagger-ui-dist/swagger-ui-bundle.js')],
    ['/api/docs/swagger-ui-standalone-preset.js', 'application/javascript', require.resolve('swagger-ui-dist/swagger-ui-standalone-preset.js')],
    ['/api/docs/swagger-ui.css', 'text/css', require.resolve('swagger-ui-dist/swagger-ui.css')],
  ];
  for (const [path, contentType, file] of swaggerAssets) {
    app.getHttpAdapter().get(path, (_req: unknown, res: any) => {
      res.type(contentType).send(readFileSync(file));
    });
  }
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0');
}

void bootstrap();
