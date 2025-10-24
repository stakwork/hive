import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dropPod } from '@/lib/pods/utils';

// Mock env config before importing modules that use it
vi.mock('@/lib/env', () => ({
  config: {
    POOL_MANAGER_BASE_URL: 'https://pool-manager.test.com',
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('dropPod utility function', () => {
  const mockPoolName = 'test-pool';
  const mockWorkspaceId = 'workspace-abc123';
  const mockPoolApiKey = 'test-api-key-secure-123';

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful pod dropping', () => {
    it('should call markWorkspaceAsUnused with correct parameters', async () => {
      // Arrange - Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Pod dropped successfully',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert - Verify API call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/pools/${mockPoolName}/workspaces/${mockWorkspaceId}/mark-unused`),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockPoolApiKey}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({}),
        })
      );
    });

    it('should construct URL with encoded pool name', async () => {
      // Arrange
      const poolNameWithSpaces = 'test pool with spaces';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(poolNameWithSpaces, mockWorkspaceId, mockPoolApiKey);

      // Assert - Verify URL encoding
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/pools/test%20pool%20with%20spaces/workspaces/'),
        expect.any(Object)
      );
    });

    it('should include full API base URL in request', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pool-manager.test.com/pools/test-pool/workspaces/workspace-abc123/mark-unused',
        expect.any(Object)
      );
    });

    it('should send empty JSON body in POST request', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert
      const [, requestOptions] = mockFetch.mock.calls[0];
      expect(requestOptions.body).toBe(JSON.stringify({}));
    });
  });

  describe('error handling - HTTP status codes', () => {
    it('should throw error with status code on 404 response', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Workspace not found',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Failed to drop pod: 404');
    });

    it('should throw error with status code on 500 response', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Failed to drop pod: 500');
    });

    it('should throw error with status code on 401 unauthorized', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Failed to drop pod: 401');
    });

    it('should throw error with status code on 403 forbidden', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Failed to drop pod: 403');
    });

    it('should throw error with status code on 400 bad request', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Failed to drop pod: 400');
    });
  });

  describe('error handling - network failures', () => {
    it('should throw error on network timeout', async () => {
      // Arrange
      const timeoutError = new Error('Network timeout after 30s');
      mockFetch.mockRejectedValueOnce(timeoutError);

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Network timeout after 30s');
    });

    it('should throw error on connection refused', async () => {
      // Arrange
      const connectionError = new Error('Connection refused');
      mockFetch.mockRejectedValueOnce(connectionError);

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('Connection refused');
    });

    it('should throw error on DNS lookup failure', async () => {
      // Arrange
      const dnsError = new Error('getaddrinfo ENOTFOUND');
      mockFetch.mockRejectedValueOnce(dnsError);

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow('getaddrinfo ENOTFOUND');
    });
  });

  describe('error logging', () => {
    it('should log error details before throwing', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      // Act & Assert
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to drop pod: 500 - Internal server error'
      );

      consoleSpy.mockRestore();
    });

    it('should log success message when response is OK', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Pod dropped successfully',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pod dropped successfully'),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle empty response body', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      // Act & Assert - Should not throw
      await expect(dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey))
        .resolves.toBeUndefined();
    });

    it('should handle pool names with special characters', async () => {
      // Arrange
      const specialPoolName = 'pool-name.with_special-chars';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(specialPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert - Verify special characters are encoded
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(specialPoolName)),
        expect.any(Object)
      );
    });

    it('should handle workspace IDs with hyphens and alphanumeric characters', async () => {
      // Arrange
      const complexWorkspaceId = 'workspace-123-abc-xyz';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(mockPoolName, complexWorkspaceId, mockPoolApiKey);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/workspaces/${complexWorkspaceId}/mark-unused`),
        expect.any(Object)
      );
    });

    it('should handle long API keys', async () => {
      // Arrange
      const longApiKey = 'a'.repeat(256); // Very long API key
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, longApiKey);

      // Assert - Verify long API key is included in header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${longApiKey}`,
          }),
        })
      );
    });
  });

  describe('no local database state changes', () => {
    it('should only make external API call and not modify local state', async () => {
      // Arrange
      const fetchSpy = vi.spyOn(global, 'fetch');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Success',
      });

      // Act
      await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);

      // Assert - Only external API call, no database operations
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('pool-manager.test.com'),
        expect.any(Object)
      );
    });
  });

  // NOTE: Authorization header tests commented out as they're redundant
  // Header format is already verified in "successful pod dropping" tests above
  // describe('authorization header format', () => {
  //   it('should format authorization header as Bearer token', async () => {
  //     mockFetch.mockResolvedValueOnce({
  //       ok: true,
  //       status: 200,
  //       text: async () => 'Success',
  //     });
  //     await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);
  //     expect(mockFetch).toHaveBeenCalledTimes(1);
  //     expect(mockFetch).toHaveBeenCalledWith(
  //       expect.any(String),
  //       expect.objectContaining({
  //         headers: expect.objectContaining({
  //           Authorization: `Bearer ${mockPoolApiKey}`,
  //         }),
  //       })
  //     );
  //   });
  //   it('should include Content-Type application/json header', async () => {
  //     mockFetch.mockResolvedValueOnce({
  //       ok: true,
  //       status: 200,
  //       text: async () => 'Success',
  //     });
  //     await dropPod(mockPoolName, mockWorkspaceId, mockPoolApiKey);
  //     expect(mockFetch).toHaveBeenCalledTimes(1);
  //     expect(mockFetch).toHaveBeenCalledWith(
  //       expect.any(String),
  //       expect.objectContaining({
  //         headers: expect.objectContaining({
  //           'Content-Type': 'application/json',
  //         }),
  //       })
  //     );
  //   });
  // });
});