import { AiService } from '../src/ai.service';
import { Store } from '../src/store';

describe('Private Cloud Run advisory authentication', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function service() {
    const store = {
      students: new Map([['demo', {
        studentId: 'demo', codingScore: 80, aptitudeScore: 75, cgpa: 8,
        attendancePercent: 90, dsaLevel: 'ADVANCED', preferences: [], completedCertificates: [],
      }]]),
      analyses: new Map(), persist: jest.fn(),
    };
    return { ai: new AiService(store as unknown as Store), store };
  }

  it('obtains an audience-bound identity token and sends it to the private service', async () => {
    process.env.AI_CLOUD_RUN_AUTH = 'true';
    process.env.AI_SERVICE_URL = 'https://advisory.run.app';
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('test-identity-token'))
      .mockResolvedValueOnce(Response.json({ strengths: [], gaps: [], trend: 'STABLE', recommendedDomains: [] }));
    const { ai, store } = service();
    const result = await ai.analyze('demo');
    expect(fetchMock.mock.calls[0][0]).toContain('audience=https%3A%2F%2Fadvisory.run.app');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ 'Metadata-Flavor': 'Google' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://advisory.run.app/analyze');
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer test-identity-token' });
    expect(result.advisoryOnly).toBe(true);
    expect(store.persist).toHaveBeenCalled();
  });

  it('does not request a metadata token outside Cloud Run', async () => {
    delete process.env.AI_CLOUD_RUN_AUTH;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ strengths: [], gaps: [], trend: 'STABLE', recommendedDomains: [] }));
    await service().ai.analyze('demo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('retains advisory-only fallback when identity authentication fails', async () => {
    process.env.AI_CLOUD_RUN_AUTH = 'true';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('denied', { status: 403 }));
    const result = await service().ai.analyze('demo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.advisoryOnly).toBe(true);
    expect(result.strengths).toContain('Strong coding score');
  });
});
