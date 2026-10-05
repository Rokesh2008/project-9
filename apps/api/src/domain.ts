export type SourceCode = 'PROJECT_2' | 'PROJECT_1' | 'PROJECT_8' | 'EXCEL';
export type JobStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';
export type Program = 'PEP' | 'HOPE' | 'UNASSIGNED';

export interface CanonicalStudent {
  studentId: string;
  registerNumber: string;
  name: string;
  department: string;
  email?: string;
  cgpa: number;
  codingScore: number;
  aptitudeScore: number;
  attendancePercent: number;
  dsaLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  preferences: string[];
  completedCertificates: string[];
  program: Program;
  interviewEligible: boolean;
  selected: boolean;
  sourceUpdatedAt: string;
}

export interface CommunicationResult {
  resultId: string;
  studentId: string;
  score: number;
  level: string;
  assessedAt: string;
}

export interface InterviewResult {
  attemptId: string;
  studentId: string;
  score: number;
  outcome: 'PASS' | 'FAIL' | 'WAITLIST';
  interviewedAt: string;
  notes?: string;
}

export interface IntegrationLog {
  id: string;
  source: SourceCode;
  operation: string;
  method: 'API' | 'CSV' | 'XLSX';
  status: JobStatus;
  recordCount: number;
  startedAt: string;
  endedAt: string;
  requestId: string;
  error?: string;
}

export interface AdvisoryAnalysis {
  studentId: string;
  strengths: string[];
  gaps: string[];
  trend: 'STRONG' | 'STABLE' | 'AT_RISK';
  recommendedDomains: Array<{ domain: string; score: number; reason: string }>;
  generatedAt: string;
  advisoryOnly: true;
}

export interface AgentRecommendation {
  id: string;
  studentId: string;
  recommendedDomain: string;
  rationale: string[];
  conflicts: string[];
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'VERIFIED';
  approvedBy?: string;
  approvedAt?: string;
  verifiedAt?: string;
}

export const DOMAIN_CAPACITIES: Record<string, number> = {
  'PEPC-01 AI/ML': 70,
  'PEPC-02 CCNA': 60,
  'PEPC-03 Cloud & DevOps': 120,
  'PEPC-04 Cybersecurity': 70,
  'PEPC-05 Data Science': 70,
  'PEPC-06 Full Stack MERN': 70,
  'PEPC-07 Full Stack Java': 70,
  'PEPC-08 Mobile Development': 60,
  'PEPC-09 Quantum Computing': 40,
  'PEPC-10 RPA & Agentic AI': 60,
  'PEPC-11 UI/UX Design': 40,
  'PEPC-12 5G/6G': 40,
  'PEPC-13 CAD & 3D Printing': 40,
  'PEPC-14 EV Technology': 50,
  'PEPC-15 Embedded & IoT': 100,
  'PEPC-16 Robotics': 50,
  'PEPC-17 VLSI': 100,
  'PEPC-18 Aerial Vehicles': 50,
};
