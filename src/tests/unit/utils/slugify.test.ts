import { describe, test, expect } from "vitest";
import { slugify } from "@/utils/slugify";

describe("slugify", () => {
  describe("basic functionality", () => {
    test("converts simple string to lowercase slug", () => {
      expect(slugify("Hello World")).toBe("hello-world");
      expect(slugify("Test String")).toBe("test-string");
      expect(slugify("Simple Case")).toBe("simple-case");
    });

    test("handles single words", () => {
      expect(slugify("Hello")).toBe("hello");
      expect(slugify("UPPERCASE")).toBe("uppercase");
      expect(slugify("MixedCase")).toBe("mixedcase");
    });

    test("preserves numbers", () => {
      expect(slugify("Test123")).toBe("test123");
      expect(slugify("Version 2.1.3")).toBe("version-2-1-3");
      expect(slugify("123 Test 456")).toBe("123-test-456");
    });
  });

  describe("special character handling", () => {
    test("replaces spaces with hyphens", () => {
      expect(slugify("hello world")).toBe("hello-world");
      expect(slugify("multiple   spaces")).toBe("multiple-spaces");
      expect(slugify("tab\tcharacter")).toBe("tab-character");
    });

    test("replaces punctuation with hyphens", () => {
      expect(slugify("Hello, World!")).toBe("hello-world");
      expect(slugify("Test.file.name")).toBe("test-file-name");
      expect(slugify("Question?")).toBe("question");
    });

    test("handles special symbols", () => {
      expect(slugify("user@domain.com")).toBe("user-domain-com");
      expect(slugify("C++ & JavaScript")).toBe("c-javascript");
      expect(slugify("$100 Price")).toBe("100-price");
      expect(slugify("50% Discount")).toBe("50-discount");
    });

    test("handles brackets and parentheses", () => {
      expect(slugify("My Project (v1.0)")).toBe("my-project-v1-0");
      expect(slugify("Array[index]")).toBe("array-index");
      expect(slugify("{object: value}")).toBe("object-value");
    });

    test("handles underscores and hyphens", () => {
      expect(slugify("snake_case_name")).toBe("snake-case-name");
      expect(slugify("kebab-case-name")).toBe("kebab-case-name");
      expect(slugify("mixed_case-example")).toBe("mixed-case-example");
    });
  });

  describe("edge cases", () => {
    test("handles empty string", () => {
      expect(slugify("")).toBe("");
    });

    test("handles whitespace-only string", () => {
      expect(slugify("   ")).toBe("");
      expect(slugify("\t\n\r")).toBe("");
      expect(slugify("  \t  \n  ")).toBe("");
    });

    test("handles special characters only", () => {
      expect(slugify("!@#$%^&*()")).toBe("");
      expect(slugify(".,;:")).toBe("");
      expect(slugify("[]{}()")).toBe("");
    });

    test("handles single characters", () => {
      expect(slugify("a")).toBe("a");
      expect(slugify("Z")).toBe("z");
      expect(slugify("5")).toBe("5");
      expect(slugify("!")).toBe("");
    });

    test("handles very long strings", () => {
      const longInput = "This is a very long string with many words and special characters !@#$%^&*() that should be properly slugified";
      const expected = "this-is-a-very-long-string-with-many-words-and-special-characters-that-should-be-properly-slugified";
      expect(slugify(longInput)).toBe(expected);
    });
  });

  describe("leading and trailing character handling", () => {
    test("removes leading hyphens", () => {
      expect(slugify("-hello-world")).toBe("hello-world");
      expect(slugify("--multiple-leading")).toBe("multiple-leading");
      expect(slugify("---many-leading-dashes")).toBe("many-leading-dashes");
    });

    test("removes trailing hyphens", () => {
      expect(slugify("hello-world-")).toBe("hello-world");
      expect(slugify("multiple-trailing--")).toBe("multiple-trailing");
      expect(slugify("many-trailing-dashes---")).toBe("many-trailing-dashes");
    });

    test("removes both leading and trailing hyphens", () => {
      expect(slugify("-hello-world-")).toBe("hello-world");
      expect(slugify("--surrounded-text--")).toBe("surrounded-text");
      expect(slugify("---completely-surrounded---")).toBe("completely-surrounded");
    });

    test("handles strings that become only hyphens", () => {
      expect(slugify("!@#$")).toBe("");
      expect(slugify("---")).toBe("");
      expect(slugify("@@@")).toBe("");
    });
  });

  describe("consecutive hyphen collapsing", () => {
    test("collapses double hyphens", () => {
      expect(slugify("hello--world")).toBe("hello-world");
      expect(slugify("test--string")).toBe("test-string");
    });

    test("collapses multiple consecutive hyphens", () => {
      expect(slugify("hello----world")).toBe("hello-world");
      expect(slugify("many------hyphens")).toBe("many-hyphens");
    });

    test("handles multiple groups of consecutive hyphens", () => {
      expect(slugify("hello--world--test")).toBe("hello-world-test");
      expect(slugify("first---second----third")).toBe("first-second-third");
    });

    test("collapses hyphens created by special character replacement", () => {
      expect(slugify("hello@@world")).toBe("hello-world");
      expect(slugify("test###string")).toBe("test-string");
      expect(slugify("multiple!!!exclamations")).toBe("multiple-exclamations");
    });
  });

  describe("unicode and international characters", () => {
    test("handles accented characters", () => {
      expect(slugify("Café")).toBe("caf");
      expect(slugify("résumé")).toBe("r-sum");
      expect(slugify("naïve")).toBe("na-ve");
    });

    test("handles German umlauts", () => {
      expect(slugify("Müller")).toBe("m-ller");
      expect(slugify("Größe")).toBe("gr-e");
    });

    test("handles Spanish characters", () => {
      expect(slugify("Niño")).toBe("ni-o");
      expect(slugify("señor")).toBe("se-or");
    });

    test("handles mixed international characters", () => {
      expect(slugify("Café & Résumé")).toBe("caf-r-sum");
      expect(slugify("José González")).toBe("jos-gonz-lez");
    });
  });

  describe("real-world scenarios", () => {
    test("handles typical project names", () => {
      expect(slugify("My Awesome Project")).toBe("my-awesome-project");
      expect(slugify("React.js App")).toBe("react-js-app");
      expect(slugify("Vue 3.0 Dashboard")).toBe("vue-3-0-dashboard");
    });

    test("handles user workspace names", () => {
      expect(slugify("John Doe's Workspace")).toBe("john-doe-s-workspace");
      expect(slugify("Team Alpha (2024)")).toBe("team-alpha-2024");
      expect(slugify("Development Environment")).toBe("development-environment");
    });

    test("handles email-based slugs", () => {
      expect(slugify("user@example.com workspace")).toBe("user-example-com-workspace");
      expect(slugify("admin@company.org")).toBe("admin-company-org");
    });

    test("handles version numbers", () => {
      expect(slugify("Version 1.2.3-beta")).toBe("version-1-2-3-beta");
      expect(slugify("Release v2.0.0")).toBe("release-v2-0-0");
      expect(slugify("Build 2024.01.15")).toBe("build-2024-01-15");
    });

    test("handles file names and paths", () => {
      expect(slugify("my-document.pdf")).toBe("my-document-pdf");
      expect(slugify("README.md")).toBe("readme-md");
      expect(slugify("config/app.json")).toBe("config-app-json");
    });

    test("handles company and organization names", () => {
      expect(slugify("Acme Corp. LLC")).toBe("acme-corp-llc");
      expect(slugify("Tech Solutions Inc.")).toBe("tech-solutions-inc");
      expect(slugify("Open Source Foundation")).toBe("open-source-foundation");
    });

    test("handles blog post titles", () => {
      expect(slugify("How to Learn JavaScript in 2024")).toBe("how-to-learn-javascript-in-2024");
      expect(slugify("The Ultimate Guide to React Hooks")).toBe("the-ultimate-guide-to-react-hooks");
      expect(slugify("Why TypeScript? Benefits & Drawbacks")).toBe("why-typescript-benefits-drawbacks");
    });
  });

  describe("whitespace variations", () => {
    test("handles multiple spaces", () => {
      expect(slugify("hello     world")).toBe("hello-world");
      expect(slugify("multiple    spaces   here")).toBe("multiple-spaces-here");
    });

    test("handles tabs and newlines", () => {
      expect(slugify("hello\tworld")).toBe("hello-world");
      expect(slugify("line1\nline2")).toBe("line1-line2");
      expect(slugify("carriage\rreturn")).toBe("carriage-return");
    });

    test("handles mixed whitespace", () => {
      expect(slugify("mixed \t\n\r whitespace")).toBe("mixed-whitespace");
      expect(slugify("  \t leading and trailing \n\r  ")).toBe("leading-and-trailing");
    });

    test("handles leading and trailing whitespace", () => {
      expect(slugify("  hello world  ")).toBe("hello-world");
      expect(slugify("\t\nhello world\r\n")).toBe("hello-world");
    });
  });
});