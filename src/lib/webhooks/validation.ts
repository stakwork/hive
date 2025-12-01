/**
 * Webhook Payload Validation Utilities
 * 
 * Provides type-safe validation for webhook payloads to prevent runtime crashes
 * from accessing undefined or null fields.
 */

export class WebhookValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

/**
 * Validates that a field exists and is not null/undefined
 */
export function validateRequiredField<T>(
  payload: unknown,
  fieldPath: string,
  fieldName: string = fieldPath
): T {
  const value = getNestedField(payload, fieldPath);
  
  if (value === null || value === undefined) {
    throw new WebhookValidationError(
      `Missing required field: ${fieldName}`,
      fieldPath,
      `The webhook payload must include a '${fieldName}' field`
    );
  }
  
  return value as T;
}

/**
 * Validates that a field exists and is a non-empty string
 */
export function validateRequiredString(
  payload: unknown,
  fieldPath: string,
  fieldName: string = fieldPath
): string {
  const value = validateRequiredField<unknown>(payload, fieldPath, fieldName);
  
  if (typeof value !== 'string') {
    throw new WebhookValidationError(
      `Invalid field type: ${fieldName} must be a string`,
      fieldPath,
      `Expected string, got ${typeof value}`
    );
  }
  
  if (value.trim().length === 0) {
    throw new WebhookValidationError(
      `Invalid field value: ${fieldName} cannot be empty`,
      fieldPath,
      'String field must contain at least one non-whitespace character'
    );
  }
  
  return value;
}

/**
 * Validates that a field exists and is an object
 */
export function validateRequiredObject<T extends Record<string, unknown>>(
  payload: unknown,
  fieldPath: string,
  fieldName: string = fieldPath
): T {
  const value = validateRequiredField<unknown>(payload, fieldPath, fieldName);
  
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebhookValidationError(
      `Invalid field type: ${fieldName} must be an object`,
      fieldPath,
      `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`
    );
  }
  
  return value as T;
}

/**
 * Gets a nested field from an object using dot notation
 */
function getNestedField(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  
  const parts = path.split('.');
  let current: any = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Validates multiple required fields at once
 */
export function validateRequiredFields(
  payload: unknown,
  fields: Array<{ path: string; name?: string; type?: 'string' | 'object' }>
): void {
  for (const field of fields) {
    const fieldName = field.name || field.path;
    
    if (field.type === 'string') {
      validateRequiredString(payload, field.path, fieldName);
    } else if (field.type === 'object') {
      validateRequiredObject(payload, field.path, fieldName);
    } else {
      validateRequiredField(payload, field.path, fieldName);
    }
  }
}

// GitHub-specific validation types and functions

export interface GitHubWebhookPayload {
  action?: string;
  sender: {
    login: string;
    id: number;
    type: string;
  };
  repository?: {
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    owner: {
      login: string;
      id: number;
    };
  };
  installation?: {
    id: number;
  };
}

export interface GitHubPushPayload extends GitHubWebhookPayload {
  ref: string;
  repository: NonNullable<GitHubWebhookPayload['repository']>;
  commits: Array<{
    id: string;
    message: string;
  }>;
}

export interface GitHubPullRequestPayload extends GitHubWebhookPayload {
  action: string;
  pull_request: {
    id: number;
    number: number;
    state: string;
    title: string;
  };
  repository: NonNullable<GitHubWebhookPayload['repository']>;
}

/**
 * Validates common GitHub webhook fields that are present in all events
 */
export function validateGitHubWebhookBase(payload: unknown): GitHubWebhookPayload {
  // Validate sender object and its required fields
  validateRequiredObject(payload, 'sender', 'sender');
  validateRequiredString(payload, 'sender.login', 'sender.login');
  validateRequiredField(payload, 'sender.id', 'sender.id');
  
  return payload as GitHubWebhookPayload;
}

/**
 * Validates GitHub push event payload
 */
export function validateGitHubPushPayload(payload: unknown): GitHubPushPayload {
  validateGitHubWebhookBase(payload);
  
  // Push-specific validations
  validateRequiredString(payload, 'ref', 'ref');
  validateRequiredObject(payload, 'repository', 'repository');
  validateRequiredString(payload, 'repository.html_url', 'repository.html_url');
  validateRequiredField(payload, 'commits', 'commits');
  
  return payload as GitHubPushPayload;
}

/**
 * Validates GitHub pull request event payload
 */
export function validateGitHubPullRequestPayload(payload: unknown): GitHubPullRequestPayload {
  validateGitHubWebhookBase(payload);
  
  // Pull request-specific validations
  validateRequiredString(payload, 'action', 'action');
  validateRequiredObject(payload, 'pull_request', 'pull_request');
  validateRequiredField(payload, 'pull_request.number', 'pull_request.number');
  validateRequiredObject(payload, 'repository', 'repository');
  validateRequiredString(payload, 'repository.html_url', 'repository.html_url');
  
  return payload as GitHubPullRequestPayload;
}

/**
 * Validates GitHub installation event payload
 */
export function validateGitHubInstallationPayload(payload: unknown): GitHubWebhookPayload {
  validateGitHubWebhookBase(payload);
  
  // Installation-specific validations
  validateRequiredString(payload, 'action', 'action');
  validateRequiredObject(payload, 'installation', 'installation');
  validateRequiredField(payload, 'installation.id', 'installation.id');
  
  return payload as GitHubWebhookPayload;
}

/**
 * Type guard to check if validation error
 */
export function isWebhookValidationError(error: unknown): error is WebhookValidationError {
  return error instanceof WebhookValidationError;
}