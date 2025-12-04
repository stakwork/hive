import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUserAppTokens } from '@/lib/githubApp';
import { db } from '@/lib/db';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: {
    sourceControlToken: {
      findFirst: vi.fn(),
    },
  },
}));

const mockDecryptField = vi.fn();

vi.mock('@/lib/encryption', () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));

describe('getUserAppTokens', () => {
  const mockUserId = 'user-123';
  const mockGithubOwner = 'test-org';
  const mockAccessToken = 'github_pat_test_token_123';
  const mockRefreshToken = 'refresh_token_456';
  const mockEncryptedToken = 'encrypted_token_data';
  const mockEncryptedRefreshToken = 'encrypted_refresh_token_data';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful token retrieval', () => {
    it('should return decrypted tokens when found in database', async () => {
      // Arrange
      const mockTokenRecord = {
        token: mockEncryptedToken,
        refreshToken: mockEncryptedRefreshToken,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);
      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
      expect(mockDecryptField).toHaveBeenCalledTimes(2);
      expect(mockDecryptField).toHaveBeenNthCalledWith(1, 'source_control_token', mockEncryptedToken);
      expect(mockDecryptField).toHaveBeenNthCalledWith(2, 'source_control_refresh_token', mockEncryptedRefreshToken);
    });

    it('should return only accessToken when refreshToken is not present', async () => {
      // Arrange
      const mockTokenRecord = {
        token: mockEncryptedToken,
        refreshToken: null,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);
      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
      });
      expect(mockDecryptField).toHaveBeenCalledTimes(1);
      expect(mockDecryptField).toHaveBeenCalledWith('source_control_token', mockEncryptedToken);
    });

    it('should query database without githubOwner when not provided', async () => {
      // Arrange
      const mockTokenRecord = {
        token: mockEncryptedToken,
        refreshToken: null,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);
      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      const result = await getUserAppTokens(mockUserId);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
      });
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });
  });

  describe('error handling', () => {
    it('should return null when no tokens found in database', async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it('should return null when token field is missing', async () => {
      // Arrange
      const mockTokenRecord = {
        token: null,
        refreshToken: mockEncryptedRefreshToken,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it('should return null when accessToken decryption fails', async () => {
      // Arrange
      const mockTokenRecord = {
        token: mockEncryptedToken,
        refreshToken: mockEncryptedRefreshToken,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);
      mockDecryptField.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when refreshToken decryption fails', async () => {
      // Arrange
      const mockTokenRecord = {
        token: mockEncryptedToken,
        refreshToken: mockEncryptedRefreshToken,
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(mockTokenRecord);
      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockImplementationOnce(() => {
          throw new Error('Refresh token decryption failed');
        });

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle database connection errors', async () => {
      // Arrange
      const dbError = new Error('Database connection failed');
      vi.mocked(db.sourceControlToken.findFirst).mockRejectedValue(dbError);

      // Act & Assert
      await expect(getUserAppTokens(mockUserId, mockGithubOwner)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty userId', async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens('', mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: '',
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    it('should handle empty githubOwner', async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens(mockUserId, '');

      // Assert - empty string is falsy, so it falls back to "any token" query
      expect(result).toBeNull();
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });
  });
});
