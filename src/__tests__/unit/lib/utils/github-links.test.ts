import { describe, it, expect } from "vitest";
import {
  parseOwnerRepo,
  parseStackFrameLines,
  buildBlobUrl,
  resolveRef,
} from "@/lib/utils/github-links";

// ── parseOwnerRepo ────────────────────────────────────────────────────────────

describe("parseOwnerRepo", () => {
  it("parses HTTPS URL", () => {
    expect(parseOwnerRepo("https://github.com/stakwork/hive")).toEqual({
      owner: "stakwork",
      repo: "hive",
    });
  });

  it("parses HTTPS URL with trailing slash", () => {
    expect(parseOwnerRepo("https://github.com/stakwork/hive/")).toEqual({
      owner: "stakwork",
      repo: "hive",
    });
  });

  it("parses HTTPS URL with trailing .git", () => {
    expect(parseOwnerRepo("https://github.com/stakwork/hive.git")).toEqual({
      owner: "stakwork",
      repo: "hive",
    });
  });

  it("parses SSH URL", () => {
    expect(parseOwnerRepo("git@github.com:stakwork/hive")).toEqual({
      owner: "stakwork",
      repo: "hive",
    });
  });

  it("parses SSH URL with trailing .git", () => {
    expect(parseOwnerRepo("git@github.com:stakwork/hive.git")).toEqual({
      owner: "stakwork",
      repo: "hive",
    });
  });

  it("parses SSH URL on a custom host", () => {
    expect(parseOwnerRepo("git@gitlab.com:myorg/myrepo.git")).toEqual({
      owner: "myorg",
      repo: "myrepo",
    });
  });

  it("throws on unrecognised URL format", () => {
    expect(() => parseOwnerRepo("not-a-url")).toThrow("Cannot parse owner/repo from: not-a-url");
  });

  it("throws on bare domain with no path", () => {
    expect(() => parseOwnerRepo("https://github.com")).toThrow();
  });
});

// ── parseStackFrameLines ──────────────────────────────────────────────────────

describe("parseStackFrameLines", () => {
  it("returns empty array for empty string", () => {
    expect(parseStackFrameLines("")).toEqual([]);
  });

  describe("V8 format (at Fn (path:line:col))", () => {
    it("parses a basic V8 frame", () => {
      const raw = "    at ProductList (src/components/ProductList.tsx:42:18)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.functionName).toBe("ProductList");
      expect(frame.path).toBe("src/components/ProductList.tsx");
      expect(frame.line).toBe(42);
      expect(frame.resolvable).toBe(true);
    });

    it("preserves line number exactly", () => {
      const raw = "    at handler (src/app/api/route.ts:123:5)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.line).toBe(123);
    });

    it("marks node_modules frame as non-resolvable", () => {
      const raw = "    at Module._resolveFilename (node_modules/webpack/lib/Module.js:30:10)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.resolvable).toBe(false);
    });

    it("marks <anonymous> frame as non-resolvable", () => {
      const raw = "    at eval (<anonymous>:1:1)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.resolvable).toBe(false);
    });

    it("strips /app/ prefix from Docker/Next.js frames", () => {
      const raw = "    at render (/app/components/ProductList.tsx:42:18)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.path).toBe("components/ProductList.tsx");
      expect(frame.resolvable).toBe(true);
    });

    it("strips webpack-internal prefix", () => {
      const raw = "    at processModule (webpack-internal:///./src/utils/helper.ts:10:5)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.resolvable).toBe(false); // webpack-internal is unresolvable
    });

    it("strips leading ./ from paths", () => {
      const raw = "    at doWork (./src/lib/worker.ts:7:3)";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.path).toBe("src/lib/worker.ts");
      expect(frame.resolvable).toBe(true);
    });

    it("parses V8 frame without function name", () => {
      const raw = "    at src/index.ts:5:1";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.functionName).toBeNull();
      expect(frame.path).toBe("src/index.ts");
      expect(frame.line).toBe(5);
      expect(frame.resolvable).toBe(true);
    });
  });

  describe("Firefox/Safari format (Fn@path:line:col)", () => {
    it("parses a Firefox frame", () => {
      const raw = "renderComponent@src/components/App.tsx:88:12";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.functionName).toBe("renderComponent");
      expect(frame.path).toBe("src/components/App.tsx");
      expect(frame.line).toBe(88);
      expect(frame.resolvable).toBe(true);
    });

    it("marks Firefox node_modules frame as non-resolvable", () => {
      const raw = "callFn@node_modules/react-dom/cjs/react-dom.development.js:20:3";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.resolvable).toBe(false);
    });

    it("strips /app/ prefix in Firefox format", () => {
      const raw = "handler@/app/src/pages/index.tsx:30:5";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.path).toBe("src/pages/index.tsx");
      expect(frame.resolvable).toBe(true);
    });
  });

  describe("unrecognised lines", () => {
    it("handles error header line gracefully", () => {
      const raw = "TypeError: Cannot read property 'foo' of undefined";
      const [frame] = parseStackFrameLines(raw);
      expect(frame.raw).toBe(raw);
      expect(frame.resolvable).toBe(false);
      expect(frame.path).toBeNull();
      expect(frame.line).toBeNull();
    });

    it("handles blank lines", () => {
      const frames = parseStackFrameLines("  \n  at foo (src/bar.ts:1:1)\n  ");
      // blank lines become unresolvable frames; the real frame is in the middle
      const resolvable = frames.filter((f) => f.resolvable);
      expect(resolvable).toHaveLength(1);
      expect(resolvable[0].functionName).toBe("foo");
    });
  });

  describe("full trace parsing", () => {
    it("parses a mixed trace with app + node_modules frames", () => {
      const trace = [
        "TypeError: Cannot read properties of undefined (reading 'map')",
        "    at ProductList (src/components/ProductList.tsx:42:18)",
        "    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)",
        "    at mountIndeterminateComponent (/app/src/pages/_app.tsx:100:5)",
      ].join("\n");

      const frames = parseStackFrameLines(trace);
      expect(frames).toHaveLength(4);

      const [header, app, vendor, page] = frames;
      expect(header.resolvable).toBe(false);
      expect(app.resolvable).toBe(true);
      expect(app.path).toBe("src/components/ProductList.tsx");
      expect(vendor.resolvable).toBe(false);
      expect(page.resolvable).toBe(true);
      expect(page.path).toBe("src/pages/_app.tsx");
    });
  });
});

// ── buildBlobUrl ──────────────────────────────────────────────────────────────

describe("buildBlobUrl", () => {
  it("builds a correct blob URL from HTTPS repo", () => {
    const url = buildBlobUrl({
      repositoryUrl: "https://github.com/stakwork/hive",
      ref: "abc1234",
      path: "src/components/ProductList.tsx",
      line: 42,
    });
    expect(url).toBe(
      "https://github.com/stakwork/hive/blob/abc1234/src/components/ProductList.tsx#L42"
    );
  });

  it("builds a correct blob URL from SSH repo", () => {
    const url = buildBlobUrl({
      repositoryUrl: "git@github.com:stakwork/hive.git",
      ref: "main",
      path: "src/lib/utils/helper.ts",
      line: 7,
    });
    expect(url).toBe(
      "https://github.com/stakwork/hive/blob/main/src/lib/utils/helper.ts#L7"
    );
  });

  it("includes the #L{line} fragment", () => {
    const url = buildBlobUrl({
      repositoryUrl: "https://github.com/owner/repo",
      ref: "deadbeef",
      path: "index.ts",
      line: 1,
    });
    expect(url).toMatch(/#L1$/);
  });
});

// ── resolveRef ────────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  it("uses commitSha when present", () => {
    expect(
      resolveRef({
        commitSha: "aabbccdd1122334455667788990011aabbccdd11",
        release: "v1.0.0",
        defaultBranch: "master",
      })
    ).toBe("aabbccdd1122334455667788990011aabbccdd11");
  });

  it("uses release when it looks like a SHA (7-40 hex chars)", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "a1b2c3d",
        defaultBranch: "master",
      })
    ).toBe("a1b2c3d");
  });

  it("uses release SHA of 40 chars", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "aabbccdd1122334455667788990011aabbccdd11",
        defaultBranch: "develop",
      })
    ).toBe("aabbccdd1122334455667788990011aabbccdd11");
  });

  it("falls back to defaultBranch when release is not SHA-like", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "v1.0.0",
        defaultBranch: "master",
      })
    ).toBe("master");
  });

  it("falls back to defaultBranch when release is null", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: null,
        defaultBranch: "develop",
      })
    ).toBe("develop");
  });

  it("falls back to 'main' when everything is null", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: null,
        defaultBranch: null,
      })
    ).toBe("main");
  });

  it("rejects release that is too short (< 7 chars)", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "abc12", // only 5 chars
        defaultBranch: "main",
      })
    ).toBe("main");
  });

  it("rejects release that exceeds 40 chars", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "a".repeat(41),
        defaultBranch: "main",
      })
    ).toBe("main");
  });

  it("rejects release with non-hex characters", () => {
    expect(
      resolveRef({
        commitSha: null,
        release: "g1h2i3j4k5l6m7n",
        defaultBranch: "main",
      })
    ).toBe("main");
  });
});

// ── Ruby/Rails dialect ────────────────────────────────────────────────────────

describe("parseStackFrameLines — Ruby/Rails dialect", () => {
  it("parses a Rails app frame (app/controllers) as resolvable", () => {
    const raw = "/rails/app/controllers/sessions_controller.rb:56:in `edit'";
    const [frame] = parseStackFrameLines(raw);
    expect(frame.path).toBe("app/controllers/sessions_controller.rb");
    expect(frame.line).toBe(56);
    expect(frame.functionName).toBe("edit");
    expect(frame.resolvable).toBe(true);
  });

  it("parses a Rails app frame under app/models as resolvable", () => {
    const raw = "/usr/src/app/app/models/user.rb:12:in `validate'";
    const [frame] = parseStackFrameLines(raw);
    expect(frame.path).toBe("app/models/user.rb");
    expect(frame.line).toBe(12);
    expect(frame.resolvable).toBe(true);
  });

  it("parses a gem frame as non-resolvable", () => {
    const raw = "/usr/local/bundle/ruby/3.2.0/gems/activerecord-7.0.4/lib/active_record/persistence.rb:120:in `save'";
    const [frame] = parseStackFrameLines(raw);
    expect(frame.line).toBe(120);
    expect(frame.functionName).toBe("save");
    expect(frame.resolvable).toBe(false);
  });

  it("parses a bundled gems frame as non-resolvable", () => {
    const raw = "/bundle/gems/rack-2.2.6/lib/rack/handler/webrick.rb:43:in `run'";
    const [frame] = parseStackFrameLines(raw);
    expect(frame.resolvable).toBe(false);
    expect(frame.path).toBe("/bundle/gems/rack-2.2.6/lib/rack/handler/webrick.rb");
  });

  it("parses a Ruby frame without in-method clause", () => {
    const raw = "/rails/app/lib/my_service.rb:8";
    const [frame] = parseStackFrameLines(raw);
    expect(frame.path).toBe("app/lib/my_service.rb");
    expect(frame.line).toBe(8);
    expect(frame.functionName).toBeNull();
    expect(frame.resolvable).toBe(true);
  });

  it("parses a full mixed Ruby trace correctly", () => {
    const trace = [
      "NoMethodError: undefined method `foo' for nil",
      "/rails/app/controllers/posts_controller.rb:22:in `show'",
      "/usr/local/bundle/ruby/3.2.0/gems/actionpack-7.0.4/lib/action_dispatch/routing/route_set.rb:50:in `call'",
      "/rails/app/models/post.rb:10:in `build'",
    ].join("\n");

    const frames = parseStackFrameLines(trace);
    expect(frames).toHaveLength(4);

    const [header, controller, gem, model] = frames;
    expect(header.resolvable).toBe(false);
    expect(controller.resolvable).toBe(true);
    expect(controller.path).toBe("app/controllers/posts_controller.rb");
    expect(gem.resolvable).toBe(false);
    expect(model.resolvable).toBe(true);
    expect(model.path).toBe("app/models/post.rb");
  });

  it("does not affect existing JS V8 frames (Ruby dialect only triggers on .rb)", () => {
    const raw = "    at ProductList (src/components/ProductList.tsx:42:18)";
    const [frame] = parseStackFrameLines(raw);
    // Should still be parsed by V8 dialect
    expect(frame.functionName).toBe("ProductList");
    expect(frame.path).toBe("src/components/ProductList.tsx");
    expect(frame.resolvable).toBe(true);
  });
});
