import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StudentPortalService } from './student-portal.service';

@ApiTags('Student Portal')
@Roles('STUDENT')
@Controller('my')
export class StudentPortalController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get('dashboard')
  dashboard(@CurrentUser('studentId') studentId: string) {
    return this.portal.getDashboard(studentId);
  }

  @Get('profile')
  profile(@CurrentUser('studentId') studentId: string) {
    return this.portal.getProfile(studentId);
  }

  @Get('eligibility/:cycleId')
  eligibility(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getEligibility(studentId, cycleId);
  }

  @Get('scores/:cycleId')
  scores(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getScores(studentId, cycleId);
  }

  @Get('ranking/:cycleId')
  ranking(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getRanking(studentId, cycleId);
  }

  @Get('classification/:cycleId')
  classification(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getClassification(studentId, cycleId);
  }

  @Get('preferences/:cycleId')
  preferences(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getPreferences(studentId, cycleId);
  }

  @Post('preferences/:cycleId')
  submitPreferences(
    @CurrentUser('studentId') studentId: string,
    @Param('cycleId') cycleId: string,
    @Body() body: { preferences: Array<{ domainId: string; rank: number }> },
  ) {
    return this.portal.submitPreferences(studentId, cycleId, body.preferences);
  }

  @Get('allocation/:cycleId')
  allocation(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getAllocation(studentId, cycleId);
  }

  @Get('workflow/:cycleId')
  workflow(@CurrentUser('studentId') studentId: string, @Param('cycleId') cycleId: string) {
    return this.portal.getWorkflow(studentId, cycleId);
  }

  @Get('notifications')
  notifications(@CurrentUser('studentId') studentId: string) {
    return this.portal.getNotifications(studentId);
  }

  @Patch('notifications/:id/read')
  markRead(@CurrentUser('studentId') studentId: string, @Param('id') id: string) {
    return this.portal.markNotificationRead(studentId, id);
  }
}
