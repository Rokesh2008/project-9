// Local roster provisioning only. Never commits roster contents or plaintext passwords.
// Dry-run is the default; --apply requires ROSTER_INITIAL_PASSWORD in the environment.
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { randomBytes, scryptSync } = require('node:crypto');

function parseRows(rows) {
  const headers = rows[0].map(value => String(value ?? '').trim());
  const columns = ['Register Number', 'Name of the Student', 'Dept', 'College'].map(header => headers.indexOf(header));
  if (columns.some(column => column < 0)) throw new Error('Required roster headers are missing');
  const records = new Map();
  let duplicates = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(value => value === null || value === undefined || value === '')) continue;
    const [registerNumber, name, department, sourceCollege] = columns.map(column => String(row[column] ?? '').trim());
    if (!/^(?:\d{12}|\d{2}L[A-Z]{2,3}\d{3,4})$/.test(registerNumber) || !name || !department) throw new Error(`Invalid student identity at spreadsheet row ${i + 1}`);
    const normalizedCollege = sourceCollege.toUpperCase().replace(/[.']/g, '').replace(/\s+/g, ' ');
    const college = normalizedCollege.includes('ENGINEERING') ? 'SJCE'
      : normalizedCollege.includes('TECHNOLOGY') ? 'SJCT' : null;
    if (!college) throw new Error(`Unknown college at spreadsheet row ${i + 1}`);
    const record = { registerNumber, name, department: department.toUpperCase().replace(/\s+/g, ' '), college };
    const previous = records.get(registerNumber);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting duplicate student at spreadsheet row ${i + 1}`);
      duplicates++;
    } else records.set(registerNumber, record);
  }
  return { records: [...records.values()], duplicates };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--file') + 1];
  const academicYear = args[args.indexOf('--academic-year') + 1];
  if (!args.includes('--file') || !args.includes('--academic-year') || !/^\d{4}-\d{4}$/.test(academicYear ?? '')) {
    throw new Error('Usage: node import-second-year.cjs --file <xlsx> --academic-year <YYYY-YYYY> [--apply]');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  if (workbook.worksheets.length !== 1) throw new Error('Expected one roster worksheet');
  const rows = [];
  workbook.worksheets[0].eachRow({ includeEmpty: true }, row => {
    rows.push(Array.from({ length: 7 }, (_, index) => row.getCell(index + 1).value));
  });
  const { records, duplicates } = parseRows(rows);
  if (!records.length) throw new Error('Roster has no student records');
  const prisma = new PrismaClient();
  try {
    const registerNumbers = records.map(record => record.registerNumber);
    const existing = await prisma.student.findMany({
      where: { OR: [{ registerNumber: { in: registerNumbers } }, { studentId: { in: registerNumbers } }] },
      include: { user: true, batch: true },
    });
    const existingByRegister = new Map();
    for (const student of existing) {
      const record = records.find(record => record.registerNumber === student.registerNumber);
      if (!record || student.name.trim().toUpperCase() !== record.name.toUpperCase() || student.studentId !== record.registerNumber) {
        throw new Error('An existing student identity conflicts with the roster; nothing was changed');
      }
      if (student.user && student.user.role !== 'STUDENT') throw new Error('A roster identity is linked to a non-student account');
      existingByRegister.set(student.registerNumber, student);
    }
    const newAccounts = records.filter(record => !existingByRegister.get(record.registerNumber)?.user);
    const reservedEmails = newAccounts.map(record => `${record.registerNumber}@students.project9.local`);
    if (await prisma.user.count({ where: { email: { in: reservedEmails } } })) throw new Error('A reserved account identifier is already in use');
    const summary = {
      uniqueStudents: records.length, duplicateRowsSkipped: duplicates,
      studentsToCreate: records.length - existing.length, accountsToCreate: newAccounts.length,
      existingAccountsPreserved: records.length - newAccounts.length,
      byCollege: Object.fromEntries(['SJCE', 'SJCT'].map(college => [college, records.filter(record => record.college === college).length])),
      assessmentsCreated: 0, selectionDecisionsCreated: 0,
    };
    if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'dry-run', ...summary })); return; }
    const password = process.env.ROSTER_INITIAL_PASSWORD;
    if (!password) throw new Error('ROSTER_INITIAL_PASSWORD is required for --apply');
    // Each account gets a unique salt, even when initial passwords are the same.
    const hashes = new Map(newAccounts.map(record => {
      const salt = randomBytes(16).toString('hex');
      return [record.registerNumber, `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`];
    }));
    await prisma.$transaction(async tx => {
      for (const record of records) {
        let student = existingByRegister.get(record.registerNumber);
        if (!student) {
          const departmentCode = `${record.college}-${record.department}`;
          const department = await tx.department.upsert({
            where: { code: departmentCode }, update: {},
            create: { code: departmentCode, name: record.department },
          });
          const batchIdentifier = `${record.college}-II-${academicYear}-${record.department}`;
          const batch = await tx.batch.upsert({
            where: { batchIdentifier }, update: {},
            create: { batchIdentifier, academicYear, departmentId: department.id },
          });
          student = await tx.student.create({ data: {
            studentId: record.registerNumber, registerNumber: record.registerNumber,
            name: record.name, batchId: batch.id,
            // Null assessment values are intentional, not numeric zero.
          } });
        }
        if (hashes.has(record.registerNumber)) await tx.user.create({ data: {
          studentId: student.id, name: record.name, role: 'STUDENT',
          // Internal account address, not an actual student email or delivery target.
          email: `${record.registerNumber}@students.project9.local`, password: hashes.get(record.registerNumber),
        } });
      }
    }, { timeout: 120000 });
    console.log(JSON.stringify({ mode: 'applied', ...summary }));
  } finally { await prisma.$disconnect(); }
}

module.exports = { parseRows };
if (require.main === module) main().catch(error => {
  // Do not print Prisma query arguments, names, credential hashes or roster values.
  console.error(error.code ? `Provisioning failed (${error.code}); transaction rolled back` : error.message);
  process.exitCode = 1;
});
