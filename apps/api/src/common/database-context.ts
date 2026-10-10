import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

// One context across modules/clients. Nested service transactions participate in
// the caller's transaction rather than committing half of a business operation.
export const databaseContext = new AsyncLocalStorage<Prisma.TransactionClient>();
