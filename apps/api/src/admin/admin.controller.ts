import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '../generated/identity/enums';
import { ZodExceptionFilter } from '../startif/zod-exception.filter';
import { AdminService } from './admin.service';

const STAFF = [
  Role.COMMERCIAL,
  Role.LEGAL,
  Role.SUPPORT,
  Role.COLLECTIONS,
  Role.RISK,
  Role.FINANCE,
  Role.SUPERADMIN,
];

@Controller('admin')
@UseGuards(AuthGuard)
@UseFilters(ZodExceptionFilter)
@Roles(...STAFF)
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('overview') overview() {
    return this.admin.overview();
  }
  @Get('users') @Roles(Role.SUPPORT, Role.RISK, Role.SUPERADMIN) users(
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.users(Number(page ?? 1), search);
  }
  @Patch('users/:id/role') @Roles(Role.SUPERADMIN) setRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.setRole(actor, id, body);
  }
  @Get('applications')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.FINANCE, Role.LEGAL, Role.SUPERADMIN)
  applications(@Query('page') page?: string, @Query('status') status?: string) {
    return this.admin.applications(Number(page ?? 1), status);
  }
  @Post('applications/:id/decision') @Roles(Role.RISK, Role.SUPERADMIN) decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.decideApplication(actor, id, body);
  }
  @Get('applications/:id/eligibility')
  @Roles(Role.RISK, Role.SUPERADMIN)
  eligibility(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.admin.applicationEligibility(actor, id);
  }
  @Get('credit-products')
  @Roles(Role.RISK, Role.FINANCE, Role.SUPERADMIN)
  creditProducts() {
    return this.admin.creditProducts();
  }
  @Post('credit-products/:code/versions')
  @Roles(Role.RISK, Role.FINANCE, Role.SUPERADMIN)
  createProductVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    return this.admin.createProductVersion(actor, code, body);
  }
  @Post('credit-products/:id/activate')
  @Roles(Role.RISK, Role.FINANCE, Role.SUPERADMIN)
  activateProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.activateProduct(actor, id, body);
  }
  @Post('credit-products/:id/suspend')
  @Roles(Role.RISK, Role.FINANCE, Role.SUPERADMIN)
  suspendProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.suspendProduct(actor, id, body);
  }
  @Get('disbursements')
  @Roles(Role.RISK, Role.FINANCE, Role.SUPERADMIN)
  disbursements(
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.admin.disbursements(Number(page ?? 1), status);
  }
  @Post('disbursements/:id/register')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  registerDisbursement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.registerDisbursement(actor, id, body);
  }
  @Post('disbursements/:id/cancel')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  cancelDisbursement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.cancelDisbursement(actor, id, body);
  }
  @Get('loans')
  @Roles(Role.RISK, Role.FINANCE, Role.COLLECTIONS, Role.SUPERADMIN)
  loans(@Query('page') page?: string, @Query('status') status?: string) {
    return this.admin.loans(Number(page ?? 1), status);
  }
  @Post('loans/:id/write-off')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  writeOffLoan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.writeOffLoan(actor, id, body);
  }
  @Post('legal/usury-rate') @Roles(Role.LEGAL, Role.RISK, Role.SUPERADMIN) rate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.admin.setUsuryRate(actor, body);
  }
  @Get('pqr')
  @Roles(Role.SUPPORT, Role.LEGAL, Role.COLLECTIONS, Role.SUPERADMIN)
  pqr(@Query('page') page?: string, @Query('status') status?: string) {
    return this.admin.pqr(Number(page ?? 1), status);
  }
  @Patch('pqr/:id')
  @Roles(Role.SUPPORT, Role.LEGAL, Role.COLLECTIONS, Role.SUPERADMIN)
  resolvePqr(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.resolvePqr(actor, id, body);
  }
  @Get('audit') @Roles(Role.LEGAL, Role.RISK, Role.SUPERADMIN) audit(
    @Query('page') page?: string,
  ) {
    return this.admin.auditLog(Number(page ?? 1));
  }
}
