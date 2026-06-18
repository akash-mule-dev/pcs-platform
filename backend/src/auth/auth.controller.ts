import { Controller, Post, Body, Get, Patch, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { MarkTourDto } from './dto/mark-tour.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Get('permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's role and effective fine-grained permissions" })
  getPermissions(@Request() req: any) {
    return this.authService.getMyAccess(req.user);
  }

  @Get('tours')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's seen-tour state ({ [tourId]: version })" })
  getTours(@Request() req: any) {
    return this.authService.getTourState(req.user.id);
  }

  @Patch('tours')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a guided tour as seen at a version' })
  markTour(@Request() req: any, @Body() dto: MarkTourDto) {
    return this.authService.markTourSeen(req.user.id, dto.tourId, dto.version);
  }

  @Delete('tours')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset one tour (tourId query) or all of the caller\'s tours' })
  resetTours(@Request() req: any, @Query('tourId') tourId?: string) {
    return this.authService.resetTours(req.user.id, tourId);
  }
}
