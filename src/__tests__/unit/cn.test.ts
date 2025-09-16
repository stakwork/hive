import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils/cn';

describe('cn utility function', () => {
  describe('basic functionality', () => {
    it('should merge simple string classes', () => {
      expect(cn('px-2 py-1', 'text-red-500')).toBe('px-2 py-1 text-red-500');
    });

    it('should handle single class string', () => {
      expect(cn('px-2')).toBe('px-2');
    });

    it('should handle multiple separate class arguments', () => {
      expect(cn('px-2', 'py-1', 'text-red-500')).toBe('px-2 py-1 text-red-500');
    });
  });

  describe('conditional classes', () => {
    it('should handle object with true conditions', () => {
      expect(cn({ 'px-2': true, 'py-1': true })).toBe('px-2 py-1');
    });

    it('should filter out false conditions', () => {
      expect(cn({ 'px-2': true, 'py-1': false, 'text-red-500': true })).toBe('px-2 text-red-500');
    });

    it('should handle mixed string and object arguments', () => {
      expect(cn('base-class', { 'conditional-class': true, 'excluded-class': false })).toBe('base-class conditional-class');
    });

    it('should handle array of classes', () => {
      expect(cn(['px-2', 'py-1', { 'text-red-500': true, 'text-blue-500': false }])).toBe('px-2 py-1 text-red-500');
    });
  });

  describe('edge cases and falsy values', () => {
    it('should handle null values', () => {
      expect(cn(null, 'px-2')).toBe('px-2');
      expect(cn('px-2', null)).toBe('px-2');
      expect(cn(null)).toBe('');
    });

    it('should handle undefined values', () => {
      expect(cn(undefined, 'px-2')).toBe('px-2');
      expect(cn('px-2', undefined)).toBe('px-2');
      expect(cn(undefined)).toBe('');
    });

    it('should handle empty strings', () => {
      expect(cn('', 'px-2')).toBe('px-2');
      expect(cn('px-2', '')).toBe('px-2');
      expect(cn('')).toBe('');
    });

    it('should handle mixed falsy values', () => {
      expect(cn(null, undefined, '', false, 0, 'px-2')).toBe('px-2');
    });

    it('should handle empty input', () => {
      expect(cn()).toBe('');
    });

    it('should handle whitespace-only strings', () => {
      expect(cn('   ', 'px-2')).toBe('px-2');
      expect(cn('px-2', '   ')).toBe('px-2');
    });
  });

  describe('Tailwind CSS conflict resolution', () => {
    it('should resolve padding conflicts', () => {
      expect(cn('px-2', 'px-4')).toBe('px-4');
      expect(cn('py-1', 'py-3')).toBe('py-3');
      expect(cn('p-2', 'px-4')).toBe('p-2 px-4'); // p-2 sets py-2, px-4 overrides px-2
    });

    it('should resolve margin conflicts', () => {
      expect(cn('mx-2', 'mx-4')).toBe('mx-4');
      expect(cn('my-1', 'my-3')).toBe('my-3');
      expect(cn('m-2', 'ml-4')).toBe('m-2 ml-4');
    });

    it('should resolve text color conflicts', () => {
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
      expect(cn('text-red-500', 'text-blue-600', 'text-green-400')).toBe('text-green-400');
    });

    it('should resolve background color conflicts', () => {
      expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    });

    it('should resolve width conflicts', () => {
      expect(cn('w-4', 'w-8')).toBe('w-8');
      expect(cn('w-full', 'w-1/2')).toBe('w-1/2');
    });

    it('should resolve height conflicts', () => {
      expect(cn('h-4', 'h-8')).toBe('h-8');
      expect(cn('h-full', 'h-1/2')).toBe('h-1/2');
    });

    it('should handle complex conflict resolution', () => {
      expect(cn('px-2 py-1', 'px-4 py-3', 'px-6')).toBe('py-3 px-6');
    });
  });

  describe('deduplication', () => {
    it('should deduplicate identical classes', () => {
      expect(cn('px-2', 'px-2')).toBe('px-2');
      expect(cn('px-2 py-1', 'px-2')).toBe('py-1 px-2');
    });

    it('should deduplicate classes from different arguments', () => {
      expect(cn('text-red-500', 'px-2', 'text-red-500')).toBe('px-2 text-red-500');
    });

    it('should handle deduplication with objects', () => {
      expect(cn('px-2', { 'px-2': true })).toBe('px-2');
    });
  });

  describe('complex real-world scenarios', () => {
    it('should handle button variant classes', () => {
      const baseClasses = 'px-4 py-2 rounded font-medium';
      const variantClasses = { 'bg-blue-500 text-white': true, 'bg-gray-200 text-gray-800': false };
      const stateClasses = { 'opacity-50': false, 'hover:bg-blue-600': true };
      
      expect(cn(baseClasses, variantClasses, stateClasses)).toBe('px-4 py-2 rounded font-medium bg-blue-500 text-white hover:bg-blue-600');
    });

    it('should handle form input states', () => {
      const baseClasses = 'border rounded px-3 py-2';
      const errorState = true;
      const focusState = false;
      
      expect(cn(
        baseClasses,
        {
          'border-red-500 text-red-900': errorState,
          'border-blue-500 ring-blue-500': focusState,
          'border-gray-300': !errorState && !focusState,
        }
      )).toBe('border rounded px-3 py-2 border-red-500 text-red-900');
    });

    it('should handle grid layout classes with breakpoints', () => {
      expect(cn(
        'grid',
        'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        'gap-4 md:gap-6',
        { 'xl:grid-cols-4': true }
      )).toBe('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 xl:grid-cols-4');
    });

    it('should handle component composition with overrides', () => {
      const defaultClasses = 'flex items-center justify-center p-4 bg-gray-100';
      const overrideClasses = 'bg-red-500 p-6';
      
      expect(cn(defaultClasses, overrideClasses)).toBe('flex items-center justify-center bg-red-500 p-6');
    });
  });

  describe('type safety and error handling', () => {
    it('should handle number inputs gracefully', () => {
      expect(cn('px-2', 0, 'py-1')).toBe('px-2 py-1');
      expect(cn('px-2', 1, 'py-1')).toBe('px-2 1 py-1');
    });

    it('should handle boolean inputs', () => {
      expect(cn('px-2', true, 'py-1')).toBe('px-2 py-1');
      expect(cn('px-2', false, 'py-1')).toBe('px-2 py-1');
    });

    it('should handle nested arrays', () => {
      expect(cn(['px-2', ['py-1', 'text-red-500']])).toBe('px-2 py-1 text-red-500');
    });

    it('should handle deeply nested structures', () => {
      expect(cn([
        'base',
        {
          'condition-1': true,
          'condition-2': false
        },
        [
          'nested-1',
          { 'nested-condition': true }
        ]
      ])).toBe('base condition-1 nested-1 nested-condition');
    });
  });

  describe('performance and consistency', () => {
    it('should produce consistent results with same inputs', () => {
      const input = ['px-2 py-1', { 'text-red-500': true }, 'bg-blue-500'];
      const result1 = cn(...input);
      const result2 = cn(...input);
      
      expect(result1).toBe(result2);
      expect(result1).toBe('px-2 py-1 text-red-500 bg-blue-500');
    });

    it('should handle large number of classes efficiently', () => {
      const manyClasses = Array.from({ length: 100 }, (_, i) => `class-${i}`);
      const result = cn(...manyClasses);
      
      expect(result).toContain('class-0');
      expect(result).toContain('class-99');
      expect(result.split(' ')).toHaveLength(100);
    });

    it('should handle empty arrays without issues', () => {
      expect(cn([])).toBe('');
      expect(cn([], [])).toBe('');
      expect(cn([], 'px-2', [])).toBe('px-2');
    });
  });
});