import { describe, it, expect } from 'vitest';
import {
  validateGitHubWebhookBase,
  validateGitHubPushPayload,
  validateGitHubPullRequestPayload,
  WebhookValidationError,
  isWebhookValidationError,
} from '@/lib/webhooks/validation';

/**
 * Integration tests demonstrating how to use webhook validation
 * in API routes to prevent runtime crashes from accessing undefined fields.
 * 
 * These tests simulate real webhook payloads and verify the validation
 * behaves correctly for various scenarios.
 */

describe('Webhook Validation Integration', () => {
  describe('GitHub Push Event Validation', () => {
    it('should validate complete push event payload', () => {
      const pushPayload = {
        ref: 'refs/heads/main',
        before: '0000000000000000000000000000000000000000',
        after: 'abc123def456',
        repository: {
          id: 123456,
          node_id: 'R_kgDOABCDEF',
          name: 'my-repo',
          full_name: 'octocat/my-repo',
          private: false,
          owner: {
            name: 'octocat',
            email: 'octocat@github.com',
            login: 'octocat',
            id: 1,
            node_id: 'MDQ6VXNlcjE=',
            avatar_url: 'https://github.com/images/error/octocat_happy.gif',
            type: 'User',
          },
          html_url: 'https://github.com/octocat/my-repo',
          description: 'This is my awesome repository',
          url: 'https://github.com/octocat/my-repo',
        },
        pusher: {
          name: 'octocat',
          email: 'octocat@github.com',
        },
        sender: {
          login: 'octocat',
          id: 1,
          node_id: 'MDQ6VXNlcjE=',
          avatar_url: 'https://github.com/images/error/octocat_happy.gif',
          type: 'User',
        },
        commits: [
          {
            id: 'abc123def456',
            tree_id: 'tree123',
            distinct: true,
            message: 'Initial commit',
            timestamp: '2024-01-01T00:00:00Z',
            url: 'https://github.com/octocat/my-repo/commit/abc123def456',
            author: {
              name: 'Octocat',
              email: 'octocat@github.com',
              username: 'octocat',
            },
            committer: {
              name: 'Octocat',
              email: 'octocat@github.com',
              username: 'octocat',
            },
            added: ['README.md'],
            removed: [],
            modified: [],
          },
        ],
      };

      // Should not throw
      const result = validateGitHubPushPayload(pushPayload);
      expect(result.sender.login).toBe('octocat');
      expect(result.repository.html_url).toBe('https://github.com/octocat/my-repo');
      expect(result.commits).toHaveLength(1);
    });

    it('should catch missing sender in push payload', () => {
      const invalidPayload = {
        ref: 'refs/heads/main',
        repository: {
          id: 123,
          name: 'repo',
          full_name: 'owner/repo',
          html_url: 'https://github.com/owner/repo',
          owner: { login: 'owner', id: 1 },
        },
        commits: [],
        // Missing sender!
      };

      try {
        validateGitHubPushPayload(invalidPayload);
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(isWebhookValidationError(error)).toBe(true);
        if (isWebhookValidationError(error)) {
          expect(error.field).toBe('sender');
          expect(error.message).toContain('sender');
        }
      }
    });
  });

  describe('GitHub Pull Request Event Validation', () => {
    it('should validate complete pull request payload', () => {
      const prPayload = {
        action: 'opened',
        number: 42,
        pull_request: {
          id: 1,
          node_id: 'MDExOlB1bGxSZXF1ZXN0MQ==',
          number: 42,
          state: 'open',
          locked: false,
          title: 'Add webhook validation',
          user: {
            login: 'octocat',
            id: 1,
          },
          body: 'This PR adds webhook validation to prevent crashes',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          base: {
            ref: 'main',
            sha: 'def456',
          },
        },
        repository: {
          id: 123456,
          name: 'my-repo',
          full_name: 'octocat/my-repo',
          owner: {
            login: 'octocat',
            id: 1,
          },
          html_url: 'https://github.com/octocat/my-repo',
        },
        sender: {
          login: 'octocat',
          id: 1,
          type: 'User',
        },
      };

      const result = validateGitHubPullRequestPayload(prPayload);
      expect(result.action).toBe('opened');
      expect(result.pull_request.number).toBe(42);
      expect(result.sender.login).toBe('octocat');
    });

    it('should catch missing action in pull request payload', () => {
      const invalidPayload = {
        // Missing action!
        pull_request: {
          id: 1,
          number: 42,
          state: 'open',
          title: 'Test PR',
        },
        repository: {
          id: 123,
          name: 'repo',
          full_name: 'owner/repo',
          html_url: 'https://github.com/owner/repo',
          owner: { login: 'owner', id: 1 },
        },
        sender: {
          login: 'octocat',
          id: 1,
          type: 'User',
        },
      };

      try {
        validateGitHubPullRequestPayload(invalidPayload);
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(isWebhookValidationError(error)).toBe(true);
        if (isWebhookValidationError(error)) {
          expect(error.field).toBe('action');
          expect(error.message).toContain('action');
        }
      }
    });
  });

  describe('Error Handling Pattern for API Routes', () => {
    it('should demonstrate proper error handling in webhook routes', () => {
      const malformedPayload = {
        // Completely missing required fields
        some_field: 'value',
      };

      try {
        validateGitHubWebhookBase(malformedPayload);
        expect.fail('Should have thrown validation error');
      } catch (error) {
        // This is the pattern to use in API routes:
        if (isWebhookValidationError(error)) {
          // Return structured error response
          const errorResponse = {
            success: false,
            error: 'Invalid webhook payload',
            field: error.field,
            details: error.details,
            message: error.message,
          };

          expect(errorResponse.success).toBe(false);
          expect(errorResponse.field).toBe('sender');
          expect(errorResponse.message).toContain('Missing required field');
        }
      }
    });

    it('should provide detailed error information for debugging', () => {
      const payloadWithWrongTypes = {
        sender: 'not-an-object', // Should be an object
        repository: {
          html_url: 123, // Should be a string
        },
      };

      try {
        validateGitHubWebhookBase(payloadWithWrongTypes);
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(isWebhookValidationError(error)).toBe(true);
        if (isWebhookValidationError(error)) {
          // Error provides specific field path and expected type
          expect(error.field).toBe('sender');
          expect(error.details).toBeDefined();
        }
      }
    });
  });

  describe('Real-world Malformed Payloads', () => {
    it('should handle payload with null values', () => {
      const payloadWithNulls = {
        sender: null, // Sender exists but is null
        repository: {
          html_url: 'https://github.com/owner/repo',
        },
      };

      expect(() => validateGitHubWebhookBase(payloadWithNulls)).toThrow(WebhookValidationError);
    });

    it('should handle payload with empty strings', () => {
      const payloadWithEmptyStrings = {
        sender: {
          login: '', // Empty string
          id: 1,
        },
      };

      expect(() => validateGitHubWebhookBase(payloadWithEmptyStrings)).toThrow(WebhookValidationError);
    });

    it('should handle deeply nested missing fields', () => {
      const payloadWithPartialNesting = {
        sender: {
          login: 'octocat',
          // Missing id
        },
        repository: {
          owner: {
            // Missing login
            id: 1,
          },
        },
      };

      expect(() => validateGitHubWebhookBase(payloadWithPartialNesting)).toThrow(WebhookValidationError);
    });
  });
});