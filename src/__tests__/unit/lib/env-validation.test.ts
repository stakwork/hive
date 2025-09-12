import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateEnvironmentVariable,
  validateEnvironmentVariables,
  validateEnvironmentVariablesOrThrow,
  formatValidationErrors,
  getValidatedEnvVar,
  isDevelopment,
  isProduction,
  isTest,
  CRITICAL_ENVIRONMENT_VARIABLES,
  type EnvironmentVariable,
  type ValidationResult
} from '@/lib/env-validation';

describe('Environment Variable Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables for each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('validateEnvironmentVariable', () => {
    test('should return null for valid required variable', () => {
      process.env.TEST_VAR = 'valid-value';
      
      const envVar: EnvironmentVariable = {
        name: 'TEST_VAR',
        required: true,
        validator: (value) => value.length > 5,
        description: 'Test variable',
        severity: 'critical'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result).toBeNull();
    });

    test('should return error for missing required variable', () => {
      delete process.env.TEST_VAR;
      
      const envVar: EnvironmentVariable = {
        name: 'TEST_VAR',
        required: true,
        description: 'Test variable',
        example: 'test-example',
        severity: 'critical'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result).toEqual({
        variable: 'TEST_VAR',
        error: 'Missing required environment variable: TEST_VAR',
        severity: 'critical',
        helpText: 'Test variable. Example: test-example'
      });
    });

    test('should return error for invalid variable format', () => {
      process.env.TEST_VAR = 'short';
      
      const envVar: EnvironmentVariable = {
        name: 'TEST_VAR',
        required: true,
        validator: (value) => value.length > 10,
        description: 'Test variable',
        example: 'long-test-example',
        severity: 'critical'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result).toEqual({
        variable: 'TEST_VAR',
        value: 'short',
        error: 'Invalid format for environment variable: TEST_VAR',
        severity: 'critical',
        helpText: 'Test variable. Example: long-test-example'
      });
    });

    test('should return null for optional variable not set', () => {
      delete process.env.OPTIONAL_VAR;
      
      const envVar: EnvironmentVariable = {
        name: 'OPTIONAL_VAR',
        required: false,
        description: 'Optional variable',
        severity: 'warning'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result).toBeNull();
    });

    test('should return info message for optional info variable not set', () => {
      delete process.env.INFO_VAR;
      
      const envVar: EnvironmentVariable = {
        name: 'INFO_VAR',
        required: false,
        description: 'Info variable',
        example: 'info-example',
        severity: 'info'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result).toEqual({
        variable: 'INFO_VAR',
        error: 'Optional environment variable not set: INFO_VAR',
        severity: 'info',
        helpText: 'Info variable. Example: info-example'
      });
    });

    test('should truncate long values in error messages', () => {
      process.env.TEST_VAR = 'a'.repeat(50);
      
      const envVar: EnvironmentVariable = {
        name: 'TEST_VAR',
        required: true,
        validator: () => false,
        description: 'Test variable',
        severity: 'critical'
      };

      const result = validateEnvironmentVariable(envVar);
      expect(result?.value).toBe('a'.repeat(20) + '...');
    });
  });

  describe('validateEnvironmentVariables', () => {
    test('should return valid result when all variables are present and valid', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.NEXTAUTH_SECRET = 'a'.repeat(32);
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'b'.repeat(32);
      process.env.NODE_ENV = 'development';

      const result = validateEnvironmentVariables();
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should return errors for missing critical variables', () => {
      // Clear all environment variables
      process.env = {};

      const result = validateEnvironmentVariables();
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      
      const missingVars = result.errors.map(e => e.variable);
      expect(missingVars).toContain('DATABASE_URL');
      expect(missingVars).toContain('NEXTAUTH_SECRET');
      expect(missingVars).toContain('JWT_SECRET');
    });

    test('should separate errors and warnings by severity', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.NEXTAUTH_SECRET = 'a'.repeat(32);
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'b'.repeat(32);
      process.env.NODE_ENV = 'development';
      // STAKWORK_API_KEY is optional (warning severity)

      const result = validateEnvironmentVariables();
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should validate custom variable list', () => {
      const customVars: EnvironmentVariable[] = [
        {
          name: 'CUSTOM_VAR',
          required: true,
          description: 'Custom variable',
          severity: 'critical'
        }
      ];

      const result = validateEnvironmentVariables(customVars);
      
      expect(result.isValid).toBe(false);
      expect(result.errors[0].variable).toBe('CUSTOM_VAR');
    });
  });

  describe('validateEnvironmentVariablesOrThrow', () => {
    test('should throw error when validation fails', () => {
      process.env = {};

      expect(() => validateEnvironmentVariablesOrThrow()).toThrow();
    });

    test('should return result when validation passes', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.NEXTAUTH_SECRET = 'a'.repeat(32);
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'b'.repeat(32);
      process.env.NODE_ENV = 'development';

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = validateEnvironmentVariablesOrThrow();
      
      expect(result.isValid).toBe(true);
      
      consoleSpy.mockRestore();
    });

    test('should log warnings even when validation passes', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.NEXTAUTH_SECRET = 'a'.repeat(32);
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'b'.repeat(32);
      process.env.NODE_ENV = 'development';

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      validateEnvironmentVariablesOrThrow();
      
      // Should have warnings for optional variables
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('formatValidationErrors', () => {
    test('should format errors and warnings correctly', () => {
      const result: ValidationResult = {
        isValid: false,
        errors: [
          {
            variable: 'DATABASE_URL',
            error: 'Missing required environment variable: DATABASE_URL',
            severity: 'critical',
            helpText: 'Database connection URL for Prisma'
          }
        ],
        warnings: [
          {
            variable: 'OPTIONAL_VAR',
            error: 'Optional variable warning',
            severity: 'warning',
            helpText: 'This is optional'
          }
        ]
      };

      const formatted = formatValidationErrors(result);
      
      expect(formatted).toContain('❌ Critical Environment Variable Errors:');
      expect(formatted).toContain('DATABASE_URL');
      expect(formatted).toContain('⚠️  Environment Variable Warnings:');
      expect(formatted).toContain('OPTIONAL_VAR');
    });

    test('should handle empty errors and warnings', () => {
      const result: ValidationResult = {
        isValid: true,
        errors: [],
        warnings: []
      };

      const formatted = formatValidationErrors(result);
      expect(formatted).toBe('');
    });
  });

  describe('getValidatedEnvVar', () => {
    test('should return environment variable value', () => {
      process.env.TEST_VAR = 'test-value';
      
      const result = getValidatedEnvVar('TEST_VAR');
      expect(result).toBe('test-value');
    });

    test('should return default value if variable not set', () => {
      delete process.env.TEST_VAR;
      
      const result = getValidatedEnvVar('TEST_VAR', 'default-value');
      expect(result).toBe('default-value');
    });

    test('should throw error for missing required variable', () => {
      delete process.env.REQUIRED_VAR;
      
      expect(() => getValidatedEnvVar('REQUIRED_VAR')).toThrow();
    });

    test('should validate with custom validator', () => {
      process.env.TEST_VAR = 'short';
      
      expect(() => 
        getValidatedEnvVar('TEST_VAR', undefined, (value) => value.length > 10)
      ).toThrow();
    });
  });

  describe('environment detection helpers', () => {
    test('isDevelopment should detect development environment', () => {
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(true);
      
      process.env.NODE_ENV = 'production';
      expect(isDevelopment()).toBe(false);
    });

    test('isProduction should detect production environment', () => {
      process.env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
      
      process.env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });

    test('isTest should detect test environment', () => {
      process.env.NODE_ENV = 'test';
      expect(isTest()).toBe(true);
      
      process.env.NODE_ENV = 'development';
      expect(isTest()).toBe(false);
    });
  });

  describe('CRITICAL_ENVIRONMENT_VARIABLES', () => {
    test('should include all expected critical variables', () => {
      const varNames = CRITICAL_ENVIRONMENT_VARIABLES.map(v => v.name);
      
      expect(varNames).toContain('DATABASE_URL');
      expect(varNames).toContain('NEXTAUTH_SECRET');
      expect(varNames).toContain('NEXTAUTH_URL');
      expect(varNames).toContain('JWT_SECRET');
      expect(varNames).toContain('NODE_ENV');
    });

    test('should have valid configuration for each variable', () => {
      CRITICAL_ENVIRONMENT_VARIABLES.forEach(envVar => {
        expect(envVar.name).toBeDefined();
        expect(typeof envVar.required).toBe('boolean');
        expect(envVar.description).toBeDefined();
        expect(['critical', 'warning', 'info']).toContain(envVar.severity);
      });
    });

    test('should validate DATABASE_URL format', () => {
      const dbVar = CRITICAL_ENVIRONMENT_VARIABLES.find(v => v.name === 'DATABASE_URL');
      expect(dbVar?.validator?.('postgresql://user:pass@host:5432/db')).toBe(true);
      expect(dbVar?.validator?.('mysql://user:pass@host:3306/db')).toBe(true);
      expect(dbVar?.validator?.('invalid-url')).toBe(false);
    });

    test('should validate NEXTAUTH_SECRET length', () => {
      const authVar = CRITICAL_ENVIRONMENT_VARIABLES.find(v => v.name === 'NEXTAUTH_SECRET');
      expect(authVar?.validator?.('a'.repeat(32))).toBe(true);
      expect(authVar?.validator?.('short')).toBe(false);
    });

    test('should validate NEXTAUTH_URL format', () => {
      const urlVar = CRITICAL_ENVIRONMENT_VARIABLES.find(v => v.name === 'NEXTAUTH_URL');
      expect(urlVar?.validator?.('http://localhost:3000')).toBe(true);
      expect(urlVar?.validator?.('https://example.com')).toBe(true);
      expect(urlVar?.validator?.('invalid-url')).toBe(false);
    });
  });
});