import { identityIndex, mapRecord, SkipRecord } from '../src/external-scores/mappers';
import { ExternalScoresController } from '../src/external-scores/external-scores.controller';
import { ExternalScoresService } from '../src/external-scores/external-scores.service';
import { READINESS_PARAMETERS } from '../src/readiness/readiness.catalog';
const student={id:'s1',studentId:'REG1',registerNumber:'REG1'};
const resolve=identityIndex([student],[{externalId:'ROLL1',internalId:'s1'}]);
const now=new Date('2026-10-07T00:00:00Z');
const interview={candidateRollNo:'ROLL1',attemptStatus:'COMPLETED',sessionId:'session',overallScore:8,endedAt:now.toISOString()};
describe('External score pull safety',()=>{
  it('matches exact roster roll aliases',()=>expect(resolve(['roll1']).id).toBe('s1'));
  it('never matches a name',()=>expect(()=>resolve(['Alice'])).toThrow(SkipRecord));
  it('rejects ambiguous aliases',()=>expect(()=>identityIndex([student,{id:'s2',studentId:'REG2',registerNumber:'REG2'}],[{externalId:'ROLL1',internalId:'s1'},{externalId:'ROLL1',internalId:'s2'}])(['ROLL1'])).toThrow('ambiguous'));
  it('normalizes interview scores from ten to hundred',()=>expect(mapRecord('INTERVIEW',interview,resolve,now).score).toBe(80));
  it.each([null,NaN,11,-1,'8'])('rejects missing or invalid score %s',score=>expect(()=>mapRecord('INTERVIEW',{...interview,overallScore:score},resolve,now)).toThrow(SkipRecord));
  it('rejects malpractice',()=>expect(()=>mapRecord('INTERVIEW',{...interview,isMalpractice:true},resolve,now)).toThrow('blocked'));
  it('rejects incomplete sessions',()=>expect(()=>mapRecord('INTERVIEW',{...interview,attemptStatus:'IN_PROGRESS'},resolve,now)).toThrow('incomplete'));
  it('deduplicates unchanged content across fetch dates',()=>expect(mapRecord('INTERVIEW',interview,resolve,now).sourceResultId).toBe(mapRecord('INTERVIEW',interview,resolve,new Date()).sourceResultId));
  it('requires all twelve parameters',()=>expect(()=>mapRecord('READINESS',{roll_number:'ROLL1',parameter_marks:[],max_possible_marks:250},resolve,now)).toThrow('invalid'));
  it('keeps unverified readiness marks pending and deduplicates without an assessment timestamp',()=>{
    const ids=['hundred_days','language','gate','competition','internship','certificate','aptitude','coding_problems','cp_rating','opensource','monthly_coding','project'];
    const row={roll_number:'ROLL1',total_marks:0,max_possible_marks:250,parameter_marks:READINESS_PARAMETERS.map((p,i)=>({parameter_id:ids[i],marks_obtained:0,max_marks:p.maxScore}))};
    const candidate=mapRecord('READINESS',row,resolve,now);
    expect(candidate.verificationStatus).toBe('PENDING');expect(candidate.parameters).toHaveLength(12);
    expect(candidate.sourceResultId).toBe(mapRecord('READINESS',row,resolve,new Date()).sourceResultId);
    expect(()=>mapRecord('READINESS',{...row,total_marks:1},resolve,now)).toThrow('invalid');
  });
  it('keeps credentials and private evidence out of imported metadata',()=>expect(JSON.stringify(mapRecord('INTERVIEW',{...interview,candidateEmail:'private',violationDetails:'private'},resolve,now).metadata)).not.toContain('private'));
  it('denies faculty and students permission to fetch',()=>{
    const controller=new ExternalScoresController({sync:jest.fn()} as any);
    for(const role of ['STUDENT','PEP_STAFF'])expect(()=>controller.fetch({}, {user:{role} as any})).toThrow('Administrator');
  });
});
describe('External score fetching',()=>{
 const originalEnv={...process.env};
 afterEach(()=>{process.env={...originalEnv};jest.restoreAllMocks();});
 function setup(){
  process.env.SPEAKREADY_URL='https://source.example';process.env.SPEAKREADY_API_KEY='private-key';
  const db={student:{findMany:jest.fn().mockResolvedValue([student])},externalReference:{findMany:jest.fn().mockResolvedValue([])},
   integrationSource:{upsert:jest.fn().mockResolvedValue({id:'source'})},integrationJob:{create:jest.fn().mockResolvedValue({id:'job'}),update:jest.fn(),findFirst:jest.fn().mockResolvedValue(null),updateMany:jest.fn()},integrationLog:{create:jest.fn()},
   $executeRaw:jest.fn().mockResolvedValue(1),$transaction:jest.fn(),
   assessmentResult:{createMany:jest.fn().mockResolvedValue({count:1})}};
  db.$transaction.mockImplementation(async fn=>fn(db));
  const row={register_no:'REG1',readiness:{score:75,updated_at:now.toISOString()}};
  const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(Response.json({students:[row],next_page:null}));
  return {db,fetchMock,service:new ExternalScoresService(db as any)};
 }
 it('previews without writing assessments and uses GET with server key',async()=>{
  const {db,fetchMock,service}=setup();const result=await service.sync('SPEAKREADY',true);
  expect(result.summaries[0].matched).toBe(1);expect(db.assessmentResult.createMany).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({'x-api-key':'private-key'});
  expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
 });
 it('imports with duplicate protection without changing official outcomes',async()=>{
  const {db,service}=setup();const result=await service.sync('SPEAKREADY');
  expect(db.assessmentResult.createMany).toHaveBeenCalledWith(expect.objectContaining({skipDuplicates:true}));
  expect(result.selectionRecalculated).toBe(false);expect(result.allocationsChanged).toBe(false);expect(result.summaries[0].inserted).toBe(1);
 });
 it('handles upstream authentication failure without echoing its body',async()=>{
  const {fetchMock,service}=setup();fetchMock.mockResolvedValue(new Response('private-key student data',{status:401}));
  const result=await service.sync('SPEAKREADY');expect(result.summaries[0].status).toBe('FAILED');expect(JSON.stringify(result)).not.toContain('private-key');
 });
 it('rejects plaintext HTTP unless explicitly enabled',async()=>{
  const {fetchMock,service}=setup();process.env.SPEAKREADY_URL='http://source.example';delete process.env.EXTERNAL_SCORES_ALLOW_HTTP;
  expect((await service.sync('SPEAKREADY')).summaries[0].status).toBe('FAILED');expect(fetchMock).not.toHaveBeenCalled();
 });
 it('does not contact upstream when another instance owns the source lease',async()=>{
  const {db,fetchMock,service}=setup();db.integrationJob.findFirst.mockResolvedValue({id:'other'} as never);
  expect((await service.sync('SPEAKREADY')).summaries[0].error).toContain('already running');expect(fetchMock).not.toHaveBeenCalled();
 });
});
