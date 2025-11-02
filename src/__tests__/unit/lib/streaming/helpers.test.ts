import { describe, test, expect } from "vitest";
import { cleanXMLTags } from "@/lib/streaming/helpers";

describe("cleanXMLTags", () => {
  describe("Basic Tag Removal", () => {
    test("should remove <function_calls> tags", () => {
      expect(cleanXMLTags("<function_calls>content</function_calls>")).toBe("content");
    });

    test("should remove <invoke> tags", () => {
      expect(cleanXMLTags("<invoke>content</invoke>")).toBe("content");
    });

    test("should remove <parameter> tags", () => {
      expect(cleanXMLTags("<parameter>content</parameter>")).toBe("content");
    });

    test("should remove opening and closing tags separately", () => {
      expect(cleanXMLTags("<function_calls>text</function_calls>")).toBe("text");
      expect(cleanXMLTags("<invoke>text</invoke>")).toBe("text");
      expect(cleanXMLTags("<parameter>text</parameter>")).toBe("text");
    });
  });

  describe("Tag Attributes", () => {
    test("should remove <invoke> tags with attributes", () => {
      expect(cleanXMLTags('<invoke name="tool">content</invoke>')).toBe("content");
    });

    test("should remove <parameter> tags with attributes", () => {
      expect(cleanXMLTags('<parameter name="input">value</parameter>')).toBe("value");
    });

    test("should handle multiple attributes", () => {
      expect(cleanXMLTags('<invoke name="tool" id="123">content</invoke>')).toBe("content");
    });

    test("should handle attributes with various quote styles", () => {
      expect(cleanXMLTags("<invoke name='single'>content</invoke>")).toBe("content");
      expect(cleanXMLTags('<parameter type="string">value</parameter>')).toBe("value");
    });
  });

  describe("Case Insensitivity", () => {
    test("should remove uppercase tags", () => {
      expect(cleanXMLTags("<FUNCTION_CALLS>content</FUNCTION_CALLS>")).toBe("content");
      expect(cleanXMLTags("<INVOKE>content</INVOKE>")).toBe("content");
      expect(cleanXMLTags("<PARAMETER>content</PARAMETER>")).toBe("content");
    });

    test("should remove mixed case tags", () => {
      expect(cleanXMLTags("<Function_Calls>content</Function_Calls>")).toBe("content");
      expect(cleanXMLTags("<Invoke>content</Invoke>")).toBe("content");
      expect(cleanXMLTags("<Parameter>content</Parameter>")).toBe("content");
    });

    test("should handle case-insensitive attributes", () => {
      expect(cleanXMLTags('<INVOKE NAME="TOOL">content</INVOKE>')).toBe("content");
    });
  });

  describe("Whitespace Handling", () => {
    test("should remove whitespace after opening tags", () => {
      expect(cleanXMLTags("<function_calls> content</function_calls>")).toBe("content");
      expect(cleanXMLTags("<invoke>  content</invoke>")).toBe("content");
    });

    test("should remove whitespace after closing tags", () => {
      expect(cleanXMLTags("<function_calls>content</function_calls> ")).toBe("content");
      expect(cleanXMLTags("<invoke>content</invoke>  ")).toBe("content");
    });

    test("should trim leading and trailing whitespace", () => {
      expect(cleanXMLTags("  <function_calls>content</function_calls>  ")).toBe("content");
      expect(cleanXMLTags("\n<invoke>content</invoke>\n")).toBe("content");
      expect(cleanXMLTags("\t<parameter>value</parameter>\t")).toBe("value");
    });

    test("should preserve internal whitespace in content", () => {
      expect(cleanXMLTags("<function_calls>hello world</function_calls>")).toBe("hello world");
      expect(cleanXMLTags("<invoke>multiple  spaces</invoke>")).toBe("multiple  spaces");
    });

    test("should handle newlines and tabs in content", () => {
      expect(cleanXMLTags("<function_calls>line1\nline2</function_calls>")).toBe("line1\nline2");
      expect(cleanXMLTags("<invoke>tab\there</invoke>")).toBe("tab\there");
    });
  });

  describe("Multiple Tags", () => {
    test("should remove multiple function_calls tags", () => {
      expect(cleanXMLTags("<function_calls>first</function_calls><function_calls>second</function_calls>")).toBe("firstsecond");
    });

    test("should remove multiple different tags", () => {
      expect(cleanXMLTags("<function_calls><invoke>content</invoke></function_calls>")).toBe("content");
    });

    test("should handle mixed tags in sequence", () => {
      const input = "<function_calls><invoke><parameter>value</parameter></invoke></function_calls>";
      expect(cleanXMLTags(input)).toBe("value");
    });

    test("should remove tags with content between them", () => {
      const input = "<function_calls>start</function_calls>middle<invoke>end</invoke>";
      expect(cleanXMLTags(input)).toBe("startmiddleend");
    });

    test("should handle alternating tags and content", () => {
      const input = "text1<function_calls>text2</function_calls>text3<invoke>text4</invoke>text5";
      expect(cleanXMLTags(input)).toBe("text1text2text3text4text5");
    });
  });

  describe("Nested Tags", () => {
    test("should handle nested function_calls and invoke tags", () => {
      const input = "<function_calls><invoke>nested content</invoke></function_calls>";
      expect(cleanXMLTags(input)).toBe("nested content");
    });

    test("should handle deeply nested tags", () => {
      const input = "<function_calls><invoke><parameter>deep</parameter></invoke></function_calls>";
      expect(cleanXMLTags(input)).toBe("deep");
    });

    test("should handle nested tags with attributes", () => {
      const input = '<function_calls><invoke name="tool"><parameter name="arg">value</parameter></invoke></function_calls>';
      expect(cleanXMLTags(input)).toBe("value");
    });

    test("should handle multiple levels of nesting with content", () => {
      const input = "<function_calls>outer<invoke>middle<parameter>inner</parameter></invoke>outer2</function_calls>";
      expect(cleanXMLTags(input)).toBe("outermiddleinnerouter2");
    });
  });

  describe("Empty and Edge Cases", () => {
    test("should handle empty string", () => {
      expect(cleanXMLTags("")).toBe("");
    });

    test("should handle whitespace-only string", () => {
      expect(cleanXMLTags("   ")).toBe("");
      expect(cleanXMLTags("\n\t")).toBe("");
      expect(cleanXMLTags("  \n  \t  ")).toBe("");
    });

    test("should handle tags with no content", () => {
      expect(cleanXMLTags("<function_calls></function_calls>")).toBe("");
      expect(cleanXMLTags("<invoke></invoke>")).toBe("");
      expect(cleanXMLTags("<parameter></parameter>")).toBe("");
    });

    test("should handle tags with only whitespace content", () => {
      expect(cleanXMLTags("<function_calls>   </function_calls>")).toBe("");
      expect(cleanXMLTags("<invoke>\n\t</invoke>")).toBe("");
    });

    test("should remove self-closing tags", () => {
      // Self-closing tags like <invoke/> are matched by <invoke[^>]*> regex
      expect(cleanXMLTags("text<invoke/>more")).toBe("textmore");
    });

    test("should handle incomplete opening tags (no closing >)", () => {
      // Incomplete tags without closing > are not matched by regex
      expect(cleanXMLTags("<function_calls content")).toBe("<function_calls content");
      expect(cleanXMLTags("<invoke name='test' content")).toBe("<invoke name='test' content");
    });
  });

  describe("Text Without XML Tags", () => {
    test("should return plain text unchanged", () => {
      expect(cleanXMLTags("Hello, World!")).toBe("Hello, World!");
      expect(cleanXMLTags("This is plain text")).toBe("This is plain text");
    });

    test("should preserve HTML tags (non-XML tags)", () => {
      expect(cleanXMLTags("<div>content</div>")).toBe("<div>content</div>");
      expect(cleanXMLTags("<p>paragraph</p>")).toBe("<p>paragraph</p>");
      expect(cleanXMLTags("<span class='test'>text</span>")).toBe("<span class='test'>text</span>");
    });

    test("should preserve markdown formatting", () => {
      expect(cleanXMLTags("**bold** and *italic*")).toBe("**bold** and *italic*");
      expect(cleanXMLTags("[link](url)")).toBe("[link](url)");
      expect(cleanXMLTags("# Heading")).toBe("# Heading");
    });

    test("should preserve special characters", () => {
      expect(cleanXMLTags("Test @#$% symbols")).toBe("Test @#$% symbols");
      expect(cleanXMLTags("Email: test@example.com")).toBe("Email: test@example.com");
      expect(cleanXMLTags("Math: 2 + 2 = 4")).toBe("Math: 2 + 2 = 4");
    });

    test("should preserve code-like content", () => {
      expect(cleanXMLTags("const x = 10;")).toBe("const x = 10;");
      expect(cleanXMLTags("function test() {}")).toBe("function test() {}");
    });
  });

  describe("Content Preservation", () => {
    test("should preserve text before and after tags", () => {
      expect(cleanXMLTags("before<function_calls>middle</function_calls>after")).toBe("beforemiddleafter");
    });

    test("should preserve numbers and special characters in content", () => {
      expect(cleanXMLTags("<function_calls>123 $%^</function_calls>")).toBe("123 $%^");
    });

    test("should preserve newlines in content", () => {
      expect(cleanXMLTags("<function_calls>line1\nline2</function_calls>")).toBe("line1\nline2");
    });

    test("should preserve unicode characters", () => {
      expect(cleanXMLTags("<function_calls>café résumé</function_calls>")).toBe("café résumé");
      expect(cleanXMLTags("<invoke>你好世界</invoke>")).toBe("你好世界");
      expect(cleanXMLTags("<parameter>emoji: 🎉</parameter>")).toBe("emoji: 🎉");
    });

    test("should preserve JSON-like content", () => {
      expect(cleanXMLTags('<function_calls>{"key": "value"}</function_calls>')).toBe('{"key": "value"}');
    });

    test("should preserve URLs", () => {
      expect(cleanXMLTags("<invoke>https://example.com/path?query=value</invoke>")).toBe("https://example.com/path?query=value");
    });
  });

  describe("Real-World Scenarios", () => {
    test("should clean AI response with function_calls wrapper", () => {
      const input = `<function_calls>
        <invoke name="final_answer">
          <parameter name="answer">This is the final answer</parameter>
        </invoke>
      </function_calls>`;
      const result = cleanXMLTags(input);
      expect(result).toBe("This is the final answer");
    });

    test("should handle streaming AI response fragments", () => {
      const input = "<function_calls><invoke>Analyzing your question";
      const result = cleanXMLTags(input);
      expect(result).toBe("Analyzing your question");
    });

    test("should clean final answer from learn workflow", () => {
      const input = `<function_calls>
        <invoke name="final_answer">
          Here is the explanation with details
        </invoke>
      </function_calls>`;
      const result = cleanXMLTags(input);
      expect(result).toBe("Here is the explanation with details");
    });

    test("should handle mixed content with citation tags (preserved)", () => {
      const input = '<function_calls><invoke>Check <cite index="1-1">source</cite></invoke></function_calls>';
      const result = cleanXMLTags(input);
      expect(result).toBe('Check <cite index="1-1">source</cite>');
    });

    test("should clean complex nested tool calls", () => {
      const input = `<function_calls>
        <invoke name="web_search">
          <parameter name="query">test query</parameter>
        </invoke>
        <invoke name="final_answer">
          <parameter name="answer">Based on the search results</parameter>
        </invoke>
      </function_calls>`;
      const result = cleanXMLTags(input);
      // Note: Content from all parameters is preserved
      expect(result).toBe("test queryBased on the search results");
    });

    test("should handle agent mode final_answer tool format", () => {
      const input = `<function_calls>
        <invoke name="final_answer">
          <parameter name="answer">
            The solution is to refactor the component using React hooks.
          </parameter>
        </invoke>
      </function_calls>`;
      const result = cleanXMLTags(input);
      expect(result).toBe("The solution is to refactor the component using React hooks.");
    });

    test("should preserve citation links for downstream processing", () => {
      const input = '<function_calls><invoke>According to <cite index="1-1">the documentation</cite>, this is correct.</invoke></function_calls>';
      const result = cleanXMLTags(input);
      expect(result).toContain("<cite index=");
      expect(result).toContain("the documentation");
    });
  });

  describe("Malformed XML", () => {
    test("should handle mismatched tags", () => {
      expect(cleanXMLTags("<function_calls>content</invoke>")).toBe("content");
    });

    test("should handle missing closing tags", () => {
      expect(cleanXMLTags("<function_calls>content")).toBe("content");
      expect(cleanXMLTags("<invoke>content")).toBe("content");
    });

    test("should handle missing opening tags", () => {
      expect(cleanXMLTags("content</function_calls>")).toBe("content");
      expect(cleanXMLTags("content</invoke>")).toBe("content");
    });

    test("should handle duplicate opening tags", () => {
      expect(cleanXMLTags("<function_calls><function_calls>content</function_calls>")).toBe("content");
    });

    test("should handle duplicate closing tags", () => {
      expect(cleanXMLTags("<function_calls>content</function_calls></function_calls>")).toBe("content");
    });

    test("should handle unclosed attributes", () => {
      expect(cleanXMLTags('<invoke name="test>content</invoke>')).toBe("content");
    });

    test("should handle orphaned closing tags", () => {
      expect(cleanXMLTags("text</function_calls></invoke></parameter>more")).toBe("textmore");
    });
  });

  describe("Performance and Edge Cases", () => {
    test("should handle very long strings efficiently", () => {
      const longContent = "a".repeat(10000);
      const input = `<function_calls>${longContent}</function_calls>`;
      expect(cleanXMLTags(input)).toBe(longContent);
    });

    test("should handle multiple tags in very long string", () => {
      const repeatedTags = "<function_calls>test</function_calls>".repeat(100);
      const result = cleanXMLTags(repeatedTags);
      expect(result).toBe("test".repeat(100));
    });

    test("should handle empty tags repeated many times", () => {
      const input = "<function_calls></function_calls>".repeat(50);
      expect(cleanXMLTags(input)).toBe("");
    });

    test("should handle deeply nested structure", () => {
      let input = "content";
      for (let i = 0; i < 10; i++) {
        input = `<function_calls>${input}</function_calls>`;
      }
      expect(cleanXMLTags(input)).toBe("content");
    });
  });

  describe("Integration with Streaming Context", () => {
    test("should work with extractAnswer output format", () => {
      const aiResponse = "<function_calls><invoke>The answer is 42</invoke></function_calls>";
      expect(cleanXMLTags(aiResponse)).toBe("The answer is 42");
    });

    test("should prepare text for citation conversion", () => {
      const input = '<function_calls>Check <cite index="1-1">this</cite></function_calls>';
      const cleaned = cleanXMLTags(input);
      expect(cleaned).toBe('Check <cite index="1-1">this</cite>');
      expect(cleaned).toContain("<cite");
    });

    test("should not interfere with markdown links", () => {
      const input = "<function_calls>[See this](https://example.com)</function_calls>";
      expect(cleanXMLTags(input)).toBe("[See this](https://example.com)");
    });

    test("should handle partial streaming response", () => {
      const input = "<function_calls><invoke name='final_answer'><parameter name='answer'>Based on my analysis";
      expect(cleanXMLTags(input)).toBe("Based on my analysis");
    });

    test("should clean output before convertCitationsToLinks processes it", () => {
      const input = '<function_calls><invoke>Result: <cite index="1-1">source</cite> and <cite index="2-1">another</cite></invoke></function_calls>';
      const cleaned = cleanXMLTags(input);
      expect(cleaned).not.toContain("<function_calls>");
      expect(cleaned).not.toContain("<invoke>");
      expect(cleaned).toContain("<cite");
    });
  });

  describe("Security and Sanitization", () => {
    test("should not execute or interpret script content", () => {
      const input = "<function_calls><script>alert('xss')</script></function_calls>";
      expect(cleanXMLTags(input)).toBe("<script>alert('xss')</script>");
    });

    test("should preserve but not process potentially dangerous HTML", () => {
      const input = "<invoke><img src=x onerror=alert(1)></invoke>";
      expect(cleanXMLTags(input)).toBe("<img src=x onerror=alert(1)>");
    });

    test("should handle extremely nested structures without stack overflow", () => {
      let input = "safe";
      for (let i = 0; i < 100; i++) {
        input = `<function_calls>${input}</function_calls>`;
      }
      expect(() => cleanXMLTags(input)).not.toThrow();
      expect(cleanXMLTags(input)).toBe("safe");
    });
  });
});