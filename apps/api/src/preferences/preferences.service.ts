import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async setPreferences(params: {
    studentId: string;
    selectionCycleId: string;
    preferences: Array<{ domainId: string; rank: number }>;
  }) {
    const student = await this.prisma.student.findUnique({ where: { id: params.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const cycle = await this.prisma.selectionCycle.findUnique({ where: { id: params.selectionCycleId } });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const ranks = params.preferences.map((p) => p.rank);
    if (new Set(ranks).size !== ranks.length) {
      throw new BadRequestException('Preference ranks must be unique');
    }

    await this.prisma.studentPreference.deleteMany({
      where: { studentId: params.studentId, selectionCycleId: params.selectionCycleId },
    });

    const created = await Promise.all(
      params.preferences.map((p) =>
        this.prisma.studentPreference.create({
          data: {
            studentId: params.studentId,
            selectionCycleId: params.selectionCycleId,
            domainId: p.domainId,
            preferenceRank: p.rank,
          },
          include: { domain: { select: { code: true, name: true } } },
        }),
      ),
    );

    return created;
  }

  async getPreferences(studentId: string, selectionCycleId: string) {
    return this.prisma.studentPreference.findMany({
      where: { studentId, selectionCycleId },
      orderBy: { preferenceRank: 'asc' },
      include: { domain: { select: { id: true, code: true, name: true } } },
    });
  }

  async getPreferencesByCycle(selectionCycleId: string) {
    return this.prisma.studentPreference.findMany({
      where: { selectionCycleId },
      orderBy: [{ studentId: 'asc' }, { preferenceRank: 'asc' }],
      include: {
        student: { select: { id: true, studentId: true, name: true } },
        domain: { select: { id: true, code: true, name: true } },
      },
    });
  }
}
