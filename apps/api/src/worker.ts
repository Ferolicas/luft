import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const context = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  context.enableShutdownHooks();
  Logger.log('LUFT worker activo', 'Worker');
}

void bootstrap();
