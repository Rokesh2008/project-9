/**
 * Official contract interface with Member 3 (Integration Gateway & External Adapters)
 */

export interface ExternalStudentCandidateContract {
  externalId: string;
  sourceCode: string;
  studentId: string;
  name: string;
  email: string;
  departmentCode: string;
  batchIdentifier: string;
  metadata?: Record<string, any>;
}

export interface ExternalAssessmentContract {
  externalId: string;
  sourceCode: string;
  studentId: string;
  assessmentType: string;
  score: number;
  maxScore: number;
  assessmentDate: Date | string;
  metadata?: Record<string, any>;
}
