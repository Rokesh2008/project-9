import {ProfilesService} from '../src/profiles/profiles.service';
import {AuthPrincipal} from '../src/auth/auth.service';
describe('Unified student directory',()=>{
 const admin={role:'ADMIN'} as AuthPrincipal;
 function setup(){const row={studentId:'24AD107',registerNumber:null,name:'Example',department:'AD',departmentName:'AI & DS',batch:'2028',rollNumber:'24AD107',readinessScore:0,verificationStatus:'PENDING',trainingGroup:null,allocationStatus:'NOT_ALLOCATED'};const db={$queryRaw:jest.fn().mockResolvedValueOnce([{total:4909n}]).mockResolvedValueOnce([row])};return {db,row,service:new ProfilesService(db as any)};}
 it('includes students outside cycles and pages the complete population in two queries',async()=>{const {db,service}=setup();const result=await service.listForStaff(admin,'',2);expect(result).toMatchObject({total:4909,page:2,pageSize:25});expect(db.$queryRaw).toHaveBeenCalledTimes(2);const sql=db.$queryRaw.mock.calls[1][0];expect(sql.values.slice(-2)).toEqual([25,25]);expect(sql.strings.join('?')).not.toContain('StudentCycleStatus');expect(result.students[0]).toMatchObject({rollNumber:'24AD107',readinessScore:0,registerNumber:null,trainingGroup:null});});
 it('searches actual roll logins as well as names and register numbers using bound values',async()=>{const {db,service}=setup();await service.listForStaff(admin,'25AD101');for(const [sql] of db.$queryRaw.mock.calls){expect(sql.strings.join('?')).toContain('u."loginIdentifier" ILIKE');expect(sql.strings.join('?')).not.toContain('25AD101');expect(sql.values).toContain('%25AD101%');}});
 it('retains existing allocations without requiring cycle enrollment',async()=>{const {db,row,service}=setup();db.$queryRaw.mockReset().mockResolvedValueOnce([{total:4909n}]).mockResolvedValueOnce([{...row,trainingGroup:'HOPE Elite',allocationStatus:'EXISTING_ALLOCATION',readinessScore:null}]);const result=await service.listForStaff(admin);expect(result.students[0]).toMatchObject({trainingGroup:'HOPE Elite',allocationStatus:'EXISTING_ALLOCATION',readinessScore:null});});
 it('rejects student directory access',async()=>{const {service}=setup();await expect(service.listForStaff({role:'STUDENT'} as AuthPrincipal)).rejects.toThrow('Staff access required');});
 it.each(['asc','desc'])('sorts the full population by latest readiness %s before paging',async direction=>{
   const {db,service}=setup();
   await service.listForStaff(admin,"25AD%_'",2,`readiness_${direction}`);
   const sql=db.$queryRaw.mock.calls[1][0];
   expect(sql.strings.join('?')).toContain(`${direction.toUpperCase()} NULLS LAST`);
   expect(sql.strings.join('?')).toContain('LEFT JOIN LATERAL');
   expect(sql.strings.join('?')).not.toContain("25AD%_'");
   expect(sql.values).toEqual(expect.arrayContaining(["25AD%_'",25]));
   expect(sql.values.slice(-2)).toEqual([25,25]);
 });
 it('falls back to default ordering for an unknown sort without interpolating it',async()=>{const {db,service}=setup();await service.listForStaff(admin,'',1,'DROP TABLE');const sql=db.$queryRaw.mock.calls[1][0];expect(sql.strings.join('?')).not.toContain('DROP TABLE');expect(sql.strings.join('?')).toContain('ORDER BY s."studentId" ASC');});
});
