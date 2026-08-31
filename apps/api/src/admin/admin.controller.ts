import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '../generated/identity/enums';
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
