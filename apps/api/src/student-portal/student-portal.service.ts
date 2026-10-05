import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class StudentPortalService {
  constructor(private readonly prisma: PrismaService) {}

  private assertStudentLinked(studentId: string | null | undefined): string {
    if (!studentId) throw new ForbiddenException('User account is not linked to a student record');
    return studentId;
  }

  async getDashboard(studentId: string | null) {
    const sid = this.assertStudentLinked(studentId);
    const student = await this.prisma.student.findUnique({ where: { id: sid } });
    if (!student) throw new NotFoundException('Student record not found');

    const activeCycle = await this.prisma.selectionCycle.findFirst({ where: { status: 'ACTIVE' } });
    if (!activeCycle) {
      return { student: { id: sid, name: student.name, studentId: student.studentId }, cycle: null, eligibility: null, ranking: null, classification: null, allocation: null, notificationCount: 0 };
    }

    const [eligibility, ranking, classification, allocation, notificationCount] = await Promise.all([
      this.prisma.eligibilityResult.findFirst({ where: { studentId: sid, selectionCycleId: activeCycle.id }, orderBy: { evaluatedAt: 'desc' } }),
      this.prisma.studentRanking.findFirst({ where: { studentId: sid, selectionCycleId: activeCycle.id }, orderBy: { calculatedAt: 'desc' } }),
      this.prisma.hopePepClassification.findFirst({ where: { studentId: sid, selectionCycleId: activeCycle.id }, orderBy: { classifiedAt: 'desc' } }),
      this.prisma.allocation.findFirst({ where: { studentId: sid, selectionCycleId: activeCycle.id }, include: { domain: true, trainingBatch: true } }),
      this.prisma.notification.count({ where: { recipient: sid, isRead: false } }),
    ]);

    const workflowStatus = await this.prisma.studentCycleStatus.findUnique({
      where: { studentId_selectionCycleId: { studentId: sid, selectionCycleId: activeCycle.id } },
    });

    return {
      student: { id: sid, name: student.name, studentId: student.studentId },
      cycle: { id: activeCycle.id, name: activeCycle.name, status: activeCycle.status },
      workflowState: workflowStatus?.currentState ?? null,
      eligibility: eligibility ? { isEligible: eligibility.isEligible, failedRules: eligibility.failedRules } : null,
      ranking: ranking ? { rank: ranking.rank, percentile: ranking.percentile } : null,
      classification: classification ? { program: classification.program, status: classification.status } : null,
      allocation: allocation ? { status: allocation.status, domain: allocation.domain?.name, domainCode: allocation.domain?.code, batch: allocation.trainingBatch?.batchCode, isFrozen: allocation.isFrozen } : null,
      notificationCount,
    };
  }

  async getProfile(studentId: string | null) {
    const sid = this.assertStudentLinked(studentId);
    const student = await this.prisma.student.findUnique({
      where: { id: sid },
      include: {
        batch: { include: { department: true } },
        assessmentResults: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async getEligibility(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.eligibilityResult.findFirst({
      where: { studentId: sid, selectionCycleId: cycleId },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async getScores(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.studentScore.findMany({
      where: { studentId: sid, selectionCycleId: cycleId },
      orderBy: { parameterKey: 'asc' },
    });
  }

  async getRanking(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    const ranking = await this.prisma.studentRanking.findFirst({
      where: { studentId: sid, selectionCycleId: cycleId },
      orderBy: { calculatedAt: 'desc' },
    });
    const total = await this.prisma.studentRanking.count({ where: { selectionCycleId: cycleId } });
    return { ranking, totalRanked: total };
  }

  async getClassification(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.hopePepClassification.findFirst({
      where: { studentId: sid, selectionCycleId: cycleId },
      orderBy: { classifiedAt: 'desc' },
    });
  }

  async getPreferences(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.studentPreference.findMany({
      where: { studentId: sid, selectionCycleId: cycleId },
      include: { domain: true },
      orderBy: { preferenceRank: 'asc' },
    });
  }

  async submitPreferences(studentId: string | null, cycleId: string, preferences: Array<{ domainId: string; rank: number }>) {
    const sid = this.assertStudentLinked(studentId);
    await this.prisma.studentPreference.deleteMany({ where: { studentId: sid, selectionCycleId: cycleId } });
    const created = await Promise.all(
      preferences.map((p) =>
        this.prisma.studentPreference.create({
          data: { studentId: sid, selectionCycleId: cycleId, domainId: p.domainId, preferenceRank: p.rank },
          include: { domain: true },
        }),
      ),
    );
    return created;
  }

  async getAllocation(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.allocation.findFirst({
      where: { studentId: sid, selectionCycleId: cycleId },
      include: { domain: true, trainingBatch: true },
    });
  }

  async getWorkflow(studentId: string | null, cycleId: string) {
    const sid = this.assertStudentLinked(studentId);
    const [status, audits] = await Promise.all([
      this.prisma.studentCycleStatus.findUnique({
        where: { studentId_selectionCycleId: { studentId: sid, selectionCycleId: cycleId } },
      }),
      this.prisma.workflowAuditLog.findMany({
        where: { studentId: sid, selectionCycleId: cycleId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { status, audits };
  }

  async getNotifications(studentId: string | null) {
    const sid = this.assertStudentLinked(studentId);
    return this.prisma.notification.findMany({
      where: { recipient: sid },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationRead(studentId: string | null, notificationId: string) {
    const sid = this.assertStudentLinked(studentId);
    const notif = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notif || notif.recipient !== sid) throw new ForbiddenException('Cannot modify another user\'s notification');
    return this.prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
  }
}
