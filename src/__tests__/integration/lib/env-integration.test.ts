import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateEnvironmentVariablesOrThrow } from '@/lib/env-validation';

describe('Environment Variable Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Start with clean environment
    process.env = {};
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Complete Environment Setup', () => {
    test('should pass validation with complete valid environment', () => {
      // Set up complete valid environment
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb';
      process.env.NEXTAUTH_SECRET = 'super-secret-nextauth-key-32-characters-minimum';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'jwt-secret-key-32-characters-minimum-length';
      process.env.NODE_ENV = 'test';
      process.env.STAKWORK_API_KEY = 'stakwork-api-key-20-characters-min';

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });

    test('should pass validation with minimal required environment', () => {
      // Set up minimal required environment
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb';
      process.env.NEXTAUTH_SECRET = 'super-secret-nextauth-key-32-characters-minimum';
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      process.env.JWT_SECRET = 'jwt-secret-key-32-characters-minimum-length';
      process.env.NODE_ENV = 'test';

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });

    test('should fail validation with missing critical variables', () => {
      // Only set some variables
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb';
      process.env.NODE_ENV = 'test';
      // Missing NEXTAUTH_SECRET, NEXTAUTH_URL, JWT_SECRET

      expect(() => validateEnvironmentVariablesOrThrow()).toThrow(/Environment validation failed/);
    });
  });

  describe('Database URL Validation', () => {
    test('should accept various valid database URLs', () => {
      const validUrls = [
        'postgresql://user:pass@localhost:5432/db',
        'mysql://user:pass@localhost:3306/db',
        'sqlite:///path/to/db.sqlite',
        'mongodb://user:pass@localhost:27017/db'
      ];

      for (const url of validUrls) {
        process.env = {
          DATABASE_URL: url,
          NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
          NEXTAUTH_URL: 'http://localhost:3000',
          JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
          NODE_ENV: 'test'
        };

        expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
      }
    });

    test('should reject invalid database URLs', () => {
      const invalidUrls = [
        'invalid-url',
        'http://not-a-database',
        'ftp://wrong-protocol',
        'db://too-short'
      ];

      for (const url of invalidUrls) {
        process.env = {
          DATABASE_URL: url,
          NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
          NEXTAUTH_URL: 'http://localhost:3000',
          JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
          NODE_ENV: 'test'
        };

        expect(() => validateEnvironmentVariablesOrThrow()).toThrow();
      }
    });
  });

  describe('Authentication Secrets Validation', () => {
    test('should require minimum length for secrets', () => {
      // Test NEXTAUTH_SECRET
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'too-short',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'test'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).toThrow();

      // Test JWT_SECRET
      process.env.NEXTAUTH_SECRET = 'super-secret-nextauth-key-32-characters-minimum';
      process.env.JWT_SECRET = 'too-short';

      expect(() => validateEnvironmentVariablesOrThrow()).toThrow();
    });

    test('should accept valid length secrets', () => {
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'test'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });
  });

  describe('URL Validation', () => {
    test('should accept valid URLs for NEXTAUTH_URL', () => {
      const validUrls = [
        'http://localhost:3000',
        'https://localhost:3000',
        'http://example.com',
        'https://app.example.com',
        'http://192.168.1.1:3000'
      ];

      for (const url of validUrls) {
        process.env = {
          DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
          NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
          NEXTAUTH_URL: url,
          JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
          NODE_ENV: 'test'
        };

        expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
      }
    });

    test('should reject invalid URLs for NEXTAUTH_URL', () => {
      const invalidUrls = [
        'not-a-url',
        'ftp://example.com',
        'localhost:3000',
        '//example.com',
        ''
      ];

      for (const url of invalidUrls) {
        process.env = {
          DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
          NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
          NEXTAUTH_URL: url,
          JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
          NODE_ENV: 'test'
        };

        expect(() => validateEnvironmentVariablesOrThrow()).toThrow();
      }
    });
  });

  describe('NODE_ENV Validation', () => {
    test('should accept valid NODE_ENV values', () => {
      const validEnvs = ['development', 'production', 'test'];

      for (const nodeEnv of validEnvs) {
        process.env = {
          DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
          NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
          NEXTAUTH_URL: 'http://localhost:3000',
          JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
          NODE_ENV: nodeEnv
        };

        expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
      }
    });

    test('should reject invalid NODE_ENV values', () => {
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'invalid-env'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).toThrow();
    });
  });

  describe('Optional Variables', () => {
    test('should not fail validation for missing optional variables', () => {
      // Set only required variables, leave optional ones unset
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'test'
        // STAKWORK_API_KEY, REDIS_URL are optional
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });

    test('should validate optional variables when present', () => {
      // Set optional variables with invalid format
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'test',
        STAKWORK_API_KEY: 'invalid-key', // Too short and invalid format
        REDIS_URL: 'invalid-redis-url' // Invalid format
      };

      // Optional variables with invalid format generate warnings/info but don't cause throw
      // Only critical errors cause the function to throw
      const result = validateEnvironmentVariablesOrThrow();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.isValid).toBe(true); // Still valid because no critical errors
    });

    test('should pass validation for valid optional variables', () => {
      process.env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
        NEXTAUTH_SECRET: 'super-secret-nextauth-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-key-32-characters-minimum-length',
        NODE_ENV: 'test',
        STAKWORK_API_KEY: 'validstakworkapikey20characters',
        REDIS_URL: 'redis://localhost:6379'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });
  });

  describe('Real-world Scenarios', () => {
    test('should validate typical development environment', () => {
      process.env = {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:password@localhost:5432/hive_dev',
        NEXTAUTH_SECRET: 'development-secret-key-32-characters-minimum',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'development-jwt-secret-32-characters-minimum',
        GITHUB_CLIENT_ID: 'github-client-id',
        GITHUB_CLIENT_SECRET: 'github-client-secret'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });

    test('should validate typical production environment', () => {
      process.env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:secure-password@db.example.com:5432/hive_production',
        NEXTAUTH_SECRET: 'production-super-secure-secret-key-32-characters-minimum',
        NEXTAUTH_URL: 'https://app.example.com',
        JWT_SECRET: 'production-jwt-secret-key-32-characters-minimum-length',
        STAKWORK_API_KEY: 'productionvalidstakworkapikey20characters',
        REDIS_URL: 'redis://redis.example.com:6379',
        GITHUB_CLIENT_ID: 'production-github-client-id',
        GITHUB_CLIENT_SECRET: 'production-github-client-secret'
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });

    test('should handle edge cases in variable values', () => {
      process.env = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:p@ssw0rd!@localhost:5432/test_db',
        NEXTAUTH_SECRET: '!@#$%^&*()_+-=[]{}|;:,.<>?`~32chars',
        NEXTAUTH_URL: 'http://localhost:3000',
        JWT_SECRET: 'jwt-secret-with-special-chars-!@#$%^&*()',
      };

      expect(() => validateEnvironmentVariablesOrThrow()).not.toThrow();
    });
  });

  describe('Error Message Quality', () => {
    test('should provide helpful error messages', () => {
      process.env = {
        NODE_ENV: 'test'
        // Missing all critical variables
      };

      let errorMessage = '';
      try {
        validateEnvironmentVariablesOrThrow();
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain('Environment validation failed');
      expect(errorMessage).toContain('DATABASE_URL');
      expect(errorMessage).toContain('NEXTAUTH_SECRET');
      expect(errorMessage).toContain('JWT_SECRET');
      expect(errorMessage).toContain('Example:');
    });

    test('should include helpful context in error messages', () => {
      process.env = {
        NODE_ENV: 'test',
        DATABASE_URL: 'invalid',
        NEXTAUTH_SECRET: 'short',
        NEXTAUTH_URL: 'invalid-url',
        JWT_SECRET: 'short'
      };

      let errorMessage = '';
      try {
        validateEnvironmentVariablesOrThrow();
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain('Invalid format');
      expect(errorMessage).toContain('postgresql://');
      expect(errorMessage).toContain('32');
    });
  });
});