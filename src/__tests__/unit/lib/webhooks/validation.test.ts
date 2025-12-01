import { describe, it, expect } from 'vitest';
import {
  validateRequiredField,
  validateRequiredString,
  validateRequiredObject,
  validateRequiredFields,
  validateGitHubWebhookBase,
  validateGitHubPushPayload,
  validateGitHubPullRequestPayload,
  validateGitHubInstallationPayload,
  WebhookValidationError,
  isWebhookValidationError,
} from '@/lib/webhooks/validation';

describe('validateRequiredField', () => {
  it('should return field value when field exists', () => {
    const payload = { name: 'test', count: 42 };
    expect(validateRequiredField(payload, 'name')).toBe('test');
    expect(validateRequiredField(payload, 'count')).toBe(42);
  });

  it('should throw error when field is undefined', () => {
    const payload = { name: 'test' };
    expect(() => validateRequiredField(payload, 'missing')).toThrow(WebhookValidationError);
    expect(() => validateRequiredField(payload, 'missing')).toThrow('Missing required field: missing');
  });

  it('should throw error when field is null', () => {
    const payload = { name: null };
    expect(() => validateRequiredField(payload, 'name')).toThrow(WebhookValidationError);
  });

  it('should validate nested fields using dot notation', () => {
    const payload = {
      user: {
        profile: {
          email: 'test@example.com'
        }
      }
    };
    expect(validateRequiredField(payload, 'user.profile.email')).toBe('test@example.com');
  });

  it('should throw error for missing nested fields', () => {
    const payload = { user: { name: 'test' } };
    expect(() => validateRequiredField(payload, 'user.profile.email')).toThrow(WebhookValidationError);
  });

  it('should use custom field name in error message', () => {
    const payload = { data: {} };
    expect(() => validateRequiredField(payload, 'user.id', 'User ID')).toThrow('Missing required field: User ID');
  });
});

describe('validateRequiredString', () => {
  it('should return string value when field is valid string', () => {
    const payload = { name: 'test' };
    expect(validateRequiredString(payload, 'name')).toBe('test');
  });

  it('should throw error when field is not a string', () => {
    const payload = { count: 42 };
    expect(() => validateRequiredString(payload, 'count')).toThrow(WebhookValidationError);
    expect(() => validateRequiredString(payload, 'count')).toThrow('must be a string');
  });

  it('should throw error when string is empty', () => {
    const payload = { name: '' };
    expect(() => validateRequiredString(payload, 'name')).toThrow(WebhookValidationError);
    expect(() => validateRequiredString(payload, 'name')).toThrow('cannot be empty');
  });

  it('should throw error when string is only whitespace', () => {
    const payload = { name: '   ' };
    expect(() => validateRequiredString(payload, 'name')).toThrow(WebhookValidationError);
    expect(() => validateRequiredString(payload, 'name')).toThrow('cannot be empty');
  });

  it('should accept string with whitespace but non-empty content', () => {
    const payload = { name: '  test  ' };
    expect(validateRequiredString(payload, 'name')).toBe('  test  ');
  });
});

describe('validateRequiredObject', () => {
  it('should return object when field is valid object', () => {
    const payload = { user: { id: 1, name: 'test' } };
    const result = validateRequiredObject(payload, 'user');
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('should throw error when field is not an object', () => {
    const payload = { count: 42 };
    expect(() => validateRequiredObject(payload, 'count')).toThrow(WebhookValidationError);
    expect(() => validateRequiredObject(payload, 'count')).toThrow('must be an object');
  });

  it('should throw error when field is null', () => {
    const payload = { user: null };
    expect(() => validateRequiredObject(payload, 'user')).toThrow(WebhookValidationError);
  });

  it('should throw error when field is an array', () => {
    const payload = { items: [1, 2, 3] };
    expect(() => validateRequiredObject(payload, 'items')).toThrow(WebhookValidationError);
    expect(() => validateRequiredObject(payload, 'items')).toThrow('must be an object');
  });
});

describe('validateRequiredFields', () => {
  it('should validate multiple fields successfully', () => {
    const payload = {
      name: 'test',
      count: 42,
      user: { id: 1 }
    };
    
    expect(() => validateRequiredFields(payload, [
      { path: 'name', type: 'string' },
      { path: 'count' },
      { path: 'user', type: 'object' }
    ])).not.toThrow();
  });

  it('should throw error on first invalid field', () => {
    const payload = {
      name: 'test',
      user: { id: 1 }
    };
    
    expect(() => validateRequiredFields(payload, [
      { path: 'name', type: 'string' },
      { path: 'missing' },
      { path: 'user', type: 'object' }
    ])).toThrow(WebhookValidationError);
  });

  it('should validate nested fields', () => {
    const payload = {
      user: {
        profile: {
          email: 'test@example.com'
        }
      }
    };
    
    expect(() => validateRequiredFields(payload, [
      { path: 'user.profile.email', type: 'string', name: 'Email' }
    ])).not.toThrow();
  });
});

describe('validateGitHubWebhookBase', () => {
  it('should validate valid GitHub webhook base payload', () => {
    const payload = {
      sender: {
        login: 'octocat',
        id: 1,
        type: 'User'
      }
    };
    
    const result = validateGitHubWebhookBase(payload);
    expect(result.sender.login).toBe('octocat');
  });

  it('should throw error when sender is missing', () => {
    const payload = {};
    expect(() => validateGitHubWebhookBase(payload)).toThrow(WebhookValidationError);
    expect(() => validateGitHubWebhookBase(payload)).toThrow('sender');
  });

  it('should throw error when sender.login is missing', () => {
    const payload = {
      sender: {
        id: 1
      }
    };
    expect(() => validateGitHubWebhookBase(payload)).toThrow(WebhookValidationError);
    expect(() => validateGitHubWebhookBase(payload)).toThrow('sender.login');
  });

  it('should throw error when sender.id is missing', () => {
    const payload = {
      sender: {
        login: 'octocat'
      }
    };
    expect(() => validateGitHubWebhookBase(payload)).toThrow(WebhookValidationError);
    expect(() => validateGitHubWebhookBase(payload)).toThrow('sender.id');
  });
});

describe('validateGitHubPushPayload', () => {
  const validPushPayload = {
    sender: {
      login: 'octocat',
      id: 1,
      type: 'User'
    },
    ref: 'refs/heads/main',
    repository: {
      id: 123,
      name: 'repo',
      full_name: 'octocat/repo',
      html_url: 'https://github.com/octocat/repo',
      owner: {
        login: 'octocat',
        id: 1
      }
    },
    commits: [
      { id: 'abc123', message: 'Initial commit' }
    ]
  };

  it('should validate valid push payload', () => {
    const result = validateGitHubPushPayload(validPushPayload);
    expect(result.ref).toBe('refs/heads/main');
    expect(result.repository.html_url).toBe('https://github.com/octocat/repo');
  });

  it('should throw error when ref is missing', () => {
    const { ref, ...payloadWithoutRef } = validPushPayload;
    expect(() => validateGitHubPushPayload(payloadWithoutRef)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPushPayload(payloadWithoutRef)).toThrow('ref');
  });

  it('should throw error when repository is missing', () => {
    const { repository, ...payloadWithoutRepo } = validPushPayload;
    expect(() => validateGitHubPushPayload(payloadWithoutRepo)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPushPayload(payloadWithoutRepo)).toThrow('repository');
  });

  it('should throw error when commits is missing', () => {
    const { commits, ...payloadWithoutCommits } = validPushPayload;
    expect(() => validateGitHubPushPayload(payloadWithoutCommits)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPushPayload(payloadWithoutCommits)).toThrow('commits');
  });
});

describe('validateGitHubPullRequestPayload', () => {
  const validPRPayload = {
    action: 'opened',
    sender: {
      login: 'octocat',
      id: 1,
      type: 'User'
    },
    pull_request: {
      id: 1,
      number: 42,
      state: 'open',
      title: 'Add feature'
    },
    repository: {
      id: 123,
      name: 'repo',
      full_name: 'octocat/repo',
      html_url: 'https://github.com/octocat/repo',
      owner: {
        login: 'octocat',
        id: 1
      }
    }
  };

  it('should validate valid pull request payload', () => {
    const result = validateGitHubPullRequestPayload(validPRPayload);
    expect(result.action).toBe('opened');
    expect(result.pull_request.number).toBe(42);
  });

  it('should throw error when action is missing', () => {
    const { action, ...payloadWithoutAction } = validPRPayload;
    expect(() => validateGitHubPullRequestPayload(payloadWithoutAction)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPullRequestPayload(payloadWithoutAction)).toThrow('action');
  });

  it('should throw error when pull_request is missing', () => {
    const { pull_request, ...payloadWithoutPR } = validPRPayload;
    expect(() => validateGitHubPullRequestPayload(payloadWithoutPR)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPullRequestPayload(payloadWithoutPR)).toThrow('pull_request');
  });

  it('should throw error when pull_request.number is missing', () => {
    const payload = {
      ...validPRPayload,
      pull_request: {
        id: 1,
        state: 'open',
        title: 'Add feature'
      }
    };
    expect(() => validateGitHubPullRequestPayload(payload)).toThrow(WebhookValidationError);
    expect(() => validateGitHubPullRequestPayload(payload)).toThrow('pull_request.number');
  });
});

describe('validateGitHubInstallationPayload', () => {
  const validInstallationPayload = {
    action: 'created',
    sender: {
      login: 'octocat',
      id: 1,
      type: 'User'
    },
    installation: {
      id: 123
    }
  };

  it('should validate valid installation payload', () => {
    const result = validateGitHubInstallationPayload(validInstallationPayload);
    expect(result.action).toBe('created');
    expect(result.installation?.id).toBe(123);
  });

  it('should throw error when action is missing', () => {
    const { action, ...payloadWithoutAction } = validInstallationPayload;
    expect(() => validateGitHubInstallationPayload(payloadWithoutAction)).toThrow(WebhookValidationError);
    expect(() => validateGitHubInstallationPayload(payloadWithoutAction)).toThrow('action');
  });

  it('should throw error when installation is missing', () => {
    const { installation, ...payloadWithoutInstallation } = validInstallationPayload;
    expect(() => validateGitHubInstallationPayload(payloadWithoutInstallation)).toThrow(WebhookValidationError);
    expect(() => validateGitHubInstallationPayload(payloadWithoutInstallation)).toThrow('installation');
  });

  it('should throw error when installation.id is missing', () => {
    const payload = {
      ...validInstallationPayload,
      installation: {}
    };
    expect(() => validateGitHubInstallationPayload(payload)).toThrow(WebhookValidationError);
    expect(() => validateGitHubInstallationPayload(payload)).toThrow('installation.id');
  });
});

describe('WebhookValidationError', () => {
  it('should create error with field and details', () => {
    const error = new WebhookValidationError(
      'Missing required field: sender',
      'sender',
      'Sender information is required'
    );
    
    expect(error.message).toBe('Missing required field: sender');
    expect(error.field).toBe('sender');
    expect(error.details).toBe('Sender information is required');
    expect(error.name).toBe('WebhookValidationError');
  });

  it('should work with isWebhookValidationError type guard', () => {
    const validationError = new WebhookValidationError('Test', 'field');
    const genericError = new Error('Test');
    
    expect(isWebhookValidationError(validationError)).toBe(true);
    expect(isWebhookValidationError(genericError)).toBe(false);
    expect(isWebhookValidationError('not an error')).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle payload that is not an object', () => {
    expect(() => validateRequiredField(null, 'field')).toThrow(WebhookValidationError);
    expect(() => validateRequiredField(undefined, 'field')).toThrow(WebhookValidationError);
    expect(() => validateRequiredField('string', 'field')).toThrow(WebhookValidationError);
    expect(() => validateRequiredField(42, 'field')).toThrow(WebhookValidationError);
  });

  it('should handle deeply nested missing fields', () => {
    const payload = {
      level1: {
        level2: {
          level3: 'value'
        }
      }
    };
    
    expect(() => validateRequiredField(payload, 'level1.level2.level4')).toThrow(WebhookValidationError);
    expect(() => validateRequiredField(payload, 'level1.missing.level3')).toThrow(WebhookValidationError);
  });

  it('should handle numeric field names in nested paths', () => {
    const payload = {
      items: {
        '0': { name: 'first' }
      }
    };
    
    expect(validateRequiredField(payload, 'items.0.name')).toBe('first');
  });
});