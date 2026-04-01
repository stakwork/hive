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

  it('resolves with payment_hash and payment_request on success', async () => {
    const mockReq = makeMockRequest();
    const mockRes = makeMockResponse(200, JSON.stringify({
      payment_hash: 'abc123',
      payment_request: 'lnbc...',
    }));

    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      cb?.(mockRes);
      return mockReq;
    });

    // Re-import to pick up mocks
    const { createLndInvoice } = await import('@/services/lightning');
    const result = await createLndInvoice(1000);

    expect(result).toEqual({ payment_hash: 'abc123', payment_request: 'lnbc...' });
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
      payment_hash: 'hash1',
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
      payment_hash: 'hash2',
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
      payment_hash: 'h',
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
