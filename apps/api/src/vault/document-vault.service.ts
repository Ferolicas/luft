import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CryptoService } from '../common/crypto.service';
import { DatabaseService } from '../database/database.service';
import { MAX_DOCUMENT_BYTES, sniffMime } from '../luft/journey';

export interface VaultDocument {
  id: string;
  purpose: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
}

/**
 * Encrypted storage for supporting files (tax returns, tax supports,
 * contribution receipts). It reuses the directory and the AES-256-GCM envelope
 * of the profile documents, so erasing an account removes these files too.
 */
@Injectable()
export class DocumentVaultService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private dir(userId: string) {
    return join(
      this.config.getOrThrow<string>('PRIVATE_STORAGE_PATH'),
      'documents',
      userId,
    );
  }

  view(document: {
    id: string;
    purpose: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: Date;
  }): VaultDocument {
    return {
      id: document.id,
      purpose: document.purpose,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      uploadedAt: document.createdAt,
    };
  }

  async store(input: {
    userId: string;
    purpose: string;
    refId?: string | null;
    fileName: string;
    buffer: Buffer;
  }) {
    const { buffer } = input;
    if (buffer.length === 0)
      throw new BadRequestException('El archivo está vacío.');
    if (buffer.length > MAX_DOCUMENT_BYTES)
      throw new PayloadTooLargeException('El archivo supera los 10 MB.');
    const mimeType = sniffMime(buffer);
    if (!mimeType)
      throw new BadRequestException('Solo aceptamos archivos PDF, JPG o PNG.');
    const id = randomUUID();
    const dir = this.dir(input.userId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, `${id}.bin`), this.crypto.encryptBuffer(buffer), {
      mode: 0o600,
    });
    return this.db.luft.userDocument.create({
      data: {
        id,
        userId: input.userId,
        purpose: input.purpose,
        refId: input.refId ?? null,
        fileName:
          input.fileName
            .replace(/[^\p{L}\p{N} ._()-]/gu, '')
            .trim()
            .slice(0, 120) || 'documento',
        mimeType,
        sizeBytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      },
    });
  }

  list(userId: string, refId: string) {
    return this.db.luft.userDocument.findMany({
      where: { userId, refId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async read(userId: string, id: string) {
    const document = await this.db.luft.userDocument.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    const encrypted = await readFile(
      join(this.dir(userId), `${document.id}.bin`),
    ).catch(() => null);
    if (!encrypted) throw new NotFoundException('Documento no encontrado.');
    return { document, content: this.crypto.decryptBuffer(encrypted) };
  }

  async remove(userId: string, id: string) {
    const document = await this.db.luft.userDocument.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await rm(join(this.dir(userId), `${document.id}.bin`), { force: true });
    await this.db.luft.userDocument.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });
    return document;
  }
}
