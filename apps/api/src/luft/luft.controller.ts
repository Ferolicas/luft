import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MAX_DOCUMENT_BYTES } from './journey';
import { JourneyService } from './journey.service';
import { LuftService } from './luft.service';

/** Reads a binary request body with a hard size cap (no multipart parser needed). */
function readBody(request: Request, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new PayloadTooLargeException('El archivo supera los 10 MB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

@Controller('luft')
@UseGuards(AuthGuard)
export class LuftController {
  constructor(
    private readonly luft: LuftService,
    private readonly journey: JourneyService,
  ) {}
  @Get('dashboard') dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.luft.dashboard(user);
  }
  @Get('push/config') pushConfig() {
    return this.luft.pushConfig();
  }
  @Post('consents') consent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.luft.acceptConsent(user, body, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
  @Post('score/initial') initialScore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.requestInitialScore(user, body);
  }
  @Post('questionnaire') questionnaire(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.questionnaire(user, body);
  }
  @Post('goals') createGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.createGoal(user, body);
  }
  @Patch('goals/:id') updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.luft.updateGoal(user, id, body);
  }
  @Post('learning/complete') completeLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.luft.completeLesson(user, body);
  }
  @Post('push/subscribe')
  subscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.luft.subscribePush(user, body, request.get('user-agent'));
  }

  @Get('journey') journeySummary(@CurrentUser() user: AuthenticatedUser) {
    return this.journey.journey(user);
  }
  @Put('classification') classify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.journey.classify(user, body);
  }
  @Get('financial-profile') financialProfile(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.financialProfile(user);
  }
  @Put('financial-profile/:section') saveSection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('section') section: string,
    @Body() body: unknown,
  ) {
    return this.journey.saveSection(user, section, body);
  }
  @Post('documents/:kind')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Req() request: Request,
  ) {
    const buffer = await readBody(request, MAX_DOCUMENT_BYTES);
    let fileName = 'documento';
    try {
      fileName = decodeURIComponent(request.get('x-file-name') ?? fileName);
    } catch {
      /* se conserva el nombre genérico */
    }
    return this.journey.uploadDocument(user, kind, fileName, buffer);
  }
  @Get('documents/:id/file') async documentFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const { document, content } = await this.journey.documentFile(user, id);
    response
      .set({
        'Content-Type': document.mimeType,
        'Content-Length': String(content.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(content);
  }
  @Delete('documents/:id') deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.journey.deleteDocument(user, id);
  }
  @Put('tax-return') saveTaxAnswers(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.journey.saveTaxAnswers(user, body);
  }
  @Post('tax-return/dian-connection') connectDian(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.requestTaxService(user, 'connection');
  }
  @Post('tax-return/calculation') calculateTax(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.requestTaxService(user, 'calculation');
  }
}
