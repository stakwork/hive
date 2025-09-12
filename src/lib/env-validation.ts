/**
 * Environment Variable Validation Service
 * 
 * Validates critical environment variables at application startup to prevent
 * runtime failures. Provides clear error messages for missing or invalid variables.
 */

export interface EnvironmentValidationError {
  variable: string;
  value?: string;
  error: string;
  severity: 'critical' | 'warning' | 'info';
  helpText?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: EnvironmentValidationError[];
  warnings: EnvironmentValidationError[];
}

export interface EnvironmentVariable {
  name: string;
  required: boolean;
  validator?: (value: string) => boolean;
  description: string;
  example?: string;
  defaultValue?: string;
  severity: 'critical' | 'warning' | 'info';
}

/**
 * Critical environment variables that must be present and valid
 */
export const CRITICAL_ENVIRONMENT_VARIABLES: EnvironmentVariable[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    validator: (value: string) => {
      // Validate database URL format (postgresql://, mysql://, sqlite:, etc.)
      const dbUrlPattern = /^(postgresql|mysql|sqlite|mongodb|redis):\/\/.+/i;
      return dbUrlPattern.test(value) && value.length > 10;
    },
    description: 'Database connection URL for Prisma',
    example: 'postgresql://user:password@localhost:5432/database',
    severity: 'critical'
  },
  {
    name: 'NEXTAUTH_SECRET',
    required: true,
    validator: (value: string) => {
      // Must be at least 32 characters for security
      return value.length >= 32;
    },
    description: 'NextAuth.js secret for session encryption',
    example: 'your-super-secret-nextauth-secret-key-here-32-chars-minimum',
    severity: 'critical'
  },
  {
    name: 'NEXTAUTH_URL',
    required: true,
    validator: (value: string) => {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    },
    description: 'Base URL for NextAuth.js callbacks',
    example: 'http://localhost:3000 or https://your-app.com',
    severity: 'critical'
  },
  {
    name: 'STAKWORK_API_KEY',
    required: false,
    validator: (value: string) => {
      // API key should be alphanumeric and at least 20 characters
      return /^[a-zA-Z0-9]{20,}$/.test(value);
    },
    description: 'API key for Stakwork integration',
    example: 'your-stakwork-api-key-here',
    severity: 'warning'
  },
  {
    name: 'JWT_SECRET',
    required: true,
    validator: (value: string) => {
      // JWT secret should be at least 32 characters
      return value.length >= 32;
    },
    description: 'Secret key for JWT token signing',
    example: 'your-jwt-secret-key-here-32-chars-minimum',
    severity: 'critical'
  },
  {
    name: 'REDIS_URL',
    required: false,
    validator: (value: string) => {
      // Redis URL format validation
      const redisUrlPattern = /^redis:\/\/.+/i;
      return redisUrlPattern.test(value);
    },
    description: 'Redis connection URL for caching and sessions',
    example: 'redis://localhost:6379',
    severity: 'info'
  },
  {
    name: 'NODE_ENV',
    required: true,
    validator: (value: string) => {
      return ['development', 'production', 'test'].includes(value);
    },
    description: 'Node.js environment mode',
    example: 'development, production, or test',
    defaultValue: 'development',
    severity: 'critical'
  }
];

/**
 * Validates a single environment variable
 */
export function validateEnvironmentVariable(envVar: EnvironmentVariable): EnvironmentValidationError | null {
  const value = process.env[envVar.name];

  // Check if required variable is missing
  if (envVar.required && (!value || value.trim() === '')) {
    return {
      variable: envVar.name,
      error: `Missing required environment variable: ${envVar.name}`,
      severity: envVar.severity,
      helpText: `${envVar.description}. Example: ${envVar.example || 'N/A'}`
    };
  }

  // If not required and not present, skip validation
  if (!value || value.trim() === '') {
    if (!envVar.required && envVar.severity === 'info') {
      return {
        variable: envVar.name,
        error: `Optional environment variable not set: ${envVar.name}`,
        severity: 'info',
        helpText: `${envVar.description}. Example: ${envVar.example || 'N/A'}`
      };
    }
    return null;
  }

  // Validate format if validator is provided
  if (envVar.validator && !envVar.validator(value)) {
    return {
      variable: envVar.name,
      value: value.substring(0, 20) + (value.length > 20 ? '...' : ''),
      error: `Invalid format for environment variable: ${envVar.name}`,
      severity: envVar.severity,
      helpText: `${envVar.description}. Example: ${envVar.example || 'N/A'}`
    };
  }

  return null;
}

/**
 * Validates all critical environment variables
 */
export function validateEnvironmentVariables(variables: EnvironmentVariable[] = CRITICAL_ENVIRONMENT_VARIABLES): ValidationResult {
  const errors: EnvironmentValidationError[] = [];
  const warnings: EnvironmentValidationError[] = [];

  for (const envVar of variables) {
    const error = validateEnvironmentVariable(envVar);
    if (error) {
      if (error.severity === 'critical') {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Formats validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  const messages: string[] = [];

  if (result.errors.length > 0) {
    messages.push('❌ Critical Environment Variable Errors:');
    result.errors.forEach(error => {
      messages.push(`  • ${error.variable}: ${error.error}`);
      if (error.helpText) {
        messages.push(`    ${error.helpText}`);
      }
    });
  }

  if (result.warnings.length > 0) {
    messages.push('⚠️  Environment Variable Warnings:');
    result.warnings.forEach(warning => {
      messages.push(`  • ${warning.variable}: ${warning.error}`);
      if (warning.helpText) {
        messages.push(`    ${warning.helpText}`);
      }
    });
  }

  return messages.join('\n');
}

/**
 * Validates environment variables and throws error if critical variables are missing
 * Used for startup validation with fail-fast behavior
 */
export function validateEnvironmentVariablesOrThrow(variables?: EnvironmentVariable[]): ValidationResult {
  const result = validateEnvironmentVariables(variables);

  if (!result.isValid) {
    const errorMessage = formatValidationErrors(result);
    throw new Error(`Environment validation failed:\n\n${errorMessage}\n\nApplication cannot start with missing critical environment variables.`);
  }

  // Log warnings even if validation passes
  if (result.warnings.length > 0) {
    console.warn('Environment Variable Warnings:');
    result.warnings.forEach(warning => {
      console.warn(`  • ${warning.error}`);
      if (warning.helpText) {
        console.warn(`    ${warning.helpText}`);
      }
    });
  }

  return result;
}

/**
 * Gets environment variable with validation
 */
export function getValidatedEnvVar(name: string, defaultValue?: string, validator?: (value: string) => boolean): string {
  const envVar: EnvironmentVariable = {
    name,
    required: !defaultValue,
    validator,
    description: `Environment variable: ${name}`,
    defaultValue,
    severity: defaultValue ? 'warning' : 'critical'
  };

  const error = validateEnvironmentVariable(envVar);
  
  if (error && error.severity === 'critical') {
    throw new Error(`${error.error}. ${error.helpText || ''}`);
  }

  return process.env[name] || defaultValue || '';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}