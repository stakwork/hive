import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_ORDER,
  getLanguageById,
  getLanguagesByCategory,
  getLanguagesByIds,
  type LanguageCategory
} from '@/lib/constants/languages';

describe('Language Constants', () => {
  describe('SUPPORTED_LANGUAGES', () => {
    it('should contain all expected languages', () => {
      const expectedLanguages = [
        'golang', 'react', 'rails', 'typescript', 'python',
        'swift', 'kotlin', 'rust', 'java', 'angular', 'svelte'
      ];
      
      expectedLanguages.forEach(langId => {
        expect(SUPPORTED_LANGUAGES[langId]).toBeDefined();
        expect(SUPPORTED_LANGUAGES[langId].id).toBe(langId);
      });
    });

    it('should have required properties for each language', () => {
      Object.values(SUPPORTED_LANGUAGES).forEach(language => {
        expect(language).toHaveProperty('id');
        expect(language).toHaveProperty('name');
        expect(language).toHaveProperty('icon');
        expect(language).toHaveProperty('color');
        expect(language).toHaveProperty('category');
        
        expect(typeof language.id).toBe('string');
        expect(typeof language.name).toBe('string');
        expect(typeof language.icon).toBe('function');
        expect(typeof language.color).toBe('string');
        expect(typeof language.category).toBe('string');
      });
    });

    it('should have valid color classes', () => {
      Object.values(SUPPORTED_LANGUAGES).forEach(language => {
        expect(language.color).toMatch(/^text-\w+(-\d+)?$/);
      });
    });

    it('should have valid categories', () => {
      const validCategories: LanguageCategory[] = ['frontend', 'backend', 'mobile', 'systems'];
      
      Object.values(SUPPORTED_LANGUAGES).forEach(language => {
        expect(validCategories).toContain(language.category);
      });
    });
  });

  describe('DEFAULT_LANGUAGE_ORDER', () => {
    it('should contain all language IDs', () => {
      const allLanguageIds = Object.keys(SUPPORTED_LANGUAGES);
      
      expect(DEFAULT_LANGUAGE_ORDER).toHaveLength(allLanguageIds.length);
      
      DEFAULT_LANGUAGE_ORDER.forEach(langId => {
        expect(allLanguageIds).toContain(langId);
      });
    });

    it('should have no duplicate entries', () => {
      const uniqueIds = [...new Set(DEFAULT_LANGUAGE_ORDER)];
      expect(uniqueIds).toHaveLength(DEFAULT_LANGUAGE_ORDER.length);
    });
  });
});

describe('Helper Functions', () => {
  describe('getLanguageById', () => {
    it('should return language for valid ID', () => {
      const language = getLanguageById('react');
      
      expect(language).toBeDefined();
      expect(language?.id).toBe('react');
      expect(language?.name).toBe('React');
      expect(language?.category).toBe('frontend');
    });

    it('should return undefined for invalid ID', () => {
      const language = getLanguageById('nonexistent');
      expect(language).toBeUndefined();
    });

    it('should handle empty string', () => {
      const language = getLanguageById('');
      expect(language).toBeUndefined();
    });
  });

  describe('getLanguagesByCategory', () => {
    it('should return frontend languages', () => {
      const frontendLanguages = getLanguagesByCategory('frontend');
      
      expect(frontendLanguages.length).toBeGreaterThan(0);
      frontendLanguages.forEach(lang => {
        expect(lang.category).toBe('frontend');
      });
      
      // Should include React, TypeScript, Angular, Svelte
      const frontendIds = frontendLanguages.map(lang => lang.id);
      expect(frontendIds).toContain('react');
      expect(frontendIds).toContain('typescript');
      expect(frontendIds).toContain('angular');
      expect(frontendIds).toContain('svelte');
    });

    it('should return backend languages', () => {
      const backendLanguages = getLanguagesByCategory('backend');
      
      expect(backendLanguages.length).toBeGreaterThan(0);
      backendLanguages.forEach(lang => {
        expect(lang.category).toBe('backend');
      });
      
      // Should include Golang, Rails, Python, Java
      const backendIds = backendLanguages.map(lang => lang.id);
      expect(backendIds).toContain('golang');
      expect(backendIds).toContain('rails');
      expect(backendIds).toContain('python');
      expect(backendIds).toContain('java');
    });

    it('should return mobile languages', () => {
      const mobileLanguages = getLanguagesByCategory('mobile');
      
      expect(mobileLanguages.length).toBeGreaterThan(0);
      mobileLanguages.forEach(lang => {
        expect(lang.category).toBe('mobile');
      });
      
      // Should include Swift, Kotlin
      const mobileIds = mobileLanguages.map(lang => lang.id);
      expect(mobileIds).toContain('swift');
      expect(mobileIds).toContain('kotlin');
    });

    it('should return systems languages', () => {
      const systemsLanguages = getLanguagesByCategory('systems');
      
      expect(systemsLanguages.length).toBeGreaterThan(0);
      systemsLanguages.forEach(lang => {
        expect(lang.category).toBe('systems');
      });
      
      // Should include Rust
      const systemsIds = systemsLanguages.map(lang => lang.id);
      expect(systemsIds).toContain('rust');
    });
  });

  describe('getLanguagesByIds', () => {
    it('should return languages for valid IDs', () => {
      const languages = getLanguagesByIds(['react', 'python', 'golang']);
      
      expect(languages).toHaveLength(3);
      expect(languages[0].id).toBe('react');
      expect(languages[1].id).toBe('python');
      expect(languages[2].id).toBe('golang');
    });

    it('should filter out invalid IDs', () => {
      const languages = getLanguagesByIds(['react', 'nonexistent', 'python']);
      
      expect(languages).toHaveLength(2);
      expect(languages[0].id).toBe('react');
      expect(languages[1].id).toBe('python');
    });

    it('should handle empty array', () => {
      const languages = getLanguagesByIds([]);
      expect(languages).toHaveLength(0);
    });

    it('should maintain order of input IDs', () => {
      const languages = getLanguagesByIds(['python', 'react', 'golang']);
      
      expect(languages).toHaveLength(3);
      expect(languages[0].id).toBe('python');
      expect(languages[1].id).toBe('react');
      expect(languages[2].id).toBe('golang');
    });

    it('should handle duplicate IDs', () => {
      const languages = getLanguagesByIds(['react', 'react', 'python']);
      
      expect(languages).toHaveLength(3);
      expect(languages[0].id).toBe('react');
      expect(languages[1].id).toBe('react');
      expect(languages[2].id).toBe('python');
    });
  });
});