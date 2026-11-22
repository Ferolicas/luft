import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '../generated/identity/enums';
import { pageOf, STAFF_ROLES } from '../luft/http';
import { CatalogService } from './catalog.service';

@Controller('luft')
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') categories() {
    return this.catalog.activeCategories();
  }

  @Get('plans') plans() {
    return this.catalog.plans();
  }
}

@Controller('admin')
@UseGuards(AuthGuard)
@Roles(...STAFF_ROLES)
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') categories(@Query('page') page?: string) {
    return this.catalog.adminCategories(pageOf(page));
  }

  @Post('categories')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.SUPERADMIN)
  createCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.catalog.createCategory(actor, body);
  }

  @Patch('categories/:id')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.SUPERADMIN)
  updateCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateCategory(actor, id, body);
  }

  @Delete('categories/:id')
  @Roles(Role.SUPERADMIN)
  deleteCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.catalog.deleteCategory(actor, id);
  }

  @Get('archetypes/facts') facts() {
    return this.catalog.factCatalog();
  }

  @Get('archetypes') archetypes(
    @Query('page') page?: string,
    @Query('categoryCode') categoryCode?: string,
    @Query('history') history?: string,
  ) {
    return this.catalog.adminArchetypes(
      pageOf(page),
      categoryCode,
      history === 'true',
    );
  }

  @Post('archetypes')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.SUPERADMIN)
  createArchetype(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.catalog.createArchetype(actor, body);
  }

  @Put('archetypes/:id')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.SUPERADMIN)
  publishArchetype(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.publishArchetypeVersion(actor, id, body);
  }

  @Post('archetypes/:id/deactivate')
  @Roles(Role.COMMERCIAL, Role.RISK, Role.SUPERADMIN)
  deactivateArchetype(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.catalog.deactivateArchetype(actor, id);
  }

  @Get('plans') plans(@Query('page') page?: string) {
    return this.catalog.adminPlans(pageOf(page));
  }

  @Patch('plans/:code')
  @Roles(Role.COMMERCIAL, Role.FINANCE, Role.SUPERADMIN)
  updatePlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updatePlan(actor, code, body);
  }
}
