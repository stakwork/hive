import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/check-url/route';
import { createGetRequest } from '@/__tests__/support/helpers/request-builders';

describe('GET /api/check-url', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Parameter Validation', () => {
    test('returns 400 when url parameter is missing', async () => {
      const request = new Request('http://localhost:3000/api/check-url');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'URL parameter is required' });
    });

    test('returns 400 when url parameter is empty string', async () => {
      const request = new Request('http://localhost:3000/api/check-url?url=');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'URL parameter is required' });
    });
  });

  describe('Successful URL Checks', () => {
    test('returns isReady=true and status for 200 OK response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: true,
        status: 200,
      });
      expect(global.fetch).toHaveBeenCalledWith('https://example.com', {
        method: 'HEAD',
        signal: expect.any(AbortSignal),
      });
    });

    test('returns isReady=true for 2xx status codes', async () => {
      const successStatusCodes = [200, 201, 202, 204];

      for (const statusCode of successStatusCodes) {
        global.fetch = vi.fn().mockResolvedValue({
          status: statusCode,
        });

        const request = new Request(`http://localhost:3000/api/check-url?url=https://example.com`);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          isReady: true,
          status: statusCode,
        });
      }
    });

    test('returns isReady=true for 3xx redirect status codes', async () => {
      const redirectStatusCodes = [301, 302, 303, 307, 308];

      for (const statusCode of redirectStatusCodes) {
        global.fetch = vi.fn().mockResolvedValue({
          status: statusCode,
        });

        const request = new Request(`http://localhost:3000/api/check-url?url=https://example.com`);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          isReady: true,
          status: statusCode,
        });
      }
    });

    test('accepts status code 399 as success (boundary test)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 399,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: true,
        status: 399,
      });
    });
  });

  describe('Failed URL Checks', () => {
    test('returns isReady=false for 404 Not Found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com/not-found');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        status: 404,
      });
    });

    test('returns isReady=false for 4xx client error status codes', async () => {
      const clientErrorCodes = [400, 401, 403, 404, 405, 429];

      for (const statusCode of clientErrorCodes) {
        global.fetch = vi.fn().mockResolvedValue({
          status: statusCode,
        });

        const request = new Request(`http://localhost:3000/api/check-url?url=https://example.com`);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          isReady: false,
          status: statusCode,
        });
      }
    });

    test('returns isReady=false for 5xx server error status codes', async () => {
      const serverErrorCodes = [500, 502, 503, 504];

      for (const statusCode of serverErrorCodes) {
        global.fetch = vi.fn().mockResolvedValue({
          status: statusCode,
        });

        const request = new Request(`http://localhost:3000/api/check-url?url=https://example.com`);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          isReady: false,
          status: statusCode,
        });
      }
    });

    test('rejects status code 400 as failure (boundary test)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 400,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        status: 400,
      });
    });
  });

  describe('Network Errors', () => {
    test('handles network failure with error message', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'Network error',
      });
    });

    test('handles non-Error exceptions with default message', async () => {
      global.fetch = vi.fn().mockRejectedValue('Unknown error');

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'Failed to fetch',
      });
    });

    test('handles timeout error from AbortSignal', async () => {
      // Note: DOMException is not recognized as instanceof Error in jsdom environment,
      // so the API returns the fallback error message "Failed to fetch"
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      global.fetch = vi.fn().mockRejectedValue(abortError);

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'Failed to fetch',
      });
    });

    test('handles DNS resolution failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const request = new Request('http://localhost:3000/api/check-url?url=https://invalid-domain-that-does-not-exist.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'Failed to fetch',
      });
    });

    test('handles connection refused error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      const request = new Request('http://localhost:3000/api/check-url?url=http://localhost:9999');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'connect ECONNREFUSED',
      });
    });

    test('handles SSL certificate errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('certificate has expired'));

      const request = new Request('http://localhost:3000/api/check-url?url=https://expired.badssl.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        isReady: false,
        error: 'certificate has expired',
      });
    });
  });

  describe('Request Configuration', () => {
    test('uses HEAD method for lightweight checks', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'HEAD',
        })
      );
    });

    test('includes AbortSignal for timeout protection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    test('fetch is called exactly once per request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL Parameter Handling', () => {
    test('correctly decodes URL-encoded parameters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const encodedUrl = encodeURIComponent('https://example.com/path?query=value');
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodedUrl}`);
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/path?query=value',
        expect.any(Object)
      );
    });

    test('handles URLs with special characters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const urlWithSpecialChars = 'https://example.com/path?name=John%20Doe&tag=%23test';
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(urlWithSpecialChars)}`);
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        urlWithSpecialChars,
        expect.any(Object)
      );
    });

    test('handles URLs with ports', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=http://localhost:8080/health');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/health',
        expect.any(Object)
      );
    });

    test('handles URLs with authentication', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const authUrl = 'https://user:pass@example.com/api';
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(authUrl)}`);
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        authUrl,
        expect.any(Object)
      );
    });

    test('handles URLs with fragments', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com/page%23section');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/page#section',
        expect.any(Object)
      );
    });

    test('handles international domain names', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://münchen.de');
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://münchen.de',
        expect.any(Object)
      );
    });
  });

  describe('Response Format Consistency', () => {
    test('always returns JSON with isReady property', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('isReady');
      expect(typeof data.isReady).toBe('boolean');
    });

    test('includes status code on successful fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('status');
      expect(typeof data.status).toBe('number');
    });

    test('includes error message on failed fetch', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
      expect(data.error).toBe('Connection failed');
    });

    test('does not include status code on error responses', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const request = new Request('http://localhost:3000/api/check-url?url=https://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(data).not.toHaveProperty('status');
      expect(data).toHaveProperty('isReady');
      expect(data).toHaveProperty('error');
    });
  });

  describe('Edge Cases', () => {
    test('handles extremely long URLs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const longPath = 'a'.repeat(2000);
      const longUrl = `https://example.com/${longPath}`;
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(longUrl)}`);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(longUrl, expect.any(Object));
    });

    test('handles localhost URLs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=http://localhost:3000/api/health');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });

    test('handles IP address URLs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const request = new Request('http://localhost:3000/api/check-url?url=http://192.168.1.1:8080/status');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://192.168.1.1:8080/status',
        expect.any(Object)
      );
    });

    test('handles data URLs (though likely to fail)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Invalid URL'));

      const dataUrl = 'data:text/plain,Hello%20World';
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(dataUrl)}`);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toBe('Invalid URL');
    });

    test('handles file protocol URLs (though likely to fail)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Invalid URL'));

      const fileUrl = 'file:///path/to/file.txt';
      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(fileUrl)}`);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toBe('Invalid URL');
    });
  });
});