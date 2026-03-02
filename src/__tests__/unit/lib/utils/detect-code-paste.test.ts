import { describe, it, expect } from 'vitest';
import { detectAndWrapCode } from '@/lib/utils/detect-code-paste';

describe('detectAndWrapCode', () => {
  describe('JSON detection and wrapping', () => {
    it('should wrap valid JSON object with json fence and pretty-print', () => {
      const input = '{"key":"value","nested":{"foo":"bar"}}';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```json\n{\n  "key": "value",\n  "nested": {\n    "foo": "bar"\n  }\n}\n```');
    });

    it('should wrap valid JSON array with json fence', () => {
      const input = '[1,2,3,{"a":"b"}]';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```json\n[\n  1,\n  2,\n  3,\n  {\n    "a": "b"\n  }\n]\n```');
    });

    it('should wrap complex nested JSON', () => {
      const input = JSON.stringify({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] });
      const result = detectAndWrapCode(input);
      
      expect(result).toContain('```json');
      expect(result).toContain('"users"');
      expect(result).toContain('"Alice"');
    });
  });

  describe('Structured code detection and wrapping', () => {
    it('should wrap multi-line JavaScript function in generic fence', () => {
      const input = `function hello() {
  console.log("world");
  return true;
}`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });

    it('should wrap Python code with indentation', () => {
      const input = `def greet(name):
    print(f"Hello, {name}")
    return name`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });

    it('should wrap HTML/JSX code', () => {
      const input = `<div className="container">
  <h1>Title</h1>
  <p>Content</p>
</div>`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });

    it('should wrap code with brackets and semicolons', () => {
      const input = `const x = { a: 1 };\nconst y = (z) => z + 1;`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });
  });

  describe('Plain text - no wrapping', () => {
    it('should not wrap single-line plain text', () => {
      const input = 'This is just a regular sentence.';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });

    it('should not wrap multi-line prose without structural characters', () => {
      const input = `This is a paragraph.
It has multiple lines.
But no code structure.`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });

    it('should not wrap single-line text with a single bracket', () => {
      const input = 'Check this out (important)';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });
  });

  describe('Edge cases', () => {
    it('should return empty string unchanged', () => {
      const result = detectAndWrapCode('');
      expect(result).toBe('');
    });

    it('should return whitespace-only string unchanged', () => {
      const input = '   \n  \n  ';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });

    it('should return single newline unchanged', () => {
      const result = detectAndWrapCode('\n');
      expect(result).toBe('\n');
    });

    it('should handle invalid JSON that looks like JSON', () => {
      const input = `{
  "key": "value",
  "unclosed": "string
}`;
      const result = detectAndWrapCode(input);
      
      // Should fall back to generic code fence since it's multi-line with braces
      expect(result).toBe('```\n' + input + '\n```');
    });

    it('should not wrap single-line JSON-like string without braces', () => {
      const input = 'key: value, foo: bar';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });

    it('should preserve original formatting when wrapping', () => {
      const input = `  function test() {
    return 42;
  }`;
      const result = detectAndWrapCode(input);
      
      // Should preserve leading whitespace
      expect(result).toBe('```\n' + input + '\n```');
    });
  });

  describe('Boundary cases', () => {
    it('should wrap array starting with whitespace', () => {
      const input = '  [1, 2, 3]';
      const result = detectAndWrapCode(input);
      
      // Trimmed version should be valid JSON
      expect(result).toContain('```json');
    });

    it('should not wrap prose with parentheses', () => {
      const input = 'I love TypeScript (and JavaScript too)';
      const result = detectAndWrapCode(input);
      
      expect(result).toBe(input);
    });

    it('should wrap SQL query', () => {
      const input = `SELECT *
FROM users
WHERE age > 18;`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });

    it('should wrap CSS', () => {
      const input = `.container {
  display: flex;
  padding: 20px;
}`;
      const result = detectAndWrapCode(input);
      
      expect(result).toBe('```\n' + input + '\n```');
    });
  });
});
