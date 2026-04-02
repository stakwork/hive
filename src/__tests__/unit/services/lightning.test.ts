import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';

// Mock the env config
vi.mock('@/config/env', () => ({
  optionalEnvVars: {
    LIGHTNING_NODE_URL: 'https://lnd.example.com',
    LIGHTNING_MACAROON: 'test-macaroon',
    LIGHTNING_TLS_CERT: '',
  },
}));

// Mock https module
vi.mock('node:https', () => ({
  default: {
    request: vi.fn(),
  },
}));

import https from 'node:https';
import * as envConfig from '@/config/env';

// Helper to create a mock IncomingMessage-like response
function makeMockResponse(statusCode: number, body: string) {
  const res = {
    statusCode,
    on: vi.fn((event: string, cb: (chunk?: string) => void) => {
      if (event === 'data') cb(body);
      if (event === 'end') cb();
      return res;
    }),
  } as unknown as IncomingMessage & EventEmitter;
  return res;
}

// Helper to create a mock ClientRequest
function makeMockRequest() {
  const req = {
    on: vi.fn().mockReturnThis(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as ClientRequest;
  return req;
}

describe('createLndInvoice', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resolves with payment_hash (hex) and payment_request on success', async () => {
    const hexHash = 'abc123ff';
    const r_hash = Buffer.from(hexHash, 'hex').toString('base64');

    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({
      r_hash,
      payment_request: 'lnbc...',
    }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    // Re-import to pick up mocks
    const { createLndInvoice } = await import('@/services/lightning');
    const result = await createLndInvoice(1000);

    expect(result).toEqual({ payment_hash: hexHash, payment_request: 'lnbc...' });
    expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ value: 1000 }));
    expect(mockReq.end).toHaveBeenCalled();
  });

  it('does not pass ca option when LIGHTNING_TLS_CERT is empty', async () => {
    // Ensure TLS cert is empty
    vi.mocked(envConfig).optionalEnvVars = {
      ...envConfig.optionalEnvVars,
      LIGHTNING_TLS_CERT: '',
    };

    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({
      r_hash: Buffer.from('hash1').toString('base64'),
      payment_request: 'lnbc1',
    }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { createLndInvoice } = await import('@/services/lightning');
    await createLndInvoice(500);

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    expect(callOptions).not.toHaveProperty('ca');
  });

  it('passes decoded ca option when LIGHTNING_TLS_CERT is set', async () => {
    const fakePem = '-----BEGIN CERTIFICATE-----\nfakecert\n-----END CERTIFICATE-----';
    const fakePemB64 = Buffer.from(fakePem).toString('base64');

    vi.mocked(envConfig).optionalEnvVars = {
      ...envConfig.optionalEnvVars,
      LIGHTNING_TLS_CERT: fakePemB64,
    };

    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({
      r_hash: Buffer.from('hash2').toString('base64'),
      payment_request: 'lnbc2',
    }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { createLndInvoice } = await import('@/services/lightning');
    await createLndInvoice(2000);

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    expect(callOptions.ca).toBe(fakePem);
  });

  it('rejects when status code >= 300', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(500, 'Internal Server Error');

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { createLndInvoice } = await import('@/services/lightning');
    await expect(createLndInvoice(100)).rejects.toThrow('LND invoice creation failed: 500');
  });

  it('sends Grpc-Metadata-Macaroon header with macaroon value', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({
      r_hash: Buffer.from('deadbeef', 'hex').toString('base64'),
      payment_request: 'p',
    }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { createLndInvoice } = await import('@/services/lightning');
    await createLndInvoice(100);

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    const headers = callOptions.headers as Record<string, string>;
    expect(headers['Grpc-Metadata-Macaroon']).toBe('test-macaroon');
  });
});

describe('lookupLndInvoice', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset to default test env values
    vi.mocked(envConfig).optionalEnvVars = {
      LIGHTNING_NODE_URL: 'https://lnd.example.com',
      LIGHTNING_MACAROON: 'test-macaroon',
      LIGHTNING_TLS_CERT: '',
    };
  });

  it('returns { settled: true } when LND responds with settled: true', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: true }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    const result = await lookupLndInvoice('deadbeef');

    expect(result).toEqual({ settled: true });
  });

  it('returns { settled: false } when LND responds with settled: false', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: false }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    const result = await lookupLndInvoice('deadbeef');

    expect(result).toEqual({ settled: false });
  });

  it('returns { settled: false } when LND responds without settled field', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({}));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    const result = await lookupLndInvoice('deadbeef');

    expect(result).toEqual({ settled: false });
  });

  it('rejects on non-2xx response', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(404, 'Not Found');

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await expect(lookupLndInvoice('deadbeef')).rejects.toThrow('LND invoice lookup failed: 404');
  });

  it('correctly converts hex payment hash to base64url in the URL path', async () => {
    const hexHash = 'deadbeef01234567';
    const expectedB64url = Buffer.from(hexHash, 'hex').toString('base64url');

    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: false }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await lookupLndInvoice(hexHash);

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    expect(callOptions.path).toBe(`/v1/invoice/${expectedB64url}`);
  });

  it('passes Grpc-Metadata-Macaroon header', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: false }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await lookupLndInvoice('deadbeef');

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    const headers = callOptions.headers as Record<string, string>;
    expect(headers['Grpc-Metadata-Macaroon']).toBe('test-macaroon');
  });

  it('passes ca option when LIGHTNING_TLS_CERT is set', async () => {
    const fakePem = '-----BEGIN CERTIFICATE-----\nfakecert\n-----END CERTIFICATE-----';
    const fakePemB64 = Buffer.from(fakePem).toString('base64');

    vi.mocked(envConfig).optionalEnvVars = {
      LIGHTNING_NODE_URL: 'https://lnd.example.com',
      LIGHTNING_MACAROON: 'test-macaroon',
      LIGHTNING_TLS_CERT: fakePemB64,
    };

    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: false }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await lookupLndInvoice('deadbeef');

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    expect(callOptions.ca).toBe(fakePem);
  });

  it('does not pass ca option when LIGHTNING_TLS_CERT is empty', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({ settled: false }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await lookupLndInvoice('deadbeef');

    const callOptions = vi.mocked(https.request).mock.calls[0][0] as Record<string, unknown>;
    expect(callOptions).not.toHaveProperty('ca');
  });

  it('rejects when request emits an error', async () => {
    const mockReq = makeMockRequest();
    let errorCb: ((err: Error) => void) | undefined;
    mockReq.on = vi.fn((event: string, cb: (err: Error) => void) => {
      if (event === 'error') errorCb = cb;
      return mockReq;
    });

    vi.mocked(https.request).mockImplementation((_opts, _cb) => {
      // Emit error asynchronously after end() is called
      const originalEnd = mockReq.end as ReturnType<typeof vi.fn>;
      originalEnd.mockImplementation(() => {
        errorCb?.(new Error('ECONNREFUSED'));
      });
      return mockReq;
    });

    const { lookupLndInvoice } = await import('@/services/lightning');
    await expect(lookupLndInvoice('deadbeef')).rejects.toThrow('ECONNREFUSED');
  });
});
