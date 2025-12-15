import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the EncryptionService before importing the module under test
vi.mock('@/lib/encryption', () => {
  const mockDecryptField = vi.fn((field: string, value: string) => value.replace('encrypted:', ''));
  return {
    EncryptionService: {
      getInstance: vi.fn(() => ({
        decryptField: mockDecryptField,
      })),
    },
    mockDecryptField, // Export it so we can access it in tests
  };
});

// Import after mocking
import { swarmApiRequest } from '@/services/swarm/api/swarm';
import { mockDecryptField } from '@/lib/encryption';

describe('swarmApiRequest', () => {
  const mockSwarmUrl = 'https://api.swarm.example.com';
  const mockEndpoint = '/test-endpoint';
  const mockEncryptedApiKey = 'encrypted:mock-api-key-123';
  const mockDecryptedApiKey = 'mock-api-key-123';

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Spy on global fetch
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    
    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP Methods', () => {
    it.each([
      ['GET', undefined],
      ['POST', { data: 'test' }],
      ['PUT', { data: 'test' }],
      ['DELETE', undefined],
    ])('should make %s request successfully', async (method, requestData) => {
      const mockResponse = { success: true, data: { id: 1, name: 'test' } };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        apiKey: mockEncryptedApiKey,
        data: requestData,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${mockSwarmUrl}${mockEndpoint}`,
        expect.objectContaining({
          method,
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockDecryptedApiKey}`,
            'x-api-token': mockDecryptedApiKey,
            'Content-Type': 'application/json',
          }),
        })
      );
      
      expect(result).toEqual({
        ok: true,
        data: mockResponse,
        status: 200,
      });
    });

    it('should default to GET method when not specified', async () => {
      const mockResponse = { success: true };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('Authentication', () => {
    it('should decrypt API key and include in both Authorization and x-api-token headers', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'GET',
        apiKey: mockEncryptedApiKey,
      });

      expect(mockDecryptField).toHaveBeenCalledWith('swarmApiKey', mockEncryptedApiKey);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockDecryptedApiKey}`,
            'x-api-token': mockDecryptedApiKey,
          }),
        })
      );
    });

    it('should handle decryption of different API keys', async () => {
      const differentKey = 'encrypted:different-key-456';
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: differentKey,
      });

      expect(mockDecryptField).toHaveBeenCalledWith('swarmApiKey', differentKey);
    });
  });

  describe('URL Construction', () => {
    it('should construct full URL with swarmUrl and endpoint', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        `${mockSwarmUrl}${mockEndpoint}`,
        expect.any(Object)
      );
    });

    it('should handle swarmUrl with trailing slash', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: `${mockSwarmUrl}/`,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe(`${mockSwarmUrl}${mockEndpoint}`);
      expect(calledUrl).not.toContain('//test-endpoint');
    });

    it('should handle endpoint without leading slash', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: 'test-endpoint',
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe(`${mockSwarmUrl}/test-endpoint`);
    });

    it('should handle endpoint with leading slash', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: '/test-endpoint',
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe(`${mockSwarmUrl}/test-endpoint`);
    });

    it('should handle both swarmUrl trailing slash and endpoint leading slash', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: `${mockSwarmUrl}/`,
        endpoint: '/test-endpoint',
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe(`${mockSwarmUrl}/test-endpoint`);
      expect(calledUrl).not.toContain('//test-endpoint');
    });
  });

  describe('Request Body Handling', () => {
    it('should include request body for POST requests', async () => {
      const requestData = { name: 'Test', value: 123 };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'POST',
        apiKey: mockEncryptedApiKey,
        data: requestData,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(requestData),
        })
      );
    });

    it('should include request body for PUT requests', async () => {
      const requestData = { id: 1, name: 'Updated' };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'PUT',
        apiKey: mockEncryptedApiKey,
        data: requestData,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(requestData),
        })
      );
    });

    it('should include request body even for GET requests when data is provided', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'GET',
        apiKey: mockEncryptedApiKey,
        data: { someData: 'value' },
      });

      const fetchCall = fetchSpy.mock.calls[0][1] as RequestInit;
      // The implementation includes body even for GET when data is provided
      expect(fetchCall.body).toBe(JSON.stringify({ someData: 'value' }));
    });

    it('should not include body when data is undefined', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'POST',
        apiKey: mockEncryptedApiKey,
      });

      const fetchCall = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(fetchCall.body).toBeUndefined();
    });

    it('should serialize complex nested data structures', async () => {
      const complexData = {
        user: { id: 1, name: 'John' },
        posts: [{ id: 1, title: 'Post 1' }],
        meta: { total: 1, page: 1 },
      };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'POST',
        apiKey: mockEncryptedApiKey,
        data: complexData,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(complexData),
        })
      );
    });
  });

  describe('Response Processing', () => {
    it('should parse and return JSON response', async () => {
      const mockData = {
        id: 1,
        name: 'Test Item',
        metadata: { key: 'value' },
      };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockData),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: true,
        data: mockData,
        status: 200,
      });
    });

    it('should handle array responses', async () => {
      const mockData = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
        { id: 3, name: 'Item 3' },
      ];
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockData),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toEqual(mockData);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(3);
    });

    it('should handle empty JSON responses', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toEqual({});
    });

    it('should handle null responses', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => 'null',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toBeNull();
    });

    it('should handle invalid JSON gracefully', async () => {
      const invalidJson = 'This is not JSON';
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => invalidJson,
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 200,
      });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'swarmApiRequest JSON error',
        invalidJson,
        expect.any(Error)
      );
    });

    it('should handle empty response text', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 204,
      });
    });

    it('should preserve response status for non-ok responses', async () => {
      const errorData = { error: 'Bad Request', message: 'Invalid input' };
      
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorData),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        data: errorData,
        status: 400,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors and return 500 status', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'swarmApiRequest',
        expect.any(Error)
      );
    });

    it('should handle timeout errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Request timeout'));

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    it('should handle fetch abort errors', async () => {
      fetchSpy.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    it.each([
      [400, 'Bad Request'],
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [404, 'Not Found'],
      [500, 'Internal Server Error'],
      [502, 'Bad Gateway'],
      [503, 'Service Unavailable'],
    ])('should handle %d HTTP error responses', async (status, statusText) => {
      const errorResponse = { error: statusText };
      
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status,
        statusText,
        text: async () => JSON.stringify(errorResponse),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        data: errorResponse,
        status,
      });
    });

    it('should handle malformed JSON in error responses', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error - Not JSON',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        data: undefined,
        status: 500,
      });
    });

    it('should handle encryption service errors gracefully', async () => {
      // Mock decryptField to throw an error
      mockDecryptField.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'swarmApiRequest',
        expect.any(Error)
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent requests independently', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 1 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 2 }),
        } as Response);

      const [result1, result2] = await Promise.all([
        swarmApiRequest({
          swarmUrl: mockSwarmUrl,
          endpoint: '/endpoint1',
          apiKey: mockEncryptedApiKey,
        }),
        swarmApiRequest({
          swarmUrl: mockSwarmUrl,
          endpoint: '/endpoint2',
          apiKey: mockEncryptedApiKey,
        }),
      ]);

      expect(result1.data).toEqual({ id: 1 });
      expect(result2.data).toEqual({ id: 2 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle special characters in endpoint', async () => {
      const specialEndpoint = '/test?query=value&filter=active';
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: specialEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toContain(specialEndpoint);
    });

    it('should handle very long response payloads', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: i, data: `item-${i}` }));
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(largeArray),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toEqual(largeArray);
      expect(Array.isArray(result.data)).toBe(true);
      expect((result.data as unknown[]).length).toBe(1000);
    });

    it('should handle unicode characters in response', async () => {
      const unicodeData = { message: 'Hello 世界 🌍', emoji: '✅' };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(unicodeData),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toEqual(unicodeData);
    });

    it('should handle empty string as endpoint', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: '',
        apiKey: mockEncryptedApiKey,
      });

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe(`${mockSwarmUrl}/`);
    });

    it('should handle response with circular references in error logging', async () => {
      // Create a response that would fail JSON.parse
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"a":',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(result.data).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Headers Configuration', () => {
    it('should always include Content-Type application/json', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        apiKey: mockEncryptedApiKey,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should include all required headers for authenticated requests', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      } as Response);

      await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: mockEndpoint,
        method: 'POST',
        apiKey: mockEncryptedApiKey,
        data: { test: 'data' },
      });

      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders).toHaveProperty('Authorization');
      expect(callHeaders).toHaveProperty('x-api-token');
      expect(callHeaders).toHaveProperty('Content-Type');
      expect(callHeaders['Authorization']).toContain('Bearer');
    });
  });

  describe('Method-Specific Behavior', () => {
    it('should handle DELETE requests without body', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: '/resource/123',
        method: 'DELETE',
        apiKey: mockEncryptedApiKey,
      });

      expect(result.status).toBe(204);
      const fetchCall = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(fetchCall.body).toBeUndefined();
    });

    it('should handle POST request creating a resource', async () => {
      const createdResource = { id: 123, name: 'New Resource', created: true };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(createdResource),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: '/resources',
        method: 'POST',
        apiKey: mockEncryptedApiKey,
        data: { name: 'New Resource' },
      });

      expect(result.status).toBe(201);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(createdResource);
    });

    it('should handle PUT request updating a resource', async () => {
      const updatedResource = { id: 123, name: 'Updated Resource', updated: true };
      
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(updatedResource),
      } as Response);

      const result = await swarmApiRequest({
        swarmUrl: mockSwarmUrl,
        endpoint: '/resources/123',
        method: 'PUT',
        apiKey: mockEncryptedApiKey,
        data: { name: 'Updated Resource' },
      });

      expect(result.status).toBe(200);
      expect(result.data).toEqual(updatedResource);
    });
  });
});
