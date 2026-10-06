import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        createdAt: true, student: { select: { studentId: true, name: true } },
        facultyDomain: { select: { code: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async options() {
    const [students, domains] = await Promise.all([
      this.prisma.student.findMany({
        where: { isActive: true },
        select: { studentId: true, name: true },
        orderBy: { studentId: 'asc' },
      }),
      this.prisma.domain.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return { students, domains };
  }

  async create(input: CreateAccountDto) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account already uses this email');
    }
    const binding = await this.binding(input.role, input.studentId, input.facultyDomainCode);
    if (binding.studentId && await this.prisma.user.findUnique({ where: { studentId: binding.studentId } })) {
      throw new ConflictException('This student already has a login');
    }
    const user = await this.prisma.user.create({
      data: {
        name: input.name.trim(), email, role: input.role,
        password: this.auth.hashPassword(input.password), ...binding,
      },
    });
    return this.safe(user);
  }

  async update(id: string, input: UpdateAccountDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Account not found');
    const nextRole = input.role ?? existing.role;
    const nextActive = input.isActive ?? existing.isActive;
    if (id === actorId && (nextRole !== 'ADMIN' || !nextActive)) {
      throw new ForbiddenException('You cannot remove your own administrator access');
    }
    if (existing.role === 'ADMIN' && (nextRole !== 'ADMIN' || !nextActive)) {
      const activeAdmins = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (activeAdmins <= 1) throw new ForbiddenException('At least one active administrator is required');
    }
    const email = input.email?.trim().toLowerCase();
    if (email && email !== existing.email && await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account already uses this email');
    }
    const binding = await this.binding(
      nextRole,
      input.studentId ?? (nextRole === existing.role && existing.studentId ? await this.externalStudentId(existing.studentId) : undefined),
      input.facultyDomainCode ?? (nextRole === existing.role && existing.facultyDomainId ? await this.domainCode(existing.facultyDomainId) : undefined),
    );
    if (binding.studentId) {
      const owner = await this.prisma.user.findUnique({ where: { studentId: binding.studentId } });
      if (owner && owner.id !== id) throw new ConflictException('This student already has a login');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(input.password !== undefined ? { password: this.auth.hashPassword(input.password) } : {}),
        ...(
          input.password !== undefined || input.email !== undefined || input.role !== undefined ||
          input.isActive !== undefined || input.studentId !== undefined || input.facultyDomainCode !== undefined
            ? { authVersion: { increment: 1 } } : {}
        ),
        role: nextRole, isActive: nextActive, ...binding,
      },
    });
    return this.safe(user);
  }

  private async binding(role: Role, studentId?: string, facultyDomainCode?: string) {
    if (role === 'STUDENT') {
      if (!studentId) throw new BadRequestException('Student accounts require a student ID');
      if (facultyDomainCode) throw new BadRequestException('Student accounts cannot have a faculty domain');
      const student = await this.prisma.student.findUnique({ where: { studentId } });
      if (!student || !student.isActive) throw new NotFoundException('Active student not found');
      return { studentId: student.id, facultyDomainId: null };
    }
    if (role === 'PEP_STAFF') {
      if (!facultyDomainCode) throw new BadRequestException('Faculty accounts require a domain');
      if (studentId) throw new BadRequestException('Faculty accounts cannot be linked to a student');
      const domain = await this.prisma.domain.findUnique({ where: { code: facultyDomainCode.toUpperCase() } });
      if (!domain || !domain.isActive) throw new NotFoundException('Active domain not found');
      return { studentId: null, facultyDomainId: domain.id };
    }
    if (studentId || facultyDomainCode) throw new BadRequestException('This role cannot have a student or faculty-domain binding');
    return { studentId: null, facultyDomainId: null };
  }

  private async externalStudentId(id: string) {
    return (await this.prisma.student.findUnique({ where: { id } }))?.studentId;
  }

  private async domainCode(id: string) {
    return (await this.prisma.domain.findUnique({ where: { id } }))?.code;
  }

  private safe(user: { id: string; name: string; email: string; role: Role; isActive: boolean; studentId: string | null; facultyDomainId: string | null }) {
    return {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: user.isActive, studentId: user.studentId, facultyDomainId: user.facultyDomainId,
    };
  }
}
