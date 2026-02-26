import { describe, it, expect } from 'vitest';
import { diffWords } from 'diff';
import type { DiffToken, SectionHighlight } from '@/app/w/[slug]/plan/[featureId]/components/PlanArtifact';

describe('Section Highlights Logic', () => {
  describe('type: "new" highlight', () => {
    it('should produce "new" highlight when prevVal is null and nextVal has content', () => {
      const prevVal = null;
      const nextVal = 'This is new content';

      let highlight: SectionHighlight | null = null;

      if (!prevVal && nextVal) {
        highlight = { type: 'new' };
      }

      expect(highlight).toEqual({ type: 'new' });
    });

    it('should produce "new" highlight when prevVal is empty string and nextVal has content', () => {
      const prevVal = '';
      const nextVal = 'This is new content';

      let highlight: SectionHighlight | null = null;

      if (!prevVal && nextVal) {
        highlight = { type: 'new' };
      }

      expect(highlight).toEqual({ type: 'new' });
    });

    it('should not produce highlight when nextVal is null', () => {
      const prevVal = null;
      const nextVal = null;

      let highlight: SectionHighlight | null = null;

      if (!nextVal) {
        // Skip
      } else if (!prevVal && nextVal) {
        highlight = { type: 'new' };
      }

      expect(highlight).toBeNull();
    });
  });

  describe('type: "diff" highlight', () => {
    it('should produce "diff" highlight when both prevVal and nextVal exist and differ', () => {
      const prevVal = 'Hello world';
      const nextVal = 'Hello beautiful world';

      let highlight: SectionHighlight | null = null;

      if (!nextVal) {
        // Skip
      } else if (!prevVal && nextVal) {
        highlight = { type: 'new' };
      } else if (prevVal && nextVal && prevVal !== nextVal) {
        const parts = diffWords(prevVal, nextVal);
        const tokens: DiffToken[] = parts.flatMap((part) => {
          if (part.removed) return [];
          return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
            word,
            isNew: !!part.added,
          }));
        });
        highlight = { type: 'diff', tokens };
      }

      expect(highlight).toBeTruthy();
      expect(highlight?.type).toBe('diff');
      if (highlight?.type === 'diff') {
        expect(highlight.tokens.length).toBeGreaterThan(0);
      }
    });

    it('should not produce highlight when values are identical', () => {
      const prevVal = 'Hello world';
      const nextVal = 'Hello world';

      let highlight: SectionHighlight | null = null;

      if (!nextVal) {
        // Skip
      } else if (!prevVal && nextVal) {
        highlight = { type: 'new' };
      } else if (prevVal && nextVal && prevVal !== nextVal) {
        const parts = diffWords(prevVal, nextVal);
        const tokens: DiffToken[] = parts.flatMap((part) => {
          if (part.removed) return [];
          return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
            word,
            isNew: !!part.added,
          }));
        });
        highlight = { type: 'diff', tokens };
      }

      expect(highlight).toBeNull();
    });
  });

  describe('diffWords tokens', () => {
    it('should correctly mark added words as isNew: true', () => {
      const prevVal = 'Hello world';
      const nextVal = 'Hello beautiful world';

      const parts = diffWords(prevVal, nextVal);
      const tokens: DiffToken[] = parts.flatMap((part) => {
        if (part.removed) return [];
        return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
          word,
          isNew: !!part.added,
        }));
      });

      // Find the "beautiful" token
      const beautifulToken = tokens.find((t) => t.word === 'beautiful');
      expect(beautifulToken).toBeDefined();
      expect(beautifulToken?.isNew).toBe(true);

      // "Hello" and "world" should be marked as not new
      const helloToken = tokens.find((t) => t.word === 'Hello');
      expect(helloToken?.isNew).toBe(false);

      const worldToken = tokens.find((t) => t.word === 'world');
      expect(worldToken?.isNew).toBe(false);
    });

    it('should mark unchanged words as isNew: false', () => {
      const prevVal = 'Hello world';
      const nextVal = 'Hello beautiful world';

      const parts = diffWords(prevVal, nextVal);
      const tokens: DiffToken[] = parts.flatMap((part) => {
        if (part.removed) return [];
        return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
          word,
          isNew: !!part.added,
        }));
      });

      const unchangedTokens = tokens.filter((t) => !t.isNew && t.word.trim().length > 0);
      expect(unchangedTokens.length).toBeGreaterThan(0);
      expect(unchangedTokens.every((t) => ['Hello', 'world'].includes(t.word))).toBe(true);
    });

    it('should exclude removed words from tokens', () => {
      const prevVal = 'Hello old world';
      const nextVal = 'Hello new world';

      const parts = diffWords(prevVal, nextVal);
      const tokens: DiffToken[] = parts.flatMap((part) => {
        if (part.removed) return [];
        return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
          word,
          isNew: !!part.added,
        }));
      });

      // "old" should not appear in tokens
      const oldToken = tokens.find((t) => t.word === 'old');
      expect(oldToken).toBeUndefined();

      // "new" should appear and be marked as new
      const newToken = tokens.find((t) => t.word === 'new');
      expect(newToken).toBeDefined();
      expect(newToken?.isNew).toBe(true);
    });

    it('should handle whitespace correctly in tokens', () => {
      const prevVal = 'Hello world';
      const nextVal = 'Hello beautiful world';

      const parts = diffWords(prevVal, nextVal);
      const tokens: DiffToken[] = parts.flatMap((part) => {
        if (part.removed) return [];
        return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
          word,
          isNew: !!part.added,
        }));
      });

      // Should include whitespace tokens
      const whitespaceTokens = tokens.filter((t) => t.word.match(/^\s+$/));
      expect(whitespaceTokens.length).toBeGreaterThan(0);
    });
  });
});
