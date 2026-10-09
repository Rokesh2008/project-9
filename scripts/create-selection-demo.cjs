// Build apps/api first. Supply DATABASE_URL privately; never pass it on the CLI.
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
const { createSelectionDemo } = require('../apps/api/dist/selection-demo.fixture');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured privately');
const db = new PrismaClient();
(async () => {
  const activeBefore = await db.selectionCycle.findMany({ where: { status: { in: ['ACTIVE', 'FROZEN'] } }, orderBy: { id: 'asc' } });
  const cycle = await createSelectionDemo(db);
  const activeAfter = await db.selectionCycle.findMany({ where: { status: { in: ['ACTIVE', 'FROZEN'] } }, orderBy: { id: 'asc' } });
  if (JSON.stringify(activeBefore) !== JSON.stringify(activeAfter)) throw new Error('Active-cycle preservation check failed');
  console.log(JSON.stringify({ cycleId: cycle.id, name: cycle.name, status: cycle.status, syntheticStudents: await db.studentCycleStatus.count({ where: { selectionCycleId: cycle.id } }), activeCyclesUnchanged: true }));
})().catch(() => { console.error('Demo setup failed; inspect privately without logging credentials.'); process.exitCode = 1; }).finally(() => db.$disconnect());
