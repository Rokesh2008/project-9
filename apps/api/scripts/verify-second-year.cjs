// Read-only post-provisioning checks. Output aggregate counts only.
const { PrismaClient } = require('@prisma/client');
const { scryptSync, timingSafeEqual } = require('node:crypto');
const prisma = new PrismaClient();
async function main() {
  if (!process.env.ROSTER_INITIAL_PASSWORD) throw new Error('ROSTER_INITIAL_PASSWORD is required');
  const students = await prisma.student.findMany({
    where: { batch: { batchIdentifier: { startsWith: 'SJC' } } },
    include: { user: true, _count: { select: {
      assessmentResults: true, cycleStatuses: true, eligibilityResults: true,
      studentScores: true, studentRankings: true, hopePepClassifications: true, allocations: true,
    } } },
  });
  let validHashes = 0;
  const hashes = new Set();
  for (const student of students) {
    const parts = student.user?.password.split('$') ?? [];
    if (parts.length === 3 && parts[0] === 'scrypt' && timingSafeEqual(
      scryptSync(process.env.ROSTER_INITIAL_PASSWORD, parts[1], 64), Buffer.from(parts[2], 'hex'),
    )) validHashes++;
    hashes.add(student.user?.password);
  }
  const summary = {
    rosterProfiles: students.length,
    studentAccounts: students.filter(student => student.user?.role === 'STUDENT' && student.user.isActive).length,
    correctPasswordHashes: validHashes, uniqueSaltedHashes: hashes.size,
    missingAssessmentsPreserved: students.every(student => student.cgpa === null && student.attendancePercent === null && Object.values(student._count).every(count => count === 0)),
    allAccounts: await prisma.user.count(),
  };
  console.log(JSON.stringify(summary));
  if (!students.length || validHashes !== students.length || !summary.missingAssessmentsPreserved) throw new Error('Roster verification failed');
  const examples = [students[0], students[students.length - 1], students.find(student => /[A-Z]/.test(student.registerNumber))].filter(Boolean);
  for (const student of examples) {
    const response = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: student.registerNumber, password: process.env.ROSTER_INITIAL_PASSWORD }) });
    const body = await response.json();
    if (!response.ok) throw new Error('Login verification failed');
    const headers = { Authorization: `Bearer ${body.accessToken}` };
    const profileResponse = await fetch('http://localhost:3000/api/profiles/me', { headers });
    const profile = await profileResponse.json();
    const denied = await fetch('http://localhost:3000/api/accounts', { headers });
    const result = { loginStatus: response.status, profileStatus: profileResponse.status,
      correctProfile: profile.student.registerNumber === student.registerNumber,
      outcome: profile.outcome, assessmentStatus: profile.assessmentStatus,
      scoreCount: profile.scoreBreakdown.length, accountsAccess: denied.status };
    console.log(JSON.stringify(result));
    if (!result.correctProfile || result.assessmentStatus !== 'PENDING' || result.scoreCount !== 0 || denied.status !== 403) throw new Error('Profile access verification failed');
  }
}
main().catch(() => { console.error('Verification failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
