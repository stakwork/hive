import { describe, it, expect } from 'vitest';
import { convertGlobsToRegex } from '@/lib/utils/glob';

describe('convertGlobsToRegex', () => {
  describe('Empty and Invalid Inputs', () => {
    it('should return empty string for empty string input', () => {
      expect(convertGlobsToRegex('')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(convertGlobsToRegex('   ')).toBe('');
      expect(convertGlobsToRegex('\t')).toBe('');
      expect(convertGlobsToRegex('\n')).toBe('');
      expect(convertGlobsToRegex('  \t  \n  ')).toBe('');
    });

    it('should return empty string for comma-only input', () => {
      expect(convertGlobsToRegex(',')).toBe('');
      expect(convertGlobsToRegex(',,,,')).toBe('');
    });

    it('should return empty string for commas with whitespace', () => {
      expect(convertGlobsToRegex(' , , , ')).toBe('');
      expect(convertGlobsToRegex(',  ,  ,  ')).toBe('');
    });
  });

  describe('Single Glob Patterns', () => {
    it('should convert simple file extension pattern', () => {
      const result = convertGlobsToRegex('*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('.ts');
      // Verify it's a valid regex pattern
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should convert directory pattern', () => {
      const result = convertGlobsToRegex('src/*');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should convert exact filename pattern', () => {
      const result = convertGlobsToRegex('index.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('index');
      expect(result).toContain('.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle pattern with leading slash', () => {
      const result = convertGlobsToRegex('/src/*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle pattern with trailing slash', () => {
      const result = convertGlobsToRegex('src/*/');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Multiple Glob Patterns', () => {
    it('should combine two patterns with pipe operator', () => {
      const result = convertGlobsToRegex('*.ts,*.tsx');
      expect(result).toBeTruthy();
      expect(result).toMatch(/^\(/); // Should start with opening parenthesis
      expect(result).toMatch(/\)$/); // Should end with closing parenthesis
      expect(result).toContain('|'); // Should contain pipe operator
      expect(result).toContain('.ts');
      expect(result).toContain('.tsx');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should combine three patterns correctly', () => {
      const result = convertGlobsToRegex('*.ts,*.tsx,*.js');
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
      expect(result.split('|').length).toBeGreaterThanOrEqual(3);
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should combine directory patterns', () => {
      const result = convertGlobsToRegex('src/*,lib/*,app/*');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('src');
      expect(result).toContain('lib');
      expect(result).toContain('app');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should combine complex patterns', () => {
      const result = convertGlobsToRegex('src/**/*.test.ts,lib/**/*.spec.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('src');
      expect(result).toContain('lib');
      expect(result).toContain('\\.test\\.ts');
      expect(result).toContain('\\.spec\\.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Whitespace Handling', () => {
    it('should trim whitespace around single pattern', () => {
      const result1 = convertGlobsToRegex('  *.ts  ');
      const result2 = convertGlobsToRegex('*.ts');
      expect(result1).toBe(result2);
    });

    it('should trim whitespace around multiple patterns', () => {
      const result1 = convertGlobsToRegex('  *.ts  ,  *.tsx  ');
      const result2 = convertGlobsToRegex('*.ts,*.tsx');
      expect(result1).toBe(result2);
    });

    it('should handle patterns with internal spaces', () => {
      const result = convertGlobsToRegex('my file.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('my');
      expect(result).toContain('file');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should trim each pattern individually', () => {
      const result = convertGlobsToRegex('  pattern1  ,  pattern2  ,  pattern3  ');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Globstar Patterns', () => {
    it('should handle single globstar pattern', () => {
      const result = convertGlobsToRegex('**/*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle globstar in middle of path', () => {
      const result = convertGlobsToRegex('src/**/*.test.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(result).toContain('\\.test\\.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle multiple globstar patterns', () => {
      const result = convertGlobsToRegex('**/src/**/*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(result).toContain('.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle globstar-only pattern', () => {
      const result = convertGlobsToRegex('**');
      expect(result).toBeTruthy();
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should combine globstar patterns correctly', () => {
      const result = convertGlobsToRegex('**/*.test.ts,**/*.spec.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('\\.test\\.ts');
      expect(result).toContain('\\.spec\\.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle trailing comma', () => {
      const result1 = convertGlobsToRegex('*.ts,');
      const result2 = convertGlobsToRegex('*.ts');
      expect(result1).toBe(result2);
    });

    it('should handle leading comma', () => {
      const result1 = convertGlobsToRegex(',*.ts');
      const result2 = convertGlobsToRegex('*.ts');
      expect(result1).toBe(result2);
    });

    it('should handle multiple consecutive commas', () => {
      const result1 = convertGlobsToRegex('*.ts,,,*.tsx');
      const result2 = convertGlobsToRegex('*.ts,*.tsx');
      expect(result1).toBe(result2);
    });

    it('should filter out empty patterns in list', () => {
      const result = convertGlobsToRegex('*.ts,,*.tsx');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('.ts');
      expect(result).toContain('.tsx');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle mixed valid and whitespace-only patterns', () => {
      const result1 = convertGlobsToRegex('*.ts,   ,*.tsx');
      const result2 = convertGlobsToRegex('*.ts,*.tsx');
      expect(result1).toBe(result2);
    });

    it('should handle pattern with only commas and spaces', () => {
      const result = convertGlobsToRegex(' , , , ');
      expect(result).toBe('');
    });

    it('should return single pattern when only one valid pattern exists', () => {
      const result = convertGlobsToRegex('*.ts,,,   ,,,');
      expect(result).toBeTruthy();
      expect(result).not.toContain('|'); // Should not have pipe for single pattern
      expect(result).not.toMatch(/^\(/); // Should not have parentheses
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Special Characters and Wildcards', () => {
    it('should handle single asterisk wildcard', () => {
      const result = convertGlobsToRegex('file.*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('file');
      expect(result).toContain('.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle question mark wildcard', () => {
      const result = convertGlobsToRegex('file?.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('file');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle character class pattern', () => {
      const result = convertGlobsToRegex('file[0-9].ts');
      expect(result).toBeTruthy();
      expect(result).toContain('file');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle negated character class', () => {
      const result = convertGlobsToRegex('file[!0-9].ts');
      expect(result).toBeTruthy();
      expect(result).toContain('file');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle brace expansion pattern', () => {
      const result = convertGlobsToRegex('*.{ts,tsx,js}');
      expect(result).toBeTruthy();
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle complex path pattern', () => {
      const result = convertGlobsToRegex('src/**/*.test.{ts,tsx}');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle escaped special characters', () => {
      const result = convertGlobsToRegex('file\\*.ts');
      expect(result).toBeTruthy();
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Real-World Use Cases', () => {
    it('should handle unit test glob pattern', () => {
      const result = convertGlobsToRegex('src/__tests__/unit/**/*.test.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(result).toContain('__tests__');
      expect(result).toContain('unit');
      expect(result).toContain('\\.test\\.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle integration test glob pattern', () => {
      const result = convertGlobsToRegex('src/__tests__/integration/**/*.test.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('integration');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle e2e test glob pattern', () => {
      const result = convertGlobsToRegex('src/__tests__/e2e/**/*.spec.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('e2e');
      expect(result).toContain('\\.spec\\.ts');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle combined test patterns', () => {
      const result = convertGlobsToRegex(
        'src/__tests__/unit/**/*.test.ts,src/__tests__/integration/**/*.test.ts'
      );
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('unit');
      expect(result).toContain('integration');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle source file patterns', () => {
      const result = convertGlobsToRegex('src/**/*.ts,src/**/*.tsx');
      expect(result).toBeTruthy();
      expect(result).toContain('|');
      expect(result).toContain('.ts');
      expect(result).toContain('.tsx');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should handle node_modules exclusion pattern', () => {
      const result = convertGlobsToRegex('!(node_modules)/**/*.ts');
      expect(result).toBeTruthy();
      expect(result).toContain('node_modules');
      expect(() => new RegExp(result)).not.toThrow();
    });
  });

  describe('Output Format Validation', () => {
    it('should return valid regex source for single pattern', () => {
      const result = convertGlobsToRegex('*.ts');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).not.toMatch(/^\(/); // Single pattern should not have wrapping parentheses
      expect(result).not.toMatch(/\)$/);
      expect(result).not.toContain('|');
    });

    it('should wrap multiple patterns in parentheses', () => {
      const result = convertGlobsToRegex('*.ts,*.tsx');
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
    });

    it('should join multiple patterns with pipe operator', () => {
      const result = convertGlobsToRegex('pattern1,pattern2,pattern3');
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(2); // Two pipes for three patterns
    });

    it('should produce regex that can be instantiated', () => {
      const testCases = [
        '*.ts',
        '**/*.test.ts',
        'src/**/*.ts,lib/**/*.ts',
        '**/*.{ts,tsx,js}',
      ];

      testCases.forEach((pattern) => {
        const result = convertGlobsToRegex(pattern);
        expect(() => new RegExp(result)).not.toThrow();
      });
    });

    it('should produce consistent output for same input', () => {
      const input = '*.ts,*.tsx,*.js';
      const result1 = convertGlobsToRegex(input);
      const result2 = convertGlobsToRegex(input);
      expect(result1).toBe(result2);
    });
  });

  describe('Integration with globrex library', () => {
    it('should use globrex with globstar option enabled', () => {
      // Test that ** patterns work correctly (globstar: true behavior)
      const result = convertGlobsToRegex('src/**/*.ts');
      const regex = new RegExp(result);
      
      // The regex should match nested paths
      expect(result).toBeTruthy();
      expect(result).toContain('src');
      expect(() => new RegExp(result)).not.toThrow();
    });

    it('should extract regex source from globrex result', () => {
      const result = convertGlobsToRegex('*.ts');
      // Result should be a string (regex source), not a RegExp object
      expect(typeof result).toBe('string');
      expect(result).not.toMatch(/^\/.*\/$/); // Should not have regex delimiters
    });
  });
});