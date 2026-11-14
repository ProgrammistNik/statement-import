import { Api, ApiError, Operation, readJob } from './core';

export type Transport = (url: string, init?: RequestInit) => Promise<Response>;

export function makeApi(transport: Transport, body: (uri: string) => unknown, timeoutMs = 8000): Api {
  async function request(op: Operation, path: string, method = 'GET', extra: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(`${op.baseUrl}${path}`, { ...extra, method, signal: controller.signal });
      if (!response.ok) throw new ApiError(response.status);
      return readJob(await response.json());
    } finally { clearTimeout(timer); }
  }
  return {
    create: op => request(op, '/imports', 'POST', {
      headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': op.key, 'X-File-Name': encodeURIComponent(op.file!.name).slice(0, 255) || 'statement' },
      body: body(op.file!.uri) as BodyInit,
    }),
    find: async op => {
      try { return await request(op, `/imports/by-key/${encodeURIComponent(op.key)}`); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
    },
    get: op => request(op, `/imports/${encodeURIComponent(op.job!.jobId)}`),
    remove: op => request(op, `/imports/${encodeURIComponent(op.job!.jobId)}`, 'DELETE', { headers: { 'Idempotency-Key': op.deleteKey! } }),
  };
}
