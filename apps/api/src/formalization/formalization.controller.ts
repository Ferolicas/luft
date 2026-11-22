import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '../generated/identity/enums';
import { pageOf, readBody, uploadedFileName } from '../luft/http';
import { MAX_DOCUMENT_BYTES } from '../luft/journey';
import { FormalizationService } from './formalization.service';

function sendFile(
  response: Response,
  file: { document: { mimeType: string; fileName: string }; content: Buffer },
) {
  response
    .set({
      'Content-Type': file.document.mimeType,
      'Content-Length': String(file.content.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.document.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(file.content);
}

@Controller('luft/formalization')
@UseGuards(AuthGuard)
export class FormalizationController {
  constructor(private readonly formalization: FormalizationService) {}

  @Get() overview(@CurrentUser() user: AuthenticatedUser) {
    return this.formalization.overview(user);
  }

  @Post('diagnose') diagnose(@CurrentUser() user: AuthenticatedUser) {
    return this.formalization.overview(user);
  }

  @Post('answer') answer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.formalization.answer(user, body, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Put('preparation') savePreparation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.formalization.savePreparation(user, body);
  }

  @Post('documents/:kind')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Req() request: Request,
  ) {
    const buffer = await readBody(request, MAX_DOCUMENT_BYTES);
    return this.formalization.upload(
      user,
      kind,
      uploadedFileName(request),
      buffer,
    );
  }

  @Get('documents/:id/file') async documentFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    sendFile(response, await this.formalization.documentFile(user, id));
  }

  @Delete('documents/:id') deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.formalization.deleteDocument(user, id);
  }

  @Post('submit') submit(@CurrentUser() user: AuthenticatedUser) {
    return this.formalization.submit(user);
  }
}

const REVIEWERS = [Role.LEGAL, Role.FINANCE, Role.SUPERADMIN];

@Controller('admin')
@UseGuards(AuthGuard)
@Roles(...REVIEWERS)
export class FormalizationAdminController {
  constructor(private readonly formalization: FormalizationService) {}

  @Get('formalization/cases') queue(
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.formalization.queue(pageOf(page), status);
  }

  @Get('formalization/cases/:id') detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.formalization.caseDetail(actor, id);
  }

  @Get('formalization/cases/:id/documents/:documentId/file')
  async document(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ) {
    sendFile(
      response,
      await this.formalization.staffDocument(actor, id, documentId),
    );
  }

  @Post('formalization/cases/:id/observe') observe(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.formalization.observe(actor, id, body);
  }

  @Post('formalization/cases/:id/approve') approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.formalization.approve(actor, id, body);
  }

  @Post('formalization/cases/:id/filed') markFiled(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.formalization.markFiled(actor, id, body);
  }

  @Post('formalization/cases/:id/verify') verify(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.formalization.verify(actor, id, body);
  }

  @Get('tax-rules') rules(
    @Query('page') page?: string,
    @Query('taxYear') taxYear?: string,
  ) {
    return this.formalization.rules(pageOf(page), taxYear);
  }

  @Post('tax-rules') createRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.formalization.createRule(actor, body);
  }

  @Post('tax-rules/:id/approve') approveRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.formalization.approveRule(actor, id);
  }

  @Post('tax-rules/:id/activate') activateRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.formalization.activateRule(actor, id);
  }
}
