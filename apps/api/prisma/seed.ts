import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // --- Users ---
  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@project9.edu' },
    update: {},
    create: { email: 'admin@project9.edu', password: passwordHash, name: 'System Admin', role: 'ADMIN' },
  });

  await prisma.user.upsert({
    where: { email: 'coordinator@project9.edu' },
    update: {},
    create: { email: 'coordinator@project9.edu', password: passwordHash, name: 'PEP Coordinator', role: 'PLACEMENT_COORDINATOR' },
  });

  await prisma.user.upsert({
    where: { email: 'staff@project9.edu' },
    update: {},
    create: { email: 'staff@project9.edu', password: passwordHash, name: 'PEP Staff', role: 'PEP_STAFF' },
  });

  console.log('Users created');

  // --- Department & Batch ---
  const dept = await prisma.department.upsert({
    where: { code: 'CSE' },
    update: {},
    create: { code: 'CSE', name: 'Computer Science and Engineering' },
  });

  const batch = await prisma.batch.upsert({
    where: { batchIdentifier: 'CSE-2026' },
    update: {},
    create: { batchIdentifier: 'CSE-2026', academicYear: '2026', departmentId: dept.id },
  });

  // --- Programs ---
  const pepProgram = await prisma.program.upsert({
    where: { code: 'PEP' },
    update: {},
    create: { code: 'PEP', name: 'Professional Enhancement Program' },
  });

  const hopeProgram = await prisma.program.upsert({
    where: { code: 'HOPE' },
    update: {},
    create: { code: 'HOPE', name: 'Higher Order Problem-solving Enhancement' },
  });

  // --- Domains (18 PEPC domains) ---
  const domainDefs = [
    { code: 'PEPC-01', name: 'Artificial Intelligence & Machine Learning', cap: 30 },
    { code: 'PEPC-02', name: 'CCNA Networking', cap: 25 },
    { code: 'PEPC-03', name: 'Cloud Computing (AWS)', cap: 25 },
    { code: 'PEPC-04', name: 'Cybersecurity', cap: 20 },
    { code: 'PEPC-05', name: 'Data Science & Analytics', cap: 30 },
    { code: 'PEPC-06', name: 'Full Stack (MERN)', cap: 35 },
    { code: 'PEPC-07', name: 'Full Stack (Java)', cap: 30 },
    { code: 'PEPC-08', name: 'DevOps & SRE', cap: 20 },
    { code: 'PEPC-09', name: 'Embedded Systems & IoT', cap: 15 },
    { code: 'PEPC-10', name: 'Mobile App Development', cap: 25 },
    { code: 'PEPC-11', name: 'Blockchain Development', cap: 15 },
    { code: 'PEPC-12', name: 'Game Development', cap: 15 },
    { code: 'PEPC-13', name: 'AR/VR Development', cap: 10 },
    { code: 'PEPC-14', name: 'Robotics & Automation', cap: 15 },
    { code: 'PEPC-15', name: 'Digital Marketing Tech', cap: 20 },
    { code: 'PEPC-16', name: 'UI/UX Design Engineering', cap: 20 },
    { code: 'PEPC-17', name: 'Quality Assurance & Testing', cap: 25 },
    { code: 'PEPC-18', name: 'Business Intelligence (Power BI)', cap: 20 },
  ];

  const domains: Array<{ id: string; code: string }> = [];
  for (const d of domainDefs) {
    const domain = await prisma.domain.upsert({
      where: { code: d.code },
      update: {},
      create: { code: d.code, name: d.name, programId: pepProgram.id },
    });
    domains.push({ id: domain.id, code: domain.code });

    await prisma.trainingBatch.upsert({
      where: { batchCode: `${d.code}-B1` },
      update: {},
      create: {
        domainId: domain.id,
        batchCode: `${d.code}-B1`,
        batchName: `${d.name} — Batch 1`,
        maxCapacity: d.cap,
      },
    });
  }

  console.log(`${domains.length} domains with training batches created`);

  // --- Selection Cycle ---
  const cycle = await prisma.selectionCycle.upsert({
    where: { code: 'SC-2026-S1' },
    update: {},
    create: {
      code: 'SC-2026-S1',
      name: 'Selection Cycle 2026 — Semester 1',
      academicPeriod: '2026-S1',
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-06-30'),
      status: 'ACTIVE',
    },
  });

  // --- Cycle Config ---
  await prisma.cycleConfig.upsert({
    where: { selectionCycleId: cycle.id },
    update: {},
    create: { selectionCycleId: cycle.id, hopeCount: 50, pepCount: 200 },
  });

  console.log('Selection cycle created');

  // --- Eligibility rules ---
  const existingRules = await prisma.eligibilityRuleVersion.findFirst({
    where: { selectionCycleId: cycle.id },
  });
  let ruleVersionId: string;
  if (!existingRules) {
    const rv = await prisma.eligibilityRuleVersion.create({
      data: {
        selectionCycleId: cycle.id,
        version: 1,
        rules: {
          rules: [
            { id: 'aptitude-min', field: 'aptitudeScore', operator: 'GTE', value: 60, label: 'Aptitude ≥ 60' },
            { id: 'gpa-min', field: 'gpaScore', operator: 'GTE', value: 3.0, label: 'GPA ≥ 3.0' },
            { id: 'active-student', field: 'isActive', operator: 'EQ', value: true, label: 'Active student' },
          ],
          logic: 'AND',
        },
        description: 'Default eligibility rules',
        createdBy: admin.id,
        isActive: true,
      },
    });
    ruleVersionId = rv.id;
    console.log('Eligibility rule version created');
  } else {
    ruleVersionId = existingRules.id;
  }

  // --- Weight version ---
  const existingWeights = await prisma.weightVersion.findFirst({
    where: { selectionCycleId: cycle.id },
  });
  let weightVersionId: string;
  if (!existingWeights) {
    const wv = await prisma.weightVersion.create({
      data: {
        selectionCycleId: cycle.id,
        version: 1,
        description: 'Default scoring weights',
        createdBy: admin.id,
      },
    });
    weightVersionId = wv.id;

    const weightDefs = [
      { key: 'APTITUDE', label: 'Aptitude Score', weight: 0.4, maxRaw: 100, order: 1 },
      { key: 'GPA', label: 'GPA', weight: 0.3, maxRaw: 4, order: 2 },
      { key: 'TECHNICAL', label: 'Technical Score', weight: 0.3, maxRaw: 100, order: 3 },
    ];
    for (const w of weightDefs) {
      await prisma.parameterWeight.create({
        data: {
          weightVersionId: wv.id,
          parameterKey: w.key,
          parameterLabel: w.label,
          weight: w.weight,
          maxRawScore: w.maxRaw,
          sortOrder: w.order,
        },
      });
    }
    console.log('Weight version with parameter weights created');
  } else {
    weightVersionId = existingWeights.id;
  }

  // --- Link CycleConfig to active rule and weight versions ---
  await prisma.cycleConfig.update({
    where: { selectionCycleId: cycle.id },
    data: {
      eligibilityRuleVersionId: ruleVersionId,
      activeWeightVersionId: weightVersionId,
    },
  });

  // --- 5 Test Students ---
  const studentDefs = [
    { studentId: 'STU-001', name: 'Alice Johnson', email: 'alice@student.edu', cgpa: 8.5, coding: 80, aptitude: 75, attendance: 92 },
    { studentId: 'STU-002', name: 'Bob Kumar', email: 'bob@student.edu', cgpa: 7.2, coding: 65, aptitude: 70, attendance: 88 },
    { studentId: 'STU-003', name: 'Carol Zhang', email: 'carol@student.edu', cgpa: 9.1, coding: 90, aptitude: 85, attendance: 95 },
    { studentId: 'STU-004', name: 'David Patel', email: 'david@student.edu', cgpa: 6.8, coding: 55, aptitude: 50, attendance: 80 },
    { studentId: 'STU-005', name: 'Eva Martinez', email: 'eva@student.edu', cgpa: 8.0, coding: 75, aptitude: 78, attendance: 91 },
  ];

  const studentRecords: Array<{ id: string; studentId: string }> = [];
  for (const s of studentDefs) {
    const student = await prisma.student.upsert({
      where: { studentId: s.studentId },
      update: {},
      create: {
        studentId: s.studentId,
        name: s.name,
        email: s.email,
        batchId: batch.id,
        isActive: true,
      },
    });
    studentRecords.push({ id: student.id, studentId: student.studentId });

    const assessments = [
      { sourceIdentifier: 'cgpa', assessmentType: 'GPA' as const, score: s.cgpa, maxScore: 10 },
      { sourceIdentifier: 'codingScore', assessmentType: 'CODING' as const, score: s.coding },
      { sourceIdentifier: 'aptitudeScore', assessmentType: 'APTITUDE' as const, score: s.aptitude },
      { sourceIdentifier: 'attendancePercent', assessmentType: 'OTHER' as const, score: s.attendance },
    ];
    for (const a of assessments) {
      const existing = await prisma.assessmentResult.findFirst({
        where: { studentId: student.id, sourceIdentifier: a.sourceIdentifier },
      });
      if (!existing) {
        await prisma.assessmentResult.create({
          data: { studentId: student.id, sourceIdentifier: a.sourceIdentifier, assessmentType: a.assessmentType, score: a.score, maxScore: a.maxScore },
        });
      }
    }

    await prisma.studentCycleStatus.upsert({
      where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycle.id } },
      create: { studentId: student.id, selectionCycleId: cycle.id, currentState: 'IMPORTED' },
      update: {},
    });
  }
  console.log(`${studentRecords.length} test students with assessments created`);

  // --- STUDENT user linked to first student ---
  await prisma.user.upsert({
    where: { email: 'student@project9.edu' },
    update: { studentId: studentRecords[0].id },
    create: {
      email: 'student@project9.edu',
      password: passwordHash,
      name: 'Alice Johnson',
      role: 'STUDENT',
      studentId: studentRecords[0].id,
    },
  });
  console.log('Student user (student@project9.edu) linked to STU-001');

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
