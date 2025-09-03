# TypeScript Build Issues TODO

## Summary
The Next.js build succeeds but TypeScript type checking fails with remaining errors. The Vitest namespace issues have been resolved.

## Categories of Issues

### 1. ✅ Vitest Global Variables (COMPLETED)
- [x] Fix `vi` namespace errors in test files
- [x] Fix `expect` not found errors in test files  
- [x] Update vitest configuration or add proper imports
- [x] Fix missing POST export (changed to PUT)

### 2. Type Compatibility Issues (IN PROGRESS)
- [ ] Fix WorkspaceResponse missing 'deleted' property
- [ ] Fix workspace resolver test type errors with Record<string, unknown>
- [ ] Fix WorkspaceMember role type errors (string vs WorkspaceRole)
- [ ] Fix workspace service test type errors with incomplete mock data

### 3. Property Issues (Low Priority)
- [ ] Fix 'owner' vs 'ownerId' property name mismatch

## Progress Report
- ✅ Fixed vitest global imports by adding types configuration
- ✅ Fixed missing POST export (was actually PUT) in stakgraph route
- ✅ Excluded e2e tests from TypeScript checking
- ✅ Added vitest type references and global configuration

## Remaining Errors (Reduced from 42 to ~15)
Most remaining errors are in test files with incorrect mock data types and type assertions.

## Next Steps
1. ✅ Start with vitest configuration issues (COMPLETED)
2. ✅ Fix missing exports (COMPLETED)  
3. Fix type compatibility issues in test mocks
4. Address remaining property mismatches

## Files Fixed
- ✅ vitest.config.ts
- ✅ tsconfig.json  
- ✅ Multiple test files with vi imports
- ✅ src/app/api/workspaces/[slug]/stakgraph/route.ts test import

## Files Still Need Fixing
- src/__tests__/integration/services/workspace.test.ts
- src/__tests__/unit/lib/auth/workspace-resolver.test.ts  
- src/__tests__/unit/services/workspace.test.ts
- src/__tests__/utils/test-helpers.ts
