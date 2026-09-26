import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CanonicalStudent, CommunicationResult, IntegrationLog, InterviewResult, SourceCode } from './domain';
import { Store } from './store';

const DEMO_ROWS: Array<[string, string, string, string, number, number, number, number, CanonicalStudent['dsaLevel'], string[], string[], CanonicalStudent['program']]> = [
  ['S-001', 'REG2026001', 'Aarav Kumar', 'CSE', 8.7, 88, 81, 93, 'ADVANCED', ['PEPC-01 AI/ML', 'PEPC-05 Data Science'], ['Data Science Foundation'], 'PEP'],
  ['S-002', 'REG2026002', 'Diya Sharma', 'IT', 8.2, 76, 84, 89, 'INTERMEDIATE', ['PEPC-06 Full Stack MERN', 'PEPC-08 Mobile Development'], ['HTML5'], 'PEP'],
  ['S-003', 'REG2026003', 'Rohan Patel', 'ECE', 7.9, 72, 69, 86, 'INTERMEDIATE', ['PEPC-15 Embedded & IoT', 'PEPC-16 Robotics'], ['Fundamentals of TinyML'], 'HOPE'],
  ['S-004', 'REG2026004', 'Meera Nair', 'CSE', 9.1, 92, 87, 96, 'ADVANCED', ['PEPC-05 Data Science', 'PEPC-01 AI/ML'], ['Applied Data Science with Python'], 'PEP'],
  ['S-005', 'REG2026005', 'Arjun Singh', 'EEE', 7.4, 64, 71, 78, 'BEGINNER', ['PEPC-14 EV Technology', 'PEPC-13 CAD & 3D Printing'], ['Introduction to Electric Vehicles'], 'UNASSIGNED'],
  ['S-006', 'REG2026006', 'Kavya Iyer', 'IT', 8.5, 83, 79, 91, 'ADVANCED', ['PEPC-10 RPA & Agentic AI', 'PEPC-06 Full Stack MERN'], ['Introduction to Robotic Process Automation'], 'PEP'],
  ['S-007', 'REG2026007', 'Vikram Rao', 'ECE', 8.0, 74, 77, 84, 'INTERMEDIATE', ['PEPC-02 CCNA', 'PEPC-12 5G/6G'], ['Networking Basics'], 'HOPE'],
  ['S-008', 'REG2026008', 'Ananya Das', 'CSE', 8.9, 90, 85, 94, 'ADVANCED', ['PEPC-04 Cybersecurity', 'PEPC-01 AI/ML'], ['Cybersecurity Essentials'], 'PEP'],
];

const DEMO_STUDENTS: CanonicalStudent[] = DEMO_ROWS.map(([studentId, registerNumber, name, department, cgpa, codingScore, aptitudeScore, attendancePercent, dsaLevel, preferences, completedCertificates, program]) => ({
  studentId: String(studentId), registerNumber: String(registerNumber), name: String(name), department: String(department),
  email: `${String(name).toLowerCase().replace(' ', '.')}@example.edu`, cgpa: Number(cgpa), codingScore: Number(codingScore),
  aptitudeScore: Number(aptitudeScore), attendancePercent: Number(attendancePercent), dsaLevel,
  preferences, completedCertificates, program,
  interviewEligible: false, selected: false, sourceUpdatedAt: '2026-09-24T09:00:00.000Z',
}));

@Injectable()
export class DemoService {
  constructor(private readonly store: Store) {}

  bootstrap() {
    this.assertEnabled();
    let inserted = 0;
    for (const student of DEMO_STUDENTS) {
      if (!this.store.students.has(student.studentId)) {
        this.store.students.set(student.studentId, { ...student });
        inserted++;
      }
    }
    this.integrationLog('PROJECT_2', 'students.demo-bootstrap', inserted);
    this.audit('DEMO_PROJECT2_BOOTSTRAP', { inserted });
    return { inserted, totalStudents: this.store.students.size };
  }

  evaluateEligibility() {
    this.assertEnabled();
    let eligible = 0;
    const failures: Array<{ studentId: string; reasons: string[] }> = [];
    for (const student of this.store.students.values()) {
      const reasons = this.failureReasons(student);
      student.interviewEligible = reasons.length === 0;
      if (student.interviewEligible) eligible++; else failures.push({ studentId: student.studentId, reasons });
    }
    this.audit('DEMO_ELIGIBILITY_EVALUATED', { eligible, failed: failures.length });
    return { mode: 'DEMO_ONLY', eligible, failed: failures.length, failures };
  }

  simulateProject1() {
    this.assertEnabled();
    let inserted = 0;
    for (const student of this.store.students.values()) {
      if (!student.interviewEligible) continue;
      const resultId = `DEMO-P1-${student.studentId}`;
      if (this.store.communicationResults.has(resultId)) continue;
      const score = Math.round(student.aptitudeScore * 0.55 + student.attendancePercent * 0.45);
      const result: CommunicationResult = {
        resultId, studentId: student.studentId, score,
        level: score >= 80 ? 'ADVANCED' : score >= 65 ? 'INTERMEDIATE' : 'DEVELOPING', assessedAt: new Date().toISOString(),
      };
      this.store.communicationResults.set(resultId, result);
      inserted++;
    }
    this.integrationLog('PROJECT_1', 'communication-results.demo', inserted);
    this.audit('DEMO_PROJECT1_COMPLETED', { inserted });
    return { inserted, totalResults: this.store.communicationResults.size };
  }

  simulateProject8() {
    this.assertEnabled();
    let inserted = 0;
    let selected = 0;
    for (const student of this.store.students.values()) {
      if (!student.interviewEligible) continue;
      const attemptId = `DEMO-P8-${student.studentId}-1`;
      const communication = [...this.store.communicationResults.values()].find((result) => result.studentId === student.studentId);
      if (!communication || this.store.interviewResults.has(attemptId)) {
        if (student.selected) selected++;
        continue;
      }
      const score = Math.round(student.codingScore * 0.5 + communication.score * 0.5);
      const outcome: InterviewResult['outcome'] = score >= 78 ? 'PASS' : score >= 68 ? 'WAITLIST' : 'FAIL';
      this.store.interviewResults.set(attemptId, {
        attemptId, studentId: student.studentId, score, outcome, interviewedAt: new Date().toISOString(), notes: 'Dependency simulator result',
      });
      student.selected = outcome === 'PASS';
      if (student.selected) selected++;
      inserted++;
    }
    this.integrationLog('PROJECT_8', 'interview-results.demo', inserted);
    this.audit('DEMO_PROJECT8_COMPLETED', { inserted, selected });
    return { inserted, selected, totalAttempts: this.store.interviewResults.size };
  }

  runDependencySimulation() {
    const project2 = this.bootstrap();
    const eligibility = this.evaluateEligibility();
    const project1 = this.simulateProject1();
    const project8 = this.simulateProject8();
    return { mode: 'DEMO_ONLY', project2, eligibility, project1, project8 };
  }

  status() {
    return { enabled: this.enabled(), missingDependencies: ['PROJECT_1', 'PROJECT_2', 'PROJECT_8', 'MEMBER_1_RULE_ENGINE', 'MEMBER_2_RANKING_ALLOCATION'] };
  }

  private failureReasons(student: CanonicalStudent) {
    const reasons: string[] = [];
    if (student.codingScore < 70) reasons.push('Coding score below demo threshold 70');
    if (student.attendancePercent < 75) reasons.push('Attendance below demo threshold 75%');
    if (!student.completedCertificates.length) reasons.push('No prerequisite certificate recorded');
    if (!student.preferences.length) reasons.push('No domain preference recorded');
    return reasons;
  }

  private audit(type: string, details: unknown) {
    this.store.auditEvents.push({ type, actorId: 'dependency-simulator', entityId: randomUUID(), details, at: new Date().toISOString() });
    this.store.persist();
  }

  private integrationLog(source: SourceCode, operation: string, recordCount: number) {
    const now = new Date().toISOString();
    const status: IntegrationLog['status'] = recordCount > 0 ? 'SUCCEEDED' : 'DUPLICATE';
    this.store.logs.push({ id: randomUUID(), source, operation, method: 'API', status, recordCount, startedAt: now, endedAt: now, requestId: `demo-${randomUUID()}` });
  }

  private enabled() { return (process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true'; }
  private assertEnabled() { if (!this.enabled()) throw new ForbiddenException('Dependency simulator is disabled'); }
}
