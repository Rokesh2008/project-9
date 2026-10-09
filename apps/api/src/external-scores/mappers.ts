import { createHash } from 'node:crypto';
import { READINESS_PARAMETERS } from '../readiness/readiness.catalog';
export type Source = 'SPEAKREADY' | 'READINESS' | 'INTERVIEW';
export type Row = Record<string, any>;
export type StudentIdentity = { id: string; studentId: string; registerNumber: string | null };
export type Candidate = {
  student: StudentIdentity; sourceResultId: string; assessedAt: Date;
  type: 'COMMUNICATION' | 'INTERVIEW' | 'READINESS'; score: number; maxScore: number;
  verificationStatus: 'PENDING' | 'VERIFIED'; metadata: Row;
  parameters?: Array<{ parameterKey: string; rawScore: number; verificationStatus: 'PENDING' | 'VERIFIED' }>;
};
export class SkipRecord extends Error {
  constructor(public readonly reason: 'unmatched' | 'ambiguous' | 'incomplete' | 'blocked' | 'invalid') { super(reason); }
}
export const identifier = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v).trim().toUpperCase() : '';
export function identityIndex(students: StudentIdentity[], aliases: Array<{ externalId: string; internalId: string }>) {
  const index = new Map<string, Set<string>>(), byId = new Map(students.map(s => [s.id, s]));
  const add = (key: string, id: string) => { if (!key) return; const ids = index.get(key) ?? new Set<string>(); ids.add(id); index.set(key, ids); };
  for (const s of students) { add(identifier(s.registerNumber), s.id); add(identifier(s.studentId), s.id); }
  for (const a of aliases) if (byId.has(a.internalId)) add(identifier(a.externalId), a.internalId);
  return (values: unknown[]) => {
    const found = new Set(values.flatMap(v => [...(index.get(identifier(v)) ?? [])]));
    if (found.size !== 1) throw new SkipRecord(found.size ? 'ambiguous' : 'unmatched');
    return byId.get([...found][0])!;
  };
}
function score(v: unknown, max: number) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new SkipRecord('invalid');
  return v;
}
function date(v: unknown, fallback?: Date) {
  if (v == null && fallback) return fallback;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw new SkipRecord('incomplete');
  const result = new Date(v); if (!Number.isFinite(result.getTime())) throw new SkipRecord('invalid'); return result;
}
function fingerprint(source: Source, identity: unknown, content: Row) {
  return `pull:${source}:${createHash('sha256').update(JSON.stringify([identifier(identity), content])).digest('hex')}`;
}
const PARAMETER_MAP: Record<string, string> = {
  coding_problems:'coding_problems',cp_rating:'competitive_rating',opensource:'open_source_contributions',
  competition:'competitions_hackathons',internship:'internship_startup',project:'project_publication_patent',
  language:'foreign_language',gate:'gate_higher_studies',monthly_coding:'monthly_coding_assessment',
  hundred_days:'hundred_days_training',aptitude:'aptitude_communication',certificate:'industry_academic_certificates',
};
export function mapRecord(source: Source, row: Row, resolve: ReturnType<typeof identityIndex>, fetchedAt: Date): Candidate {
  if (source === 'READINESS') {
    const student = resolve([row.roll_number, row.register_number]);
    if (!Array.isArray(row.parameter_marks) || row.parameter_marks.length !== 12 || row.max_possible_marks !== 250) throw new SkipRecord('invalid');
    const seen = new Set<string>();
    const parameters: NonNullable<Candidate['parameters']> = row.parameter_marks.map((p: Row): NonNullable<Candidate['parameters']>[number] => {
      const key = PARAMETER_MAP[p.parameter_id], catalog = READINESS_PARAMETERS.find(c => c.key === key);
      if (!catalog || seen.has(key) || p.max_marks !== catalog.maxScore) throw new SkipRecord('invalid');
      seen.add(key);
      return { parameterKey:key,rawScore:score(p.marks_obtained,catalog.maxScore),verificationStatus:p.verification_status === 'VERIFIED' ? 'VERIFIED' : 'PENDING' };
    }).sort((a: {parameterKey:string}, b: {parameterKey:string}) => a.parameterKey.localeCompare(b.parameterKey));
    const total = score(row.total_marks,250);
    if (Math.abs(parameters.reduce((sum,p) => sum+p.rawScore,0)-total)>0.01) throw new SkipRecord('invalid');
    const verified = row.verification_status === 'VERIFIED' && parameters.every(p=>p.verificationStatus==='VERIFIED');
    const content = {score:total,parameters,verificationStatus:verified?'VERIFIED':'PENDING',sourceAssessedAt:row.assessed_at??null};
    return {student,type:'READINESS',score:total,maxScore:250,parameters,verificationStatus:verified?'VERIFIED':'PENDING',
      assessedAt:date(row.assessed_at,fetchedAt),sourceResultId:fingerprint(source,row.roll_number,content),
      metadata:{source,sourceLevel:row.level??null,timestampKind:row.assessed_at?'SOURCE_ASSESSMENT':'FETCH_TIME'}};
  }
  if (source === 'SPEAKREADY') {
    const student=resolve([row.register_no]);
    if (row.malpractice_confirmed===true) throw new SkipRecord('blocked');
    const interviews:Row[]=Array.isArray(row.interviews)?row.interviews:[];
    if(interviews.some(i=>['flagged','needs_review','confirmed_cheating'].includes(i.integrity_status)))throw new SkipRecord('blocked');
    if(row.readiness?.score==null)throw new SkipRecord('incomplete');
    const total=score(row.readiness.score,100),assessedAt=date(row.readiness.updated_at??row.updated_at);
    const content={score:total,level:row.readiness.level??null,assessedAt:assessedAt.toISOString()};
    return {student,type:'COMMUNICATION',score:total,maxScore:100,assessedAt,verificationStatus:'PENDING',sourceResultId:fingerprint(source,row.register_no,content),
      metadata:{source,sourceLevel:row.readiness.level??null,verificationStatus:'IMPORTED',scoreMeaning:'SpeakReady overall communication readiness',
        components:Object.fromEntries(['reading','writing','speaking','interview','listening'].map(k=>[k,typeof row.readiness[k]==='number'?row.readiness[k]:null]))}};
  }
  const student=resolve([row.candidateRollNo,row.registerNumber]);
  if(row.isMalpractice===true)throw new SkipRecord('blocked');
  if(row.attemptStatus!=='COMPLETED'||!row.sessionId||row.overallScore==null)throw new SkipRecord('incomplete');
  const total=score(row.overallScore,10)*10,assessedAt=date(row.endedAt);
  const content={score:total,assessedAt:assessedAt.toISOString(),sessionId:row.sessionId,
    technicalScore:row.technicalScore==null?null:score(row.technicalScore,10),communicationScore:row.communicationScore==null?null:score(row.communicationScore,10)};
  return {student,type:'INTERVIEW',score:total,maxScore:100,assessedAt,verificationStatus:'PENDING',sourceResultId:fingerprint(source,row.sessionId,content),
    metadata:{source,sourceSessionId:row.sessionId,originalScore:row.overallScore,originalMaxScore:10,technicalScore:content.technicalScore,
      communicationScore:content.communicationScore,verificationStatus:'IMPORTED',scoreMeaning:'AI interviewer overall score × 10'}};
}
