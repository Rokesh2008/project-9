// E2E suites truncate tables. Never allow production/remote databases to be targets.
if (expect.getState().testPath?.endsWith('.e2e-spec.ts')) {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('E2E tests require an explicit isolated local DATABASE_URL');
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || !/^\/project9_[a-z0-9_]*test[a-z0-9_]*$/.test(url.pathname)) {
    throw new Error('Refusing destructive E2E tests: use a local project9_*test* database');
  }
}
