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
import { PartnerService } from './partner.service';
import { PolicyService } from './policy.service';
import { PresentationService } from './presentation.service';
import { ReviewService } from './review.service';
import { POLICY_READERS, POLICY_WRITERS, PRESENTATION_STAFF } from './roles';

/**
 * Staff console of the policy engine. Reading: RISK, COMMERCIAL, SUPERADMIN.
 * Writing and transitions: RISK, SUPERADMIN. Partner links: SUPERADMIN.
 */
@Controller('admin/matching')
@UseGuards(AuthGuard)
@Roles(...POLICY_READERS)
export class PolicyController {
  constructor(
    private readonly policies: PolicyService,
    private readonly presentations: PresentationService,
    private readonly partners: PartnerService,
    private readonly review: ReviewService,
  ) {}

  @Get('catalog') catalog() {
    return this.policies.catalog();
  }

  // Entidades
  @Get('institutions') institutions(
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('active') active?: string,
  ) {
    return this.policies.institutions({ page, search, active });
  }
  @Post('institutions') @Roles(...POLICY_WRITERS) createInstitution(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.policies.createInstitution(actor, body);
  }
  @Get('institutions/:id') institution(@Param('id') id: string) {
    return this.policies.institution(id);
  }
  @Patch('institutions/:id') @Roles(...POLICY_WRITERS) updateInstitution(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.updateInstitution(actor, id, body);
  }
  @Delete('institutions/:id') @Roles(...POLICY_WRITERS) deleteInstitution(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.policies.deleteInstitution(actor, id);
  }

  // Productos
  @Get('products') products(
    @Query('page') page?: string,
    @Query('institutionId') institutionId?: string,
    @Query('kind') kind?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ) {
    return this.policies.products({
      page,
      institutionId,
      kind,
      active,
      search,
    });
  }
  @Post('products') @Roles(...POLICY_WRITERS) createProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.policies.createProduct(actor, body);
  }
  @Get('products/:id') product(@Param('id') id: string) {
    return this.policies.product(id);
  }
  @Patch('products/:id') @Roles(...POLICY_WRITERS) updateProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.updateProduct(actor, id, body);
  }
  @Delete('products/:id') @Roles(...POLICY_WRITERS) deleteProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.policies.deleteProduct(actor, id);
  }

  // Versiones de política
  @Get('products/:id/versions') async versions(@Param('id') id: string) {
    return { items: await this.policies.versions(id) };
  }
  @Post('products/:id/versions') @Roles(...POLICY_WRITERS) createVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.createVersion(actor, id, body);
  }
  @Get('versions/:id') version(@Param('id') id: string) {
    return this.policies.version(id);
  }
  @Patch('versions/:id') @Roles(...POLICY_WRITERS) updateVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.updateVersion(actor, id, body);
  }
  @Delete('versions/:id') @Roles(...POLICY_WRITERS) deleteVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.policies.deleteVersion(actor, id);
  }
  @Get('versions/:id/history') history(@Param('id') id: string) {
    return this.policies.history(id);
  }
  @Post('versions/:id/clone') @Roles(...POLICY_WRITERS) cloneVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.policies.cloneVersion(actor, id);
  }
  @Post('versions/:id/transition') @Roles(...POLICY_WRITERS) transition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.transition(actor, id, body);
  }
  @Post('versions/:id/simulate') simulate(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.simulate(id, body);
  }

  // Reglas (solo en borrador)
  @Put('versions/:id/rules') @Roles(...POLICY_WRITERS) replaceRules(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.replaceRules(actor, id, body);
  }
  @Post('versions/:id/rules') @Roles(...POLICY_WRITERS) addRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.addRule(actor, id, body);
  }
  @Patch('rules/:id') @Roles(...POLICY_WRITERS) updateRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.policies.updateRule(actor, id, body);
  }
  @Delete('rules/:id') @Roles(...POLICY_WRITERS) deleteRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.policies.deleteRule(actor, id);
  }

  // Presentaciones a entidades
  @Get('presentations') @Roles(...PRESENTATION_STAFF) presentationList(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('institutionId') institutionId?: string,
  ) {
    return this.presentations.staffList({ page, status, institutionId });
  }
  @Get('presentations/:id') @Roles(...PRESENTATION_STAFF) presentation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.presentations.staffDetail(actor, id);
  }
  @Post('presentations/:id/present') @Roles(...PRESENTATION_STAFF) present(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.presentations.present(actor, id, body);
  }
  @Post('presentations/:id/decision') @Roles(...PRESENTATION_STAFF) decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.presentations.staffDecide(actor, id, body);
  }

  // Revisión de ejecuciones (reproducibilidad)
  @Get('runs') @Roles(Role.RISK, Role.SUPERADMIN) runs(
    @Query('page') page?: string,
    @Query('userId') userId?: string,
  ) {
    return this.review.runs({ page, userId });
  }
  @Get('runs/:id') @Roles(Role.RISK, Role.SUPERADMIN) run(
    @Param('id') id: string,
  ) {
    return this.review.run(id);
  }
  @Post('runs/:id/verify') @Roles(Role.RISK, Role.SUPERADMIN) verify(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.review.verify(actor, id);
  }

  // Aliados, cuentas vinculadas y referidos (solo SUPERADMIN)
  @Get('allies') @Roles(Role.SUPERADMIN) allies(
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.partners.allies({ page, search });
  }
  @Post('allies') @Roles(Role.SUPERADMIN) createAlly(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.partners.createAlly(actor, body);
  }
  @Get('allies/:id') @Roles(Role.SUPERADMIN) ally(@Param('id') id: string) {
    return this.partners.ally(id);
  }
  @Patch('allies/:id') @Roles(Role.SUPERADMIN) updateAlly(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.partners.updateAlly(actor, id, body);
  }
  @Delete('allies/:id') @Roles(Role.SUPERADMIN) deleteAlly(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.partners.deleteAlly(actor, id);
  }
  @Get('allies/:id/users') @Roles(Role.SUPERADMIN) allyUsers(
    @Param('id') id: string,
  ) {
    return this.partners.allyUsers(id);
  }
  @Post('allies/:id/users') @Roles(Role.SUPERADMIN) linkAllyUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.partners.linkAllyUser(actor, id, body);
  }
  @Delete('ally-users/:id') @Roles(Role.SUPERADMIN) unlinkAllyUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.partners.unlinkAllyUser(actor, id);
  }
  @Get('allies/:id/referrals') @Roles(Role.SUPERADMIN) referrals(
    @Param('id') id: string,
    @Query('page') page?: string,
  ) {
    return this.partners.referrals(id, page);
  }
  @Post('allies/:id/referrals') @Roles(Role.SUPERADMIN) addReferral(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.partners.addReferral(actor, id, body);
  }
  @Delete('ally-referrals/:id') @Roles(Role.SUPERADMIN) removeReferral(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.partners.removeReferral(actor, id);
  }
  @Get('institutions/:id/users') @Roles(Role.SUPERADMIN) institutionUsers(
    @Param('id') id: string,
  ) {
    return this.partners.institutionUsers(id);
  }
  @Post('institutions/:id/users') @Roles(Role.SUPERADMIN) linkInstitutionUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.partners.linkInstitutionUser(actor, id, body);
  }
  @Delete('institution-users/:id')
  @Roles(Role.SUPERADMIN)
  unlinkInstitutionUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.partners.unlinkInstitutionUser(actor, id);
  }
}
