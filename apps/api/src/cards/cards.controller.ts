import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CardsService } from './cards.service';

@Controller('luft/cards')
@UseGuards(AuthGuard)
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.cards.list(user);
  }

  @Get('overview') overview(@CurrentUser() user: AuthenticatedUser) {
    return this.cards.overview(user);
  }

  @Post() create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.cards.create(user, body);
  }

  @Post('guidance/:id/accept') accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.cards.respond(user, id, 'ACCEPTED');
  }

  @Post('guidance/:id/dismiss') dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.cards.respond(user, id, 'DISMISSED');
  }

  @Patch(':id') update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.cards.update(user, id, body);
  }

  @Delete(':id') remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.cards.remove(user, id);
  }

  @Post(':id/purchases') addPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.cards.addPurchase(user, id, body);
  }

  @Delete(':id/purchases/:purchaseId') removePurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.cards.removePurchase(user, id, purchaseId);
  }

  @Post(':id/simulate') simulate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.cards.simulate(user, id, body);
  }
}
