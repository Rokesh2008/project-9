import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from './common/prisma.service';

export const mapNamespaces = ['students', 'communicationResults', 'interviewResults', 'idempotency', 'analyses', 'recommendations', 'allocations'] as const;
export const arrayNamespaces = ['logs', 'auditEvents'] as const;
export type StateNamespace = typeof mapNamespaces[number] | typeof arrayNamespaces[number];
type Row = { namespace: StateNamespace; key: string; value: unknown; version: number };
export type StateScope = { namespace: StateNamespace; keys?: string[] };

/** Request-local compatibility view; durable storage is independently versioned
 * per entity. It never writes RuntimeState or a complete process snapshot. */
export class SharedStateSession {
  readonly state: Record<string, unknown> = {};
  private readonly original = new Map<string, Row>();
  private readonly initialArrays = new Map<string, string[]>();

  static async load(db: PrismaService, scopes: StateScope[]) {
    const session = new SharedStateSession();
    for (const name of mapNamespaces) session.state[name] = [];
    for (const name of arrayNamespaces) session.state[name] = [];
    if (!scopes.length) return session;
    const filters = scopes.map(scope => scope.keys
      ? scope.keys.length ? Prisma.sql`("namespace" = ${scope.namespace} AND "key" IN (${Prisma.join(scope.keys)}))` : Prisma.sql`FALSE`
      : Prisma.sql`"namespace" = ${scope.namespace}`);
    const rows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT "namespace", "key", "value", "version" FROM "SharedStateRecord"
      WHERE ${Prisma.join(filters, ' OR ')} ORDER BY "createdAt", "key"
    `);
    for (const row of rows) {
      session.original.set(`${row.namespace}\0${row.key}`, row);
      const array = session.state[row.namespace] as unknown[];
      array.push((mapNamespaces as readonly string[]).includes(row.namespace) ? [row.key, row.value] : row.value);
    }
    for (const name of arrayNamespaces) session.initialArrays.set(name, (session.state[name] as unknown[]).map(value => JSON.stringify(value)));
    return session;
  }

  async commit(db: PrismaService, state: Record<string, unknown>) {
    const writes: Array<{ namespace: string; key: string; value: unknown; expected: number }> = [];
    const deletes: Row[] = [];
    for (const name of mapNamespaces) {
      const current = new Map(state[name] as Array<[string, unknown]>);
      for (const [key, value] of current) {
        const previous = this.original.get(`${name}\0${key}`);
        if (!previous || JSON.stringify(previous.value) !== JSON.stringify(value)) writes.push({ namespace: name, key, value, expected: previous?.version ?? 0 });
      }
      for (const previous of this.original.values()) if (previous.namespace === name && !current.has(previous.key)) deletes.push(previous);
    }
    for (const name of arrayNamespaces) {
      const values = state[name] as unknown[];
      const original = this.initialArrays.get(name)!;
      // Logs and audits are append-only. Destructive reset is development-only.
      if (values.length < original.length || original.some((value, i) => value !== JSON.stringify(values[i]))) throw new ConflictException('Shared history is append-only');
      for (const value of values.slice(original.length)) {
        writes.push({ namespace: name, key: (value as { id?: string })?.id ?? randomUUID(), value, expected: 0 });
      }
    }
    // Stable key order avoids deadlocks when two imports overlap.
    writes.sort((a, b) => `${a.namespace}\0${a.key}`.localeCompare(`${b.namespace}\0${b.key}`));
    for (let offset = 0; offset < writes.length; offset += 1000) {
      const batch = writes.slice(offset, offset + 1000);
      const changed = await db.$queryRaw<Array<{ key: string }>>`
        INSERT INTO "SharedStateRecord" ("namespace", "key", "value", "version")
        SELECT r.namespace, r.key, r.value, 1 FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
          AS r(namespace text, key text, value jsonb, expected int)
        WHERE r.expected = 0
        ON CONFLICT ("namespace", "key") DO NOTHING RETURNING "key"
      `;
      const inserted = batch.filter(item => item.expected === 0).length;
      if (changed.length !== inserted) throw new ConflictException('Record changed concurrently; refresh and retry');
      const updated = await db.$queryRaw<Array<{ key: string }>>`
        UPDATE "SharedStateRecord" s SET "value" = r.value, "version" = s."version" + 1, "updatedAt" = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(namespace text, key text, value jsonb, expected int)
        WHERE r.expected > 0 AND s."namespace" = r.namespace AND s."key" = r.key AND s."version" = r.expected
        RETURNING s."key"
      `;
      if (updated.length !== batch.length - inserted) throw new ConflictException('Record changed concurrently; refresh and retry');
    }
    for (const row of deletes) {
      const changed = await db.$executeRaw`DELETE FROM "SharedStateRecord" WHERE "namespace" = ${row.namespace} AND "key" = ${row.key} AND "version" = ${row.version}`;
      if (changed !== 1) throw new ConflictException('Record changed concurrently; refresh and retry');
    }
  }
}
