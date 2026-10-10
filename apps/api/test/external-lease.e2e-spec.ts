import { PrismaService } from '../src/common/prisma.service';
import { ExternalScoresService } from '../src/external-scores/external-scores.service';
describe('Cross-instance external-fetch lease',()=>{
 const db=new PrismaService();const original={...process.env};
 beforeAll(async()=>{await db.$connect();process.env.SPEAKREADY_URL='https://source.example';process.env.SPEAKREADY_API_KEY='test-only';});
 afterAll(async()=>{
  const source=await db.integrationSource.findUnique({where:{code:'PULL_SPEAKREADY'}});
  if(source){await db.integrationLog.deleteMany({where:{job:{sourceId:source.id,operation:'external-scores.pull'}}});await db.integrationJob.deleteMany({where:{sourceId:source.id,operation:'external-scores.pull'}});}
  await db.$disconnect();process.env={...original};jest.restoreAllMocks();
 });
 it('allows only one worker per source across independent service instances',async()=>{
  let release!:(response:Response)=>void,notify!:()=>void;
  const started=new Promise<void>(r=>notify=r);
  const fetchMock=jest.spyOn(global,'fetch').mockImplementation(()=>{notify();return new Promise(r=>release=r);});
  const first=new ExternalScoresService(db),second=new ExternalScoresService(db);
  const pending=first.sync('SPEAKREADY',true);await started;
  try {
   const blocked=await second.sync('SPEAKREADY',true);
   expect(blocked.summaries[0].error).toContain('already running');expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { release(Response.json({students:[],next_page:null})); }
  expect((await pending).summaries[0].status).toBe('SUCCEEDED');
 });
});
