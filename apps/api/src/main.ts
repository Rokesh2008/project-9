import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = new DocumentBuilder()
    .setTitle('Project 9 - Member 3 API')
    .setDescription('Integration, advisory AI, agent approval, analytics and fallback import API')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
