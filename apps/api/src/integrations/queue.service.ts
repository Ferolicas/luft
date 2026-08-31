import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();
  private readonly connection: { url: string };
  private readonly prefix: string;

  constructor(config: ConfigService) {
    this.connection = { url: config.getOrThrow<string>('REDIS_URL') };
    this.prefix = `${config.get<string>('REDIS_PREFIX') ?? 'luft:'}bull`;
  }

  async add(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    jobId?: string,
  ) {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.connection,
        prefix: this.prefix,
      });
      this.queues.set(queueName, queue);
    }
    return queue.add(jobName, data, {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 2_000 },
    });
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
