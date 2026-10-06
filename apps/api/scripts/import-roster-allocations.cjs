const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { readFile } = require('node:fs/promises');
const { basename } = require('node:path');
const { createHash } = require('node:crypto');
const { parseRows } = require('./import-second-year.cjs');

function parseAllocations(rows) {
  const { records, duplicates } = parseRows(rows);
  const assignments = new Map();
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every(value => value == null || value === '')) continue;
    const registerNumber = String(row[1]).trim();
    const trainingGroup = String(row[5] ?? '').trim();
    const trainingLevel = String(row[6] ?? '').trim() || null;
    if (!trainingGroup) throw new Error(`Missing training allocation at spreadsheet row ${index + 1}`);
    const previous = assignments.get(registerNumber);
    if (previous) {
      if (previous.trainingGroup !== trainingGroup || previous.trainingLevel !== trainingLevel) {
        throw new Error(`Conflicting duplicate allocation at spreadsheet row ${index + 1}`);
      }
      previous.sourceRows.push(index + 1);
    } else assignments.set(registerNumber, { trainingGroup, trainingLevel, sourceRows: [index + 1] });
  }
  return { records: records.map(record => ({ ...record, ...assignments.get(record.registerNumber) })), duplicates };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--file') || !process.env.DATABASE_URL) throw new Error('DATABASE_URL and --file <xlsx> are required');
  const file = args[args.indexOf('--file') + 1];
  const bytes = await readFile(file);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  if (workbook.worksheets.length !== 1) throw new Error('Expected one worksheet');
  const sheet = workbook.worksheets[0];
  if (String(sheet.getRow(1).getCell(7).value).trim() !== 'Training Level') throw new Error('Training Level column is missing');
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, row => rows.push(Array.from({ length: 7 }, (_, column) => row.getCell(column + 1).value)));
  const { records, duplicates } = parseAllocations(rows);
  const prisma = new PrismaClient();
  try {
    const students = await prisma.student.findMany({
      where: { registerNumber: { in: records.map(record => record.registerNumber) } },
      include: { rosterAllocation: true, batch: true },
    });
    const byRegister = new Map(students.map(student => [student.registerNumber, student]));
    const pending = [];
    for (const record of records) {
      const student = byRegister.get(record.registerNumber);
      if (!student || student.name.trim().toUpperCase() !== record.name.toUpperCase() ||
          student.batch.batchIdentifier !== `${record.college}-II-${student.batch.academicYear}-${record.department}`) {
        throw new Error('Roster student identity or batch does not match; no allocations were changed');
      }
      const existing = student.rosterAllocation;
      if (existing && (existing.trainingGroup !== record.trainingGroup || existing.trainingLevel !== record.trainingLevel || existing.sourceHash !== sourceHash)) {
        throw new Error('Existing imported allocation conflicts with this source; no allocations were changed');
      }
      if (!existing) pending.push({ studentId: student.id, trainingGroup: record.trainingGroup,
        trainingLevel: record.trainingLevel, sourceFile: basename(file), sourceSheet: sheet.name,
        sourceRows: record.sourceRows, sourceHash });
    }
    const groups = {};
    for (const record of records) groups[record.trainingGroup] = (groups[record.trainingGroup] ?? 0) + 1;
    const summary = { students: records.length, duplicateRowsSkipped: duplicates,
      allocationsToCreate: pending.length, existingAllocationsPreserved: records.length - pending.length, groups,
      assessmentResultsCreated: 0, newCycleDecisionsCreated: 0 };
    if (args.includes('--apply')) {
      await prisma.$transaction(async tx => { if (pending.length) await tx.rosterAllocation.createMany({ data: pending }); });
    }
    // Reconcile every imported allocation against the source on an apply or a repeat run.
    if (args.includes('--apply') || !pending.length) {
      const imported = await prisma.rosterAllocation.findMany({ where: { studentId: { in: students.map(student => student.id) } } });
      const byStudent = new Map(imported.map(allocation => [allocation.studentId, allocation]));
      if (records.some(record => {
        const allocation = byStudent.get(byRegister.get(record.registerNumber).id);
        return !allocation || allocation.trainingGroup !== record.trainingGroup || allocation.trainingLevel !== record.trainingLevel;
      })) throw new Error('Post-import allocation reconciliation failed');
    }
    console.log(JSON.stringify({ mode: args.includes('--apply') ? 'applied' : 'dry-run', ...summary }));
  } finally { await prisma.$disconnect(); }
}
module.exports = { parseAllocations };
if (require.main === module) main().catch(error => {
  console.error(error.code ? `Allocation import failed (${error.code})` : error.message); process.exitCode = 1;
});
