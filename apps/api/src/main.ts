import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', 1);
  express.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  app.setGlobalPrefix('api');
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );
  app.use(cookieParser(config.getOrThrow<string>('COOKIE_SECRET')));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();
  const redisAdapter = new RedisIoAdapter(
    app,
    config.getOrThrow<string>('REDIS_URL'),
  );
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);
  const port =
    config.get<number>('API_PORT') ?? Number(process.env.PORT ?? 4003);
  await app.listen(port, '127.0.0.1');
  Logger.log(`LUFT API escuchando en ${port}`, 'Bootstrap');
}

void bootstrap();
