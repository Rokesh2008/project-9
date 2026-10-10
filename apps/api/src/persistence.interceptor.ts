import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable, concatMap, defer, lastValueFrom } from 'rxjs';
import { Store } from './store';
import { PrismaService } from './common/prisma.service';
import { StateScope } from './shared-state';

@Injectable()
export class PersistenceInterceptor implements NestInterceptor {
  constructor(private readonly store: Store, @Optional() private readonly db?: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request=context.switchToHttp?.().getRequest<{path?:string;method?:string;body?:Record<string,unknown>;params?:Record<string,string>;headers?:Record<string,string|undefined>}>();
    const path=request?.path??'';
    if (this.store.horizontal) {
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(request?.method ?? 'GET');
      const scopes = this.scopes(path, request?.params, request?.body, request?.headers);
      return defer(async () => {
        const execute = async () => {
          if (write) await this.lockCycle(path, request?.params, request?.body, request?.headers);
          return scopes.length
            ? this.store.scoped(scopes, write, () => lastValueFrom(next.handle()))
            : lastValueFrom(next.handle());
        };
        try {
          // Only writes requiring coordinated business invariants hold a SQL
          // transaction. Directory/auth/profile reads remain independent.
          return write && this.coordinated(path) ? await this.db!.atomic(execute) : await execute();
        } catch (error) {
          const known = error as {code?:string;meta?:{code?:string}};
          if (known.code === 'P2034' || known.code === 'P2002' || known.meta?.code === '23505' || known.meta?.code === '55P03') throw new ConflictException('Concurrent change detected; refresh and retry');
          throw error;
        }
      });
    }
    // Reads do not mutate the legacy snapshot and must not queue behind long
    // imports/selection. Keep writes serialized against legacy freeze/imports.
    if (request?.method === 'GET' || request?.method === 'HEAD') return next.handle();
    if(/^\/api\/(integrations|students|demo|agent|reports|allocations|selection-pipeline|cycles|weights|eligibility|scoring|ranking|classification|freeze|snapshot)(\/|$)/.test(path)) {
      return defer(()=>this.store.runExclusive(async()=>{
        try{return await lastValueFrom(next.handle());}finally{await this.store.flush();}
      }));
    }
    return next.handle().pipe(concatMap(async result => {
      await this.store.flush();
      return result;
    }));
  }

  private coordinated(path: string) {
    return /^\/api\/(integrations|students|ai|demo|agent|allocations|selection-pipeline|selection-rules|cycles|weights|eligibility|scoring|ranking|classification|freeze)(\/|$)/.test(path);
  }

  private scopes(path: string, params: Record<string,string> = {}, body: Record<string,unknown> = {}, headers: Record<string,string|undefined> = {}): StateScope[] {
    if (/^\/api\/agent\//.test(path)) return [
      {namespace:'students'}, {namespace:'analyses'}, {namespace:'recommendations'}, {namespace:'allocations'},
    ];
    if (/^\/api\/ai\//.test(path)) return ['students','analyses','allocations'].map(namespace => ({namespace:namespace as StateScope['namespace']}));
    if (/^\/api\/students(?:\/|$)/.test(path)) return [
      {namespace:'students',keys:params.id ? [params.id] : undefined},
      {namespace:'analyses',keys:params.id ? [params.id] : undefined},
      {namespace:'allocations',keys:params.id ? [params.id] : undefined},
      {namespace:'communicationResults'}, {namespace:'interviewResults'},
    ];
    if (/^\/api\/integrations\/(project[128]\/(students|results)|import\/excel)$/.test(path)) {
      const records = Array.isArray(body.records) ? body.records as Array<Record<string,unknown>> : undefined;
      return [
        {namespace:'students',keys:records?.map(row => String(row.studentId))},
        {namespace:'communicationResults',keys:records?.flatMap(row => typeof row.resultId === 'string' ? [row.resultId] : [])},
        {namespace:'interviewResults',keys:records?.flatMap(row => typeof row.attemptId === 'string' ? [row.attemptId] : [])},
        {namespace:'idempotency',keys:headers['idempotency-key'] ? [headers['idempotency-key']] : []},
      ];
    }
    if (path === '/api/integrations/logs' || path === '/api/reports/selection-summary') return [{namespace:'logs'}];
    return [];
  }

  private async lockCycle(path: string, params: Record<string,string> = {}, body: Record<string,unknown> = {}, headers: Record<string,string|undefined> = {}) {
    if (!this.coordinated(path) || !this.db) return;
    let cycleId: string | undefined = typeof body.selectionCycleId === 'string' ? body.selectionCycleId : params.selectionCycleId;
    if (/\/selection-pipeline\/demo\//.test(path)) cycleId = params.id;
    if (/\/allocations\//.test(path) && params.id) cycleId = (await this.db.allocation.findUnique({where:{id:params.id},select:{selectionCycleId:true}}))?.selectionCycleId;
    if (/\/agent\/selection\/recommendations\//.test(path) && params.id) {
      const row = await this.db.$queryRaw<Array<{cycleId:string}>>`SELECT "value"->>'selectionCycleId' AS "cycleId" FROM "SharedStateRecord" WHERE "namespace" = 'recommendations' AND "key" = ${params.id}`;
      cycleId = row[0]?.cycleId;
    }
    if (path === '/api/weights/activate' && typeof body.weightVersionId === 'string') cycleId = (await this.db.weightVersion.findUnique({where:{id:body.weightVersionId},select:{selectionCycleId:true}}))?.selectionCycleId;
    if (path === '/api/eligibility/rules/activate' && typeof body.ruleVersionId === 'string') cycleId = (await this.db.eligibilityRuleVersion.findUnique({where:{id:body.ruleVersionId},select:{selectionCycleId:true}}))?.selectionCycleId;
    if (cycleId) await this.db.$queryRaw`SELECT "id" FROM "SelectionCycle" WHERE "id" = ${cycleId} FOR UPDATE`;
    else if (/^\/api\/(agent|integrations)\//.test(path)) await this.db.$queryRaw`SELECT "id" FROM "SelectionCycle" WHERE "status" = 'ACTIVE' ORDER BY "id" FOR UPDATE`;
    const key = headers['idempotency-key'];
    if (path.startsWith('/api/integrations/') && key) {
      // Transaction-scoped, works through PgBouncer; no session lock leakage.
      await this.db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${key}`}, 0))::text`;
    }
  }
}
