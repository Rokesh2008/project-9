import { firstValueFrom, of } from 'rxjs';
import { PersistenceInterceptor } from '../src/persistence.interceptor';
import { Store } from '../src/store';

describe('Serverless PostgreSQL persistence', () => {
  let store: Store;
  let upsert: jest.Mock;

  beforeEach(() => {
    store = new Store();
    upsert = jest.fn().mockResolvedValue({ id: 'main' });
    Object.assign(store, { prisma: { runtimeState: { upsert } } });
  });

  it('persists through PostgreSQL without relying on a writable local directory', async () => {
    Object.assign(store, { stateFile: '/nonexistent-readonly-project9/runtime-state.json' });
    expect(() => store.persist()).not.toThrow();
    await store.flush();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('queues immutable snapshots in submission order', async () => {
    store.allocations.set('test-student', 'first-domain');
    store.persist();
    store.allocations.set('test-student', 'second-domain');
    store.persist();
    await store.flush();
    expect(upsert.mock.calls[0][0].update.payload.allocations).toContainEqual(['test-student', 'first-domain']);
    expect(upsert.mock.calls[1][0].update.payload.allocations).toContainEqual(['test-student', 'second-domain']);
  });

  it('propagates database failures instead of reporting successful persistence', async () => {
    upsert.mockRejectedValue(new Error('database unavailable'));
    store.persist();
    await expect(store.flush()).rejects.toThrow('database unavailable');
  });

  it('can persist again after an earlier failed write', async () => {
    upsert.mockRejectedValueOnce(new Error('temporary failure'));
    store.persist();
    await expect(store.flush()).rejects.toThrow('temporary failure');
    store.persist();
    await expect(store.flush()).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('holds the HTTP response until persistence finishes', async () => {
    let release!: () => void;
    upsert.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    store.persist();
    let completed = false;
    const interceptor = new PersistenceInterceptor(store);
    const response = firstValueFrom(interceptor.intercept({} as never, { handle: () => of('result') }))
      .then(value => { completed = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    expect(completed).toBe(false);
    release();
    await expect(response).resolves.toBe('result');
  });
  it('serializes legacy operations and releases the queue after failures',async()=>{
    const events:string[]=[];let release!:()=>void;
    const first=store.runExclusive(async()=>{events.push('first');await new Promise<void>(r=>release=r);events.push('finished');});
    const second=store.runExclusive(async()=>{events.push('second');throw new Error('expected failure');});
    const failed=expect(second).rejects.toThrow('expected failure');
    await new Promise(r=>setImmediate(r));expect(events).toEqual(['first']);
    release();await first;await failed;
    await store.runExclusive(async()=>{events.push('third');});expect(events).toEqual(['first','finished','second','third']);
  });
  it('allows read-only requests to finish while a legacy write owns the queue',async()=>{
    let release!:()=>void;
    const write=store.runExclusive(()=>new Promise<void>(resolve=>{release=resolve;}));
    await new Promise(resolve=>setImmediate(resolve));
    const interceptor=new PersistenceInterceptor(store);
    const context={switchToHttp:()=>({getRequest:()=>({path:'/api/reports/selection-summary',method:'GET'})})};
    const lock=jest.spyOn(store,'runExclusive');
    const flush=jest.spyOn(store,'flush');
    await expect(firstValueFrom(interceptor.intercept(context as never,{handle:()=>of('read-ready')}))).resolves.toBe('read-ready');
    expect(lock).not.toHaveBeenCalled();expect(flush).not.toHaveBeenCalled();
    release();await write;
  });
});
