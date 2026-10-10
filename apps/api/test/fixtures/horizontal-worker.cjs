// Independent OS process used only against the guarded local test database.
require('reflect-metadata');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
      experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true},
  }).outputText;
  module._compile(source, filename);
};
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { AppModule } = require('../../src/app.module.ts');
const { PrismaService } = require('../../src/common/prisma.service.ts');
const { Store } = require('../../src/store.ts');
const { DistributedRateLimiter } = require('../../src/security/distributed-rate-limiter.ts');

let app, store, db;
const send = value => process.send?.(value);
(async () => {
  process.env.AUTH_REQUIRED = 'false';
  process.env.PERSISTENCE_DRIVER = 'postgres';
  process.env.HORIZONTAL_STATE = 'true';
  app = await NestFactory.create(AppModule, {logger:false});
  app.setGlobalPrefix('api');
  await app.listen(0,'127.0.0.1');
  store = app.get(Store); db = app.get(PrismaService);
  send({ready:true,url:await app.getUrl()});
})().catch(error => {send({startupError:error.message});process.exit(1);});

process.on('message', async message => {
  try {
    let result;
    if (message.operation === 'write') {
      result = await store.scoped([{namespace:'allocations',keys:[message.key]}],true,async () => {
        store.allocations.set(message.key,message.value);
        if (message.delay) await new Promise(resolve=>setTimeout(resolve,message.delay));
        store.persist();return 'committed';
      });
    } else if (message.operation === 'read') {
      result = await store.scoped([{namespace:'allocations',keys:[message.key]}],false,async()=>store.allocations.get(message.key));
    } else if (message.operation === 'limit') {
      const limiter = new DistributedRateLimiter(db,'test-signing-secret-must-have-32-characters');
      result = await limiter.consume('test',message.key,message.limit);
    } else if (message.operation === 'atomic-rollback') {
      await store.scoped([{namespace:'allocations',keys:[message.key]}],true,async()=>{
        await db.integrationSource.create({data:{code:message.key,name:'synthetic'}});
        // A nested transaction must join the same outer transaction.
        await db.$transaction(async tx=>tx.integrationSource.update({where:{code:message.key},data:{name:'changed'}}));
        store.allocations.set(message.key,'should-not-exist');
        throw new Error('intentional rollback');
      });
    } else if (message.operation === 'stop') {
      await app.close();process.exit(0);
    }
    send({id:message.id,result});
  } catch(error) {send({id:message.id,error:error.message,status:error.getStatus?.()});}
});
