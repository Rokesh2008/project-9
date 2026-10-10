import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthPrincipal } from './auth/auth.service';
import { PrismaService } from './common/prisma.service';

export class CreateManagedCycleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,63}$/) code!: string;
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @MaxLength(80) academicPeriod!: string;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiProperty() @IsDateString() endDate!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) hopeCount!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) pepCount!: number;
  @ApiProperty({enum:['ALL','BATCH','CYCLE','SELECTED']}) @IsIn(['ALL','BATCH','CYCLE','SELECTED']) cohort!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() batchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateCycleId?: string;
  @ApiPropertyOptional({type:[String]}) @IsOptional() @IsArray() @ArrayMaxSize(10000) @IsString({each:true}) studentIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(250) readinessMinimum?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() copyPreferences?: boolean;
}
export class ActivateManagedCycleDto {
  @ApiPropertyOptional({default:false}) @IsOptional() @IsBoolean() archiveOtherActive?: boolean;
}
@Injectable()
export class CycleManagementService {
  constructor(private readonly db: PrismaService) {}
  private admin(user: AuthPrincipal) { if(user?.role!=='ADMIN') throw new ForbiddenException('Administrator role required'); }
  private cohort(): Prisma.StudentWhereInput { return {isActive:true,NOT:{studentId:{startsWith:'RULEDEMO-'}},batch:{academicYear:{not:'DEMO'}}}; }
  async options(user: AuthPrincipal) {
    this.admin(user);
    const [cycles,batches]=await Promise.all([
      this.db.selectionCycle.findMany({orderBy:{createdAt:'desc'},include:{_count:{select:{studentCycleStatuses:true}},cycleConfig:{include:{activeWeightVersion:{include:{weights:true}},activeEligibilityRule:true}}}}),
      this.db.batch.findMany({where:{academicYear:{not:'DEMO'},students:{some:{isActive:true}}},orderBy:{batchIdentifier:'asc'},select:{id:true,batchIdentifier:true,academicYear:true,department:{select:{name:true}},_count:{select:{students:{where:{isActive:true}}}}}}),
    ]);return {cycles,batches};
  }
  async students(user: AuthPrincipal,query='',page=1) {
    this.admin(user);const q=query.trim().slice(0,100),p=Number.isInteger(page)&&page>0?page:1;
    const where:Prisma.StudentWhereInput={...this.cohort(),...(q?{OR:[{studentId:{contains:q,mode:'insensitive'}},{registerNumber:{contains:q,mode:'insensitive'}},{name:{contains:q,mode:'insensitive'}},{user:{is:{loginIdentifier:{contains:q,mode:'insensitive'}}}}]}:{})};
    const [total,students]=await Promise.all([this.db.student.count({where}),this.db.student.findMany({where,skip:(p-1)*25,take:25,orderBy:{studentId:'asc'},select:{id:true,studentId:true,registerNumber:true,name:true,user:{select:{loginIdentifier:true}}}})]);return {total,page:p,pageSize:25,students};
  }
  async create(input:CreateManagedCycleDto,user:AuthPrincipal) {
    this.admin(user);
    if(!input.name.trim()||!input.academicPeriod.trim())throw new BadRequestException('Name and academic period are required');
    if(new Date(input.endDate)<=new Date(input.startDate))throw new BadRequestException('End date must be after start date');
    if(input.cohort==='BATCH'&&!input.batchId)throw new BadRequestException('Choose a batch');
    if(input.cohort==='CYCLE'&&!input.templateCycleId)throw new BadRequestException('Choose a source cycle');
    if(input.cohort==='SELECTED'&&!input.studentIds?.length)throw new BadRequestException('Choose students');
    if(input.copyPreferences&&!input.templateCycleId)throw new BadRequestException('Preference copying requires a source cycle');
    return this.db.atomic(async()=>{
      await this.lock();
      if(await this.db.selectionCycle.findUnique({where:{code:input.code}}))throw new ConflictException('Cycle code already exists');
      if(input.templateCycleId)await this.db.$queryRaw`SELECT id FROM "SelectionCycle" WHERE id=${input.templateCycleId} FOR UPDATE`;
      const template=input.templateCycleId?await this.db.selectionCycle.findUnique({where:{id:input.templateCycleId},include:{cycleConfig:{include:{activeWeightVersion:{include:{weights:true}},activeEligibilityRule:true}}}}):null;
      if(input.templateCycleId&&!template)throw new NotFoundException('Source cycle not found');
      const config=template?.cycleConfig;
      if(template&&(!config?.activeWeightVersion?.weights.length||!config.activeEligibilityRule))throw new BadRequestException('Source cycle needs weights and baseline eligibility');
      const where:Prisma.StudentWhereInput={...this.cohort(),...(input.cohort==='BATCH'?{batchId:input.batchId}:{}),...(input.cohort==='CYCLE'?{cycleStatuses:{some:{selectionCycleId:input.templateCycleId}}}:{}),...(input.cohort==='SELECTED'?{id:{in:input.studentIds}}:{})};
      const students=await this.db.student.findMany({where,select:{id:true}});
      if(!students.length)throw new BadRequestException('No active non-synthetic students match');
      if(input.cohort==='SELECTED'&&students.length!==new Set(input.studentIds).size)throw new BadRequestException('Some selected students are missing, inactive or synthetic');
      const cycle=await this.db.selectionCycle.create({data:{code:input.code,name:input.name.trim(),academicPeriod:input.academicPeriod.trim(),startDate:new Date(input.startDate),endDate:new Date(input.endDate),status:'DRAFT'}});
      const weights=await this.db.weightVersion.create({data:{selectionCycleId:cycle.id,version:1,createdBy:user.sub,description:template?`Copied scoring from ${template.code}`:'Verified readiness / 250, weight 100%',weights:{create:config?.activeWeightVersion?.weights.map(w=>({parameterKey:w.parameterKey,parameterLabel:w.parameterLabel,weight:w.weight,maxRawScore:w.maxRawScore,sortOrder:w.sortOrder}))??[{parameterKey:'readinessScore',parameterLabel:'Verified readiness total',weight:1,maxRawScore:250,sortOrder:0}]}}});
      const baseline=await this.db.eligibilityRuleVersion.create({data:{selectionCycleId:cycle.id,version:1,createdBy:user.sub,isActive:true,description:template?`Copied baseline from ${template.code}`:'Verified readiness must meet the configured minimum',rules:config?.activeEligibilityRule?.rules??{logic:'AND',rules:[{id:'readiness-minimum',field:'readinessScore',operator:'GTE',value:input.readinessMinimum??0}]}}});
      await this.db.cycleConfig.create({data:{selectionCycleId:cycle.id,activeWeightVersionId:weights.id,eligibilityRuleVersionId:baseline.id,hopeCount:input.hopeCount,pepCount:input.pepCount}});
      for(let i=0;i<students.length;i+=1000)await this.db.studentCycleStatus.createMany({data:students.slice(i,i+1000).map(s=>({studentId:s.id,selectionCycleId:cycle.id,currentState:'IMPORTED'}))});
      let preferencesCopied=0;
      if(input.copyPreferences&&template)preferencesCopied=await this.db.$executeRaw`INSERT INTO "StudentPreference" (id,"studentId","selectionCycleId","domainId","preferenceRank","createdAt","updatedAt") SELECT gen_random_uuid()::text,p."studentId",${cycle.id},p."domainId",p."preferenceRank",NOW(),NOW() FROM "StudentPreference" p JOIN "StudentCycleStatus" s ON s."studentId"=p."studentId" AND s."selectionCycleId"=${cycle.id} WHERE p."selectionCycleId"=${template.id}`;
      await this.audit(cycle.id,'CYCLE_CREATED',user,{enrolled:students.length,preferencesCopied,templateCycleId:template?.id??null,customPoliciesCopied:false});
      return {...cycle,enrolled:students.length,preferencesCopied,selectionRecalculated:false};
    });
  }
  async activate(id:string,archiveOtherActive:boolean,user:AuthPrincipal) {
    this.admin(user);return this.db.atomic(async()=>{
      await this.lock();await this.db.$queryRaw`SELECT id FROM "SelectionCycle" WHERE id=${id} FOR UPDATE`;
      const cycle=await this.db.selectionCycle.findUnique({where:{id},include:{cycleConfig:{include:{activeWeightVersion:{include:{weights:true}},activeEligibilityRule:true}},_count:{select:{studentCycleStatuses:true}}}});
      if(!cycle)throw new NotFoundException('Cycle not found');
      if(cycle.academicPeriod==='DEMO')throw new BadRequestException('The isolated synthetic demo cannot become the official active cycle');
      if(cycle.status==='ACTIVE')return cycle;
      if(cycle.status!=='DRAFT')throw new BadRequestException('Only drafts can be activated');
      if(!cycle._count.studentCycleStatuses||!cycle.cycleConfig?.activeWeightVersion?.weights.length||!cycle.cycleConfig.activeEligibilityRule?.isActive)throw new BadRequestException('Enrollment, weights and active baseline required');
      if(await this.db.freezeSchedule.findFirst({where:{selectionCycleId:id,status:'EXECUTED'}}))throw new BadRequestException('A cycle with executed freeze history cannot be activated');
      const others=await this.db.selectionCycle.findMany({where:{status:'ACTIVE',id:{not:id}},select:{id:true}});
      if(others.length&&!archiveOtherActive)throw new ConflictException('Confirm archiving the currently active cycle first');
      if(others.length){await this.db.selectionCycle.updateMany({where:{id:{in:others.map(c=>c.id)}},data:{status:'ARCHIVED'}});for(const c of others)await this.audit(c.id,'CYCLE_ARCHIVED_FOR_ACTIVATION',user,{newActiveCycleId:id});}
      const active=await this.db.selectionCycle.update({where:{id},data:{status:'ACTIVE'}});
      await this.audit(id,'CYCLE_ACTIVATED',user,{archivedCycleIds:others.map(c=>c.id)});return active;
    });
  }
  private lock(){return this.db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('project9:cycle-management',0))::text`;}
  private audit(id:string,action:string,user:AuthPrincipal,metadata:Prisma.InputJsonObject){return this.db.scoreAuditLog.create({data:{selectionCycleId:id,entityType:'SelectionCycle',entityId:id,action,actor:user.sub,role:'ADMIN',metadata}});}
}
@ApiTags('Cycle Management') @ApiBearerAuth() @Controller('cycle-management')
export class CycleManagementController {
  constructor(private readonly cycles:CycleManagementService){}
  @Get('options') options(@Req() req:{user:AuthPrincipal}){return this.cycles.options(req.user);}
  @Get('students') students(@Req() req:{user:AuthPrincipal},@Query('q') q?:string,@Query('page') page?:string){return this.cycles.students(req.user,q,Number(page??1));}
  @Post() create(@Body() input:CreateManagedCycleDto,@Req() req:{user:AuthPrincipal}){return this.cycles.create(input,req.user);}
  @Post(':id/activate') activate(@Param('id') id:string,@Body() input:ActivateManagedCycleDto,@Req() req:{user:AuthPrincipal}){return this.cycles.activate(id,input.archiveOtherActive===true,req.user);}
}
