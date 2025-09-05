import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGitHubSignIn } from '../../../onboarding/handleGitHubSignIn';

// Mock external dependencies
vi.mock('../../../services/authService');
vi.mock('../../../services/sessionService');
vi.mock('../../../utils/redirect');

import * as authService from '../../../services/authService';
import * as sessionService from '../../../services/sessionService';
import * as redirectUtils from '../../../utils/redirect';

describe('handleGitHubSignIn', () => {
  // Mock functions
  const mockAuthenticateWithGitHub = vi.fn();
  const mockCreateSession = vi.fn();
  const mockRedirect = vi.fn();
  const mockUpdateUserState = vi.fn();

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup mock implementations
    (authService as any).authenticateWithGitHub = mockAuthenticateWithGitHub;
    (sessionService as any).createSession = mockCreateSession;
    (sessionService as any).updateUserState = mockUpdateUserState;
    (redirectUtils as any).redirect = mockRedirect;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Successful Authentication', () => {
    it('should successfully authenticate user and create session', async () => {
      // Arrange
      const mockCode = 'github_auth_code_123';
      const mockState = 'csrf_state_token';
      const mockUserData = {
        id: 'user_123',
        login: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
        avatar_url: 'https://github.com/avatar.jpg'
      };
      const mockAccessToken = 'gho_access_token_123';
      const mockSession = {
        id: 'session_123',
        userId: 'user_123',
        accessToken: mockAccessToken,
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockAuthenticateWithGitHub.mockResolvedValue({
        user: mockUserData,
        accessToken: mockAccessToken
      });
      mockCreateSession.mockResolvedValue(mockSession);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockAuthenticateWithGitHub).toHaveBeenCalledWith(mockCode, mockState);
      expect(mockCreateSession).toHaveBeenCalledWith({
        userId: mockUserData.id,
        accessToken: mockAccessToken,
        provider: 'github'
      });
      expect(mockUpdateUserState).toHaveBeenCalledWith('authenticated');
      expect(result).toEqual({
        success: true,
        user: mockUserData,
        session: mockSession
      });
    });

    it('should handle successful authentication with existing user', async () => {
      // Arrange
      const mockCode = 'github_auth_code_456';
      const mockState = 'csrf_state_token_2';
      const mockExistingUser = {
        id: 'existing_user_456',
        login: 'existinguser',
        email: 'existing@example.com',
        name: 'Existing User',
        avatar_url: 'https://github.com/existing-avatar.jpg',
        isExistingUser: true
      };
      const mockAccessToken = 'gho_access_token_456';
      const mockSession = {
        id: 'session_456',
        userId: 'existing_user_456',
        accessToken: mockAccessToken,
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockAuthenticateWithGitHub.mockResolvedValue({
        user: mockExistingUser,
        accessToken: mockAccessToken
      });
      mockCreateSession.mockResolvedValue(mockSession);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockAuthenticateWithGitHub).toHaveBeenCalledWith(mockCode, mockState);
      expect(mockCreateSession).toHaveBeenCalledWith({
        userId: mockExistingUser.id,
        accessToken: mockAccessToken,
        provider: 'github'
      });
      expect(mockUpdateUserState).toHaveBeenCalledWith('authenticated');
      expect(result).toEqual({
        success: true,
        user: mockExistingUser,
        session: mockSession
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication service errors', async () => {
      // Arrange
      const mockCode = 'invalid_code';
      const mockState = 'invalid_state';
      const authError = new Error('GitHub authentication failed');

      mockAuthenticateWithGitHub.mockRejectedValue(authError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockAuthenticateWithGitHub).toHaveBeenCalledWith(mockCode, mockState);
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockUpdateUserState).toHaveBeenCalledWith('error');
      expect(result).toEqual({
        success: false,
        error: 'GitHub authentication failed',
        errorType: 'AUTHENTICATION_ERROR'
      });
    });

    it('should handle session creation errors', async () => {
      // Arrange
      const mockCode = 'github_auth_code_789';
      const mockState = 'csrf_state_token_3';
      const mockUserData = {
        id: 'user_789',
        login: 'testuser3',
        email: 'test3@example.com',
        name: 'Test User 3',
        avatar_url: 'https://github.com/avatar3.jpg'
      };
      const mockAccessToken = 'gho_access_token_789';
      const sessionError = new Error('Failed to create session');

      mockAuthenticateWithGitHub.mockResolvedValue({
        user: mockUserData,
        accessToken: mockAccessToken
      });
      mockCreateSession.mockRejectedValue(sessionError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockAuthenticateWithGitHub).toHaveBeenCalledWith(mockCode, mockState);
      expect(mockCreateSession).toHaveBeenCalledWith({
        userId: mockUserData.id,
        accessToken: mockAccessToken,
        provider: 'github'
      });
      expect(mockUpdateUserState).toHaveBeenCalledWith('error');
      expect(result).toEqual({
        success: false,
        error: 'Failed to create session',
        errorType: 'SESSION_ERROR'
      });
    });

    it('should handle network connectivity errors', async () => {
      // Arrange
      const mockCode = 'github_code_network_error';
      const mockState = 'state_network_error';
      const networkError = new Error('Network request failed');
      networkError.name = 'NetworkError';

      mockAuthenticateWithGitHub.mockRejectedValue(networkError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'Network request failed',
        errorType: 'NETWORK_ERROR'
      });
    });

    it('should handle invalid state parameter (CSRF protection)', async () => {
      // Arrange
      const mockCode = 'valid_code';
      const mockState = 'invalid_or_tampered_state';
      const csrfError = new Error('Invalid state parameter');
      csrfError.name = 'CSRFError';

      mockAuthenticateWithGitHub.mockRejectedValue(csrfError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockUpdateUserState).toHaveBeenCalledWith('error');
      expect(result).toEqual({
        success: false,
        error: 'Invalid state parameter',
        errorType: 'CSRF_ERROR'
      });
    });
  });

  describe('Input Validation', () => {
    it('should handle missing authorization code', async () => {
      // Act
      const result = await handleGitHubSignIn({
        code: '',
        state: 'valid_state'
      });

      // Assert
      expect(mockAuthenticateWithGitHub).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Missing authorization code',
        errorType: 'VALIDATION_ERROR'
      });
    });

    it('should handle missing state parameter', async () => {
      // Act
      const result = await handleGitHubSignIn({
        code: 'valid_code',
        state: ''
      });

      // Assert
      expect(mockAuthenticateWithGitHub).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Missing state parameter',
        errorType: 'VALIDATION_ERROR'
      });
    });

    it('should handle null/undefined parameters', async () => {
      // Act
      const result = await handleGitHubSignIn({
        code: null as any,
        state: undefined as any
      });

      // Assert
      expect(mockAuthenticateWithGitHub).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Invalid parameters provided',
        errorType: 'VALIDATION_ERROR'
      });
    });
  });

  describe('State Management', () => {
    it('should update user state to "authenticating" during process', async () => {
      // Arrange
      const mockCode = 'github_auth_code_state_test';
      const mockState = 'csrf_state_token_state_test';
      const mockUserData = {
        id: 'user_state_test',
        login: 'statetestuser',
        email: 'statetest@example.com',
        name: 'State Test User',
        avatar_url: 'https://github.com/state-avatar.jpg'
      };
      const mockAccessToken = 'gho_access_token_state_test';

      // Add delay to simulate async operation
      mockAuthenticateWithGitHub.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          user: mockUserData,
          accessToken: mockAccessToken
        };
      });

      mockCreateSession.mockResolvedValue({
        id: 'session_state_test',
        userId: 'user_state_test',
        accessToken: mockAccessToken,
        expiresAt: new Date(Date.now() + 3600000)
      });

      // Act
      await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockUpdateUserState).toHaveBeenCalledWith('authenticating');
      expect(mockUpdateUserState).toHaveBeenCalledWith('authenticated');
    });

    it('should update user state to "error" on failure', async () => {
      // Arrange
      const mockCode = 'failing_code';
      const mockState = 'failing_state';
      const error = new Error('Authentication failed');

      mockAuthenticateWithGitHub.mockRejectedValue(error);

      // Act
      await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(mockUpdateUserState).toHaveBeenCalledWith('authenticating');
      expect(mockUpdateUserState).toHaveBeenCalledWith('error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle GitHub API rate limiting', async () => {
      // Arrange
      const mockCode = 'rate_limited_code';
      const mockState = 'rate_limited_state';
      const rateLimitError = new Error('API rate limit exceeded');
      rateLimitError.name = 'RateLimitError';

      mockAuthenticateWithGitHub.mockRejectedValue(rateLimitError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'API rate limit exceeded',
        errorType: 'RATE_LIMIT_ERROR'
      });
    });

    it('should handle user denying GitHub authorization', async () => {
      // Arrange
      const mockCode = 'access_denied';
      const mockState = 'denied_state';
      const deniedError = new Error('User denied authorization');
      deniedError.name = 'AccessDeniedError';

      mockAuthenticateWithGitHub.mockRejectedValue(deniedError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'User denied authorization',
        errorType: 'ACCESS_DENIED_ERROR'
      });
    });

    it('should handle GitHub service unavailable', async () => {
      // Arrange
      const mockCode = 'service_unavailable_code';
      const mockState = 'service_unavailable_state';
      const serviceError = new Error('GitHub service temporarily unavailable');
      serviceError.name = 'ServiceUnavailableError';

      mockAuthenticateWithGitHub.mockRejectedValue(serviceError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'GitHub service temporarily unavailable',
        errorType: 'SERVICE_UNAVAILABLE_ERROR'
      });
    });

    it('should handle timeout scenarios', async () => {
      // Arrange
      const mockCode = 'timeout_code';
      const mockState = 'timeout_state';
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';

      mockAuthenticateWithGitHub.mockRejectedValue(timeoutError);

      // Act
      const result = await handleGitHubSignIn({
        code: mockCode,
        state: mockState
      });

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'Request timeout',
        errorType: 'TIMEOUT_ERROR'
      });
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent authentication attempts gracefully', async () => {
      // Arrange
      const mockCode1 = 'concurrent_code_1';
      const mockCode2 = 'concurrent_code_2';
      const mockState1 = 'concurrent_state_1';
      const mockState2 = 'concurrent_state_2';

      mockAuthenticateWithGitHub
        .mockResolvedValueOnce({
          user: { id: 'user_1', login: 'user1', email: 'user1@example.com', name: 'User 1', avatar_url: 'avatar1.jpg' },
          accessToken: 'token_1'
        })
        .mockResolvedValueOnce({
          user: { id: 'user_2', login: 'user2', email: 'user2@example.com', name: 'User 2', avatar_url: 'avatar2.jpg' },
          accessToken: 'token_2'
        });

      mockCreateSession
        .mockResolvedValueOnce({ id: 'session_1', userId: 'user_1', accessToken: 'token_1', expiresAt: new Date() })
        .mockResolvedValueOnce({ id: 'session_2', userId: 'user_2', accessToken: 'token_2', expiresAt: new Date() });

      // Act
      const [result1, result2] = await Promise.all([
        handleGitHubSignIn({ code: mockCode1, state: mockState1 }),
        handleGitHubSignIn({ code: mockCode2, state: mockState2 })
      ]);

      // Assert
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockAuthenticateWithGitHub).toHaveBeenCalledTimes(2);
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });
});