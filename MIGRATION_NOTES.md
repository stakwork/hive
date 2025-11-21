# Dependency Migration Notes - Next.js 16 + next-auth v5

## Updates Applied

### Package Versions
- ✅ next: ^15.4.1 → ^16.0.3
- ✅ next-auth: ^4.24.11 → ^5.0.0-beta.30 (MAJOR BREAKING CHANGES)
- ✅ react: ^19.0.0 → ^19.2.0
- ✅ react-dom: ^19.0.0 → ^19.2.0
- ✅ @sentry/nextjs: ^9.34.0 → ^10.26.0
- ✅ @auth/prisma-adapter: ^2.10.0 → ^3.1.0

## Critical: next-auth v5 Migration Required

next-auth v5 is a **complete API rewrite** with breaking changes. The following files require updates:

### 1. Auth Configuration Migration

**REQUIRED**: Create a new auth configuration file using next-auth v5 patterns.

The current codebase uses `authOptions` configuration object (v4 pattern). In v5, this needs to be migrated to the new auth.ts pattern.

**Action needed**: 
1. Locate your current `authOptions` configuration (likely in `src/lib/auth/nextauth.ts`)
2. Create a new auth configuration following the v5 beta pattern
3. Update all imports to use the new auth function

Reference: https://authjs.dev/getting-started/migrating-to-v5

### 2. API Routes - Replace getServerSession()

**Files affected**:
- `src/app/api/github/repository/route.ts`
- `src/app/api/github/app/install/route.ts`
- `src/app/api/github/app/check/route.ts`
- `src/app/api/github/app/status/route.ts`
- All other API routes using `getServerSession(authOptions)`

**Current v4 pattern**:
```typescript
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

const session = await getServerSession(authOptions);
```

**Required v5 pattern**:
```typescript
import { auth } from "@/lib/auth"; // Your new auth config

const session = await auth();
```

### 3. Layouts - Replace getServerSession()

**Files affected**:
- `src/app/w/[slug]/layout.tsx`

Same migration as API routes above.

### 4. SessionProvider Import Update

**File affected**:
- `src/app/layout.tsx` (imports from `@/providers/SessionProvider`)
- Check `src/providers/SessionProvider.tsx` implementation

**Required change**:
```typescript
// v5 pattern
import { SessionProvider } from "next-auth/react";
```

Verify your custom SessionProvider wrapper (`@/providers/SessionProvider`) is compatible with v5.

### 5. Middleware Pattern

**File affected**:
- `src/middleware.ts`

Current middleware uses `getToken()` from `next-auth/jwt`. In v5:
- The auth configuration approach changes
- Middleware integration needs to reference the new auth config
- Basic pattern should still work but needs validation

**Action needed**: Test middleware after auth config migration to ensure JWT validation still works correctly.

### 6. Test Files

**Files affected**:
- All integration tests mocking `next-auth/next`
- Example: `src/__tests__/integration/api/github-app-check.test.ts`

**Current mock pattern**:
```typescript
vi.mock("next-auth/next");
```

**Required v5 pattern**: Update mocks to reference your new auth configuration file.

### 7. @auth/prisma-adapter Update

The adapter has been updated to v3.1.0 for next-auth v5 compatibility. Verify your Prisma schema matches the required tables.

## Sentry v10 Note

@sentry/nextjs upgraded to v10.26.0. Currently, no Sentry configuration exists in the codebase (no `withSentryConfig` in next.config.ts). If you want to enable Sentry:

1. Create `sentry.client.config.ts`
2. Create `sentry.server.config.ts`
3. Update `next.config.ts` to wrap config with `withSentryConfig()`
4. Set `SENTRY_DSN` environment variable

## Next Steps

1. **Install dependencies**: Run `yarn install` or `npm install`
2. **Migrate auth configuration**: Create new auth.ts file with v5 pattern
3. **Update all imports**: Replace `getServerSession(authOptions)` with `auth()` calls
4. **Update SessionProvider**: Verify import and props compatibility
5. **Update tests**: Fix session mocking patterns for v5
6. **Build verification**: Run `npm run build` to check for TypeScript errors
7. **Test suite**: Run `npm run test` to verify all tests pass
8. **Environment validation**: Ensure `NEXTAUTH_SECRET` is set correctly

## Expected Build Errors

After running `yarn install`, you will likely see TypeScript errors in:
- All API routes using `getServerSession`
- Layout files using `getServerSession`
- Middleware if auth config pattern doesn't match
- Test files mocking next-auth

These are expected and should be resolved by following the migration steps above.

## Documentation References

- next-auth v5 Migration Guide: https://authjs.dev/getting-started/migrating-to-v5
- next-auth v5 API Reference: https://authjs.dev/reference/nextjs
- Next.js 16 Release Notes: https://nextjs.org/blog/next-16
- @sentry/nextjs v10 Guide: https://docs.sentry.io/platforms/javascript/guides/nextjs/

## Rollback Plan

If migration issues are encountered:

1. Revert package.json changes
2. Run `yarn install` to restore previous versions
3. Delete this MIGRATION_NOTES.md file

```bash
git checkout package.json
yarn install
```

## Test Verification Checklist

After completing migration:

- [ ] `npm run lint` - No TypeScript/ESLint errors
- [ ] `npm run build` - Build succeeds with Next.js 16
- [ ] `npm run test:unit` - All unit tests pass
- [ ] `npm run test:integration` - All integration tests pass
- [ ] `npm run test` - Full test suite passes
- [ ] Verify authentication flow works (sign in/out)
- [ ] Verify API routes return proper 401/403 for unauthorized requests
- [ ] Verify middleware protects routes correctly
- [ ] Verify session data is accessible in components

## Known Issues

1. **next-auth v5 is beta**: Expect potential API changes in future versions
2. **@auth/prisma-adapter**: Ensure your Prisma schema matches v3 requirements
3. **NEXTAUTH_SECRET**: JWT signing may differ between v4 and v5 - test existing sessions
4. **SessionProvider props**: Verify custom session provider wrapper compatibility

## Support

If you encounter issues during migration:
1. Check the next-auth v5 migration guide
2. Review the example implementations in the next-auth repository
3. Check for open issues in the next-auth GitHub repository related to v5 beta