import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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

  const program = await prisma.program.upsert({
    where: { code: 'PEP' },
    update: {},
    create: { code: 'PEP', name: 'Professional Enhancement Program' },
  });

  const domainDefs = [
    { code: 'PEPC-01', name: 'AI/ML', capacity: 2 },
    { code: 'PEPC-05', name: 'Data Science', capacity: 2 },
    { code: 'PEPC-06', name: 'Full Stack MERN', capacity: 2 },
    { code: 'PEPC-02', name: 'CCNA', capacity: 2 },
  ];

  const domains: Record<string, string> = {};
  for (const d of domainDefs) {
    const domain = await prisma.domain.upsert({
      where: { code: d.code },
      update: {},
      create: { programId: program.id, code: d.code, name: d.name },
    });
    domains[d.code] = domain.id;

    await prisma.trainingBatch.upsert({
      where: { batchCode: `${d.code}-B1` },
      update: { maxCapacity: d.capacity, currentAllocated: 0 },
      create: { domainId: domain.id, batchCode: `${d.code}-B1`, batchName: `${d.name} Batch 1`, maxCapacity: d.capacity, currentAllocated: 0 },
    });
  }

  const cycle = await prisma.selectionCycle.upsert({
    where: { code: 'CYCLE-2026-A' },
    update: {},
    create: {
      code: 'CYCLE-2026-A',
      name: 'PEP Cycle 2026-A',
      academicPeriod: '2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      status: 'ACTIVE',
    },
  });

  const studentDefs = [
    { studentId: 'STU-001', name: 'Aarav Kumar', email: 'aarav@example.edu', prefs: ['PEPC-01', 'PEPC-05', 'PEPC-06'] },
    { studentId: 'STU-002', name: 'Diya Sharma', email: 'diya@example.edu', prefs: ['PEPC-06', 'PEPC-01'] },
    { studentId: 'STU-003', name: 'Rohan Patel', email: 'rohan@example.edu', prefs: ['PEPC-01', 'PEPC-05', 'PEPC-02'] },
    { studentId: 'STU-004', name: 'Meera Nair', email: 'meera@example.edu', prefs: ['PEPC-05', 'PEPC-01'] },
    { studentId: 'STU-005', name: 'Arjun Singh', email: 'arjun@example.edu', prefs: ['PEPC-01', 'PEPC-06', 'PEPC-05'] },
  ];

  for (const s of studentDefs) {
    const student = await prisma.student.upsert({
      where: { studentId: s.studentId },
      update: {},
      create: { studentId: s.studentId, name: s.name, email: s.email, batchId: batch.id },
    });

    await prisma.studentCycleStatus.upsert({
      where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycle.id } },
      update: { currentState: 'SELECTION' },
      create: { studentId: student.id, selectionCycleId: cycle.id, currentState: 'SELECTION' },
    });

    for (let i = 0; i < s.prefs.length; i++) {
      const domainId = domains[s.prefs[i]];
      await prisma.studentPreference.upsert({
        where: { studentId_selectionCycleId_preferenceRank: { studentId: student.id, selectionCycleId: cycle.id, preferenceRank: i + 1 } },
        update: {},
        create: { studentId: student.id, selectionCycleId: cycle.id, domainId, preferenceRank: i + 1 },
      });
    }
  }

  console.log('Seed complete!');
  console.log(`Selection Cycle ID: ${cycle.id}`);
  console.log(`Use this cycle ID in the UI or API calls.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void prisma.$disconnect());
