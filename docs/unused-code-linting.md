# Unused Code Linting

This document explains the tools and processes for detecting and removing unused code from the Hive Platform codebase.

## Overview

The project uses multiple complementary tools to detect different types of unused code:

1. **ESLint with unused-imports plugin** - Detects unused imports and variables
2. **TypeScript compiler** - Flags unused local variables and parameters
3. **ts-prune** - Finds unused exports across the entire codebase
4. **depcheck** - Identifies unused npm dependencies

## Running Unused Code Checks

### All Checks at Once

```bash
npm run lint:unused
```

This runs all three linting checks in sequence:
- Unused imports check (with auto-fix)
- Unused exports check
- Unused dependencies check

### Individual Checks

**Unused Imports and Variables:**
```bash
npm run lint:unused-imports
```

This uses ESLint with the `unused-imports` plugin to:
- Detect and remove unused import statements
- Flag unused variables (with `_` prefix ignore pattern)
- Auto-fix issues when possible

**Unused Exports:**
```bash
npm run lint:unused-exports
```

This uses `ts-prune` to scan the entire codebase and identify:
- Exported functions that are never imported
- Exported components that are never used
- Exported types/interfaces with no references
- Exported classes that are never instantiated

**Unused Dependencies:**
```bash
npm run lint:unused-deps
```

This uses `depcheck` to find:
- npm packages listed in package.json but never imported
- Dev dependencies that aren't used in the build process

## Configuration

### ESLint Configuration

Located in `.eslintrc.json`:

```json
{
  "plugins": ["unused-imports"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "unused-imports/no-unused-imports": "warn",
    "unused-imports/no-unused-vars": "warn"
  }
}
```

**Ignore Pattern:** Variables prefixed with `_` are ignored (useful for function parameters you don't use but must include for type signature reasons).

### TypeScript Configuration

Located in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

These options make the TypeScript compiler flag unused local variables and parameters during build/type-check.

### ts-prune Configuration

Located in `.ts-prunerc`:

Excludes from unused export checks:
- Test files (`*.test.ts`, `*.spec.ts`)
- Next.js special files (`layout.tsx`, `page.tsx`, `route.ts`, etc.)
- Configuration files
- Middleware

## Interpreting Results

### ESLint Output

```
src/components/example/helper.ts
  3:10  warning  'unusedFunction' is defined but never used  @typescript-eslint/no-unused-vars
```

**Action:** Remove the unused function or export it if it's meant to be used elsewhere.

### ts-prune Output

```
src/lib/utils/format.ts:45 - formatCurrency
src/components/deprecated/OldButton.tsx:12 - OldButton (default)
```

**Action:** 
- If the export is truly unused, remove it
- If it's a public API or library function, add it to `.ts-prunerc` ignore list
- If it's meant to be used, verify imports and references

### depcheck Output

```
Unused dependencies
* lodash
* moment

Unused devDependencies
* @types/node-fetch
```

**Action:**
- Remove the dependency from package.json: `npm uninstall lodash moment`
- Verify the dependency isn't used indirectly before removing

## Best Practices

### 1. Run Checks Regularly

Add to your development workflow:
```bash
# Before committing
npm run lint:unused

# Part of CI/CD
npm run lint && npm run lint:unused
```

### 2. Fix Issues Incrementally

- Start with unused imports (easiest, auto-fixable)
- Move to unused variables and parameters
- Address unused exports last (requires more investigation)

### 3. Use Ignore Patterns Wisely

**Valid reasons to ignore:**
- Function parameters required by type signatures but not used in implementation
- Exported functions meant for external consumption
- Public API surfaces

**Invalid reasons:**
- "Might need it later" - Remove and re-add when actually needed
- Dead code from refactoring - Should be removed

### 4. Component-Specific Guidelines

**React Components:**
- Unused components in `src/components/ui/` might be shadcn/ui components not yet used - check before removing
- Components in feature directories should all be imported and used
- Component props marked unused should use `_` prefix: `({ value, _unusedProp })`

**Hooks:**
- Unused custom hooks in `src/hooks/` should be removed unless they're part of a hook library
- Hook return values not used should be addressed at the call site

**API Routes:**
- API route handlers are never directly imported but are used via HTTP requests - always excluded from checks
- Utility functions in API route files should be used within that file or moved to `src/lib/`

**Types:**
- Unused types in `src/types/` should be removed
- Shared types should be used in at least one file
- Generated Prisma types are auto-excluded

## Integration with CI/CD

To enforce unused code checks in CI:

1. Add to GitHub Actions workflow:
```yaml
- name: Check for unused code
  run: npm run lint:unused
```

2. Consider making it a non-blocking warning initially:
```yaml
- name: Check for unused code
  run: npm run lint:unused || true
```

3. After cleanup, make it blocking to prevent new unused code.

## Troubleshooting

### False Positives

**Problem:** ts-prune reports a used export as unused.

**Solutions:**
- Check if it's dynamically imported: `const Module = await import('./module')`
- Verify it's not used in tests (tests might not be in the import graph)
- Add to `.ts-prunerc` ignore list if it's intentionally unused (public API)

### Performance Issues

**Problem:** Linting is slow on large codebase.

**Solutions:**
- Run `lint:unused-exports` less frequently (weekly instead of every commit)
- Use ESLint cache: `npm run lint:unused-imports -- --cache`
- Exclude large directories from ts-prune in `.ts-prunerc`

### Conflicting Rules

**Problem:** TypeScript and ESLint report different unused variable warnings.

**Solution:** The rules are aligned in `.eslintrc.json` with matching ignore patterns. If conflicts arise, update both `tsconfig.json` and `.eslintrc.json` to use the same patterns.

## Additional Resources

- [eslint-plugin-unused-imports](https://github.com/sweepline/eslint-plugin-unused-imports)
- [ts-prune documentation](https://github.com/nadeesha/ts-prune)
- [depcheck documentation](https://github.com/depcheck/depcheck)
- [TypeScript compiler options](https://www.typescriptlang.org/tsconfig#noUnusedLocals)

## Maintenance

This linting setup should be reviewed quarterly:
- Update plugin versions
- Adjust ignore patterns based on new framework conventions
- Review and clean up `.ts-prunerc` exclusions
- Verify depcheck ignores are still necessary