import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateStudentDto } from './students.dto';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStudentDto) {
    const existing = await this.prisma.student.findUnique({
      where: { studentId: dto.studentId },
    });
    if (existing) {
      throw new BadRequestException(`Student ${dto.studentId} already exists`);
    }

    const dept = await this.findOrCreateDepartment(dto.department);
    const batch = await this.findOrCreateBatch(
      dept.id,
      dto.batch ?? dto.department,
      dto.academicYear ?? new Date().getFullYear().toString(),
    );

    const student = await this.prisma.student.create({
      data: {
        studentId: dto.studentId,
        name: dto.name,
        email: dto.email,
        contactNo: dto.contactNo,
        batchId: batch.id,
        isActive: true,
      },
    });

    await this.upsertAssessmentScores(student.id, dto);

    const activeCycle = await this.prisma.selectionCycle.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (activeCycle) {
      await this.prisma.studentCycleStatus.upsert({
        where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: activeCycle.id } },
        create: { studentId: student.id, selectionCycleId: activeCycle.id, currentState: 'IMPORTED' },
        update: {},
      });
    }

    return student;
  }

  async upsertFromImport(dto: CreateStudentDto) {
    const dept = await this.findOrCreateDepartment(dto.department);
    const batch = await this.findOrCreateBatch(
      dept.id,
      dto.batch ?? dto.department,
      dto.academicYear ?? new Date().getFullYear().toString(),
    );

    const student = await this.prisma.student.upsert({
      where: { studentId: dto.studentId },
      create: {
        studentId: dto.studentId,
        name: dto.name,
        email: dto.email,
        contactNo: dto.contactNo,
        batchId: batch.id,
        isActive: true,
      },
      update: {
        name: dto.name,
        email: dto.email,
        contactNo: dto.contactNo,
        batchId: batch.id,
      },
    });

    await this.upsertAssessmentScores(student.id, dto);

    return student;
  }

  async findAll(options: {
    search?: string;
    department?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { studentId: { contains: options.search, mode: 'insensitive' } },
        { email: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (options.department) {
      where.batch = { department: { code: options.department } };
    }

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: {
          batch: { include: { department: true } },
          assessmentResults: true,
          preferences: { include: { domain: true }, orderBy: { preferenceRank: 'asc' } },
          eligibilityResults: { orderBy: { evaluatedAt: 'desc' }, take: 1 },
          studentRankings: { orderBy: { calculatedAt: 'desc' }, take: 1 },
          allocations: { include: { domain: true, trainingBatch: true }, take: 1 },
          hopePepClassifications: { orderBy: { classifiedAt: 'desc' }, take: 1 },
        },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      data: students.map((s) => this.enrichStudent(s)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findFirst({
      where: { OR: [{ id }, { studentId: id }] },
      include: {
        batch: { include: { department: true } },
        assessmentResults: { orderBy: { createdAt: 'desc' } },
        preferences: { include: { domain: true }, orderBy: { preferenceRank: 'asc' } },
        eligibilityResults: { orderBy: { evaluatedAt: 'desc' } },
        studentScores: { orderBy: { calculatedAt: 'desc' } },
        studentRankings: { orderBy: { calculatedAt: 'desc' } },
        allocations: { include: { domain: true, trainingBatch: true, selectionCycle: true } },
        hopePepClassifications: { orderBy: { classifiedAt: 'desc' } },
        cycleStatuses: { include: { selectionCycle: true } },
        adminDecisions: { orderBy: { createdAt: 'desc' } },
        workflowAudits: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.enrichStudent(student);
  }

  async findByStudentId(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { studentId },
      include: {
        batch: { include: { department: true } },
        assessmentResults: true,
      },
    });
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);
    return student;
  }

  private enrichStudent(student: any) {
    const scores = this.extractScores(student.assessmentResults ?? []);
    return {
      ...student,
      department: student.batch?.department?.name ?? student.batch?.department?.code,
      departmentCode: student.batch?.department?.code,
      cgpa: scores.cgpa,
      codingScore: scores.codingScore,
      aptitudeScore: scores.aptitudeScore,
      attendancePercent: scores.attendancePercent,
      dsaLevel: scores.dsaLevel,
      completedCertificates: scores.completedCertificates,
    };
  }

  private extractScores(results: any[]) {
    const latest = (type: string) =>
      results.find((r: any) => r.assessmentType === type || r.sourceIdentifier === type);

    return {
      cgpa: latest('CGPA')?.score ?? latest('cgpa')?.score ?? 0,
      codingScore: latest('CODING')?.score ?? latest('codingScore')?.score ?? 0,
      aptitudeScore: latest('APTITUDE')?.score ?? latest('aptitudeScore')?.score ?? 0,
      attendancePercent: latest('ATTENDANCE')?.score ?? latest('attendancePercent')?.score ?? 0,
      dsaLevel: latest('DSA_LEVEL')?.metadata?.level ?? latest('dsaLevel')?.metadata?.level ?? 'BEGINNER',
      completedCertificates: latest('CERTIFICATES')?.metadata?.certificates ?? [],
    };
  }

  private async findOrCreateDepartment(deptCode: string) {
    let dept = await this.prisma.department.findUnique({ where: { code: deptCode } });
    if (!dept) {
      dept = await this.prisma.department.create({
        data: { code: deptCode, name: deptCode },
      });
    }
    return dept;
  }

  private async findOrCreateBatch(departmentId: string, batchCode: string, academicYear: string) {
    const identifier = `${batchCode}-${academicYear}`;
    let batch = await this.prisma.batch.findUnique({ where: { batchIdentifier: identifier } });
    if (!batch) {
      batch = await this.prisma.batch.create({
        data: {
          batchIdentifier: identifier,
          academicYear,
          departmentId,
        },
      });
    }
    return batch;
  }

  private async upsertAssessmentScores(studentId: string, dto: CreateStudentDto) {
    const assessments = [
      { sourceIdentifier: 'codingScore', assessmentType: 'CODING' as const, score: dto.codingScore },
      { sourceIdentifier: 'aptitudeScore', assessmentType: 'APTITUDE' as const, score: dto.aptitudeScore },
      { sourceIdentifier: 'attendancePercent', assessmentType: 'OTHER' as const, score: dto.attendancePercent },
    ];

    for (const a of assessments) {
      const existing = await this.prisma.assessmentResult.findFirst({
        where: { studentId, sourceIdentifier: a.sourceIdentifier },
      });
      if (existing) {
        await this.prisma.assessmentResult.update({
          where: { id: existing.id },
          data: { score: a.score },
        });
      } else {
        await this.prisma.assessmentResult.create({
          data: {
            studentId,
            sourceIdentifier: a.sourceIdentifier,
            assessmentType: a.assessmentType,
            score: a.score,
          },
        });
      }
    }

    if (dto.cgpa !== undefined) {
      const cgpaRecord = await this.prisma.assessmentResult.findFirst({
        where: { studentId, sourceIdentifier: 'cgpa' },
      });
      if (cgpaRecord) {
        await this.prisma.assessmentResult.update({
          where: { id: cgpaRecord.id },
          data: { score: dto.cgpa },
        });
      } else {
        await this.prisma.assessmentResult.create({
          data: {
            studentId,
            sourceIdentifier: 'cgpa',
            assessmentType: 'GPA',
            score: dto.cgpa,
            maxScore: 10,
          },
        });
      }
    }

    if (dto.dsaLevel) {
      const dsaRecord = await this.prisma.assessmentResult.findFirst({
        where: { studentId, sourceIdentifier: 'dsaLevel' },
      });
      if (dsaRecord) {
        await this.prisma.assessmentResult.update({
          where: { id: dsaRecord.id },
          data: { metadata: { level: dto.dsaLevel } },
        });
      } else {
        await this.prisma.assessmentResult.create({
          data: {
            studentId,
            sourceIdentifier: 'dsaLevel',
            assessmentType: 'OTHER',
            score: 0,
            metadata: { level: dto.dsaLevel },
          },
        });
      }
    }

    if (dto.completedCertificates?.length) {
      const certRecord = await this.prisma.assessmentResult.findFirst({
        where: { studentId, sourceIdentifier: 'certificates' },
      });
      if (certRecord) {
        await this.prisma.assessmentResult.update({
          where: { id: certRecord.id },
          data: { metadata: { certificates: dto.completedCertificates } },
        });
      } else {
        await this.prisma.assessmentResult.create({
          data: {
            studentId,
            sourceIdentifier: 'certificates',
            assessmentType: 'OTHER',
            score: dto.completedCertificates.length,
            metadata: { certificates: dto.completedCertificates },
          },
        });
      }
    }
  }
}
