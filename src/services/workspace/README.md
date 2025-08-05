# Workspace Service

A modular workspace management service organized into specialized modules for better maintainability and architectural clarity.

## Architecture

The workspace service has been refactored from a single large file into a modular structure:

```
src/services/workspace/
├── index.ts                 # Main exports and backward compatibility
├── WorkspaceService.ts      # Orchestration service class
├── workspace-crud.ts        # CRUD operations
├── workspace-access.ts      # Access control and permissions
├── workspace-validation.ts  # Data validation logic
└── README.md               # This file
```

## Usage

### Option 1: Using the WorkspaceService class (Recommended)

```typescript
import { WorkspaceService } from "@/services/workspace";

// Create a workspace
const workspace = await WorkspaceService.createWorkspace({
  name: "My Workspace",
  slug: "my-workspace", 
  ownerId: "user-id"
});

// Validate access
const access = await WorkspaceService.validateWorkspaceAccess("my-workspace", "user-id");

// Validate data
const validation = WorkspaceService.validateWorkspaceSlug("my-workspace");
```

### Option 2: Direct function imports (Backward Compatible)

```typescript
import { 
  createWorkspace, 
  getWorkspaceBySlug, 
  validateWorkspaceSlug 
} from "@/services/workspace";

const workspace = await createWorkspace({ /* ... */ });
const workspaceData = await getWorkspaceBySlug("slug", "userId");
const isValid = validateWorkspaceSlug("slug");
```

### Option 3: Module-specific imports

```typescript
import { WorkspaceCrud, WorkspaceAccess, WorkspaceValidation } from "@/services/workspace";

// Use specific modules
const workspace = await WorkspaceCrud.createWorkspace({ /* ... */ });
const access = await WorkspaceAccess.validateWorkspaceAccess("slug", "userId");
const isValid = WorkspaceValidation.validateWorkspaceSlug("slug");
```

## Modules

### WorkspaceService (WorkspaceService.ts)
Main orchestration class that provides a unified interface to all workspace functionality. Use this for new code.

**Methods:**
- `createWorkspace(data)` - Creates a new workspace
- `getWorkspaceBySlug(slug, userId)` - Gets workspace with access check
- `getUserWorkspaces(userId)` - Gets all user workspaces with roles
- `validateWorkspaceAccess(slug, userId)` - Validates user permissions
- `validateWorkspaceSlug(slug)` - Validates slug format
- And more...

### CRUD Operations (workspace-crud.ts)
Handles database operations for workspace entities.

**Functions:**
- `createWorkspace()` - Create new workspace
- `getWorkspacesByUserId()` - Get workspaces owned by user
- `getUserWorkspaces()` - Get all accessible workspaces with roles
- `getDefaultWorkspaceForUser()` - Get user's primary workspace
- `deleteWorkspaceBySlug()` - Delete workspace (owner only)

### Access Control (workspace-access.ts)
Manages workspace permissions and access validation.

**Functions:**
- `getWorkspaceBySlug()` - Get workspace with access check
- `validateWorkspaceAccess()` - Full permission validation
- `hasWorkspacePermission()` - Check specific permission level
- `isWorkspaceOwner()` - Check ownership
- `getUserRoleInWorkspace()` - Get user's role

### Validation (workspace-validation.ts)
Handles data validation for workspace operations.

**Functions:**
- `validateWorkspaceSlug()` - Validate slug format and reservations
- `validateWorkspaceName()` - Validate workspace name
- `validateWorkspaceDescription()` - Validate description
- `validateWorkspaceData()` - Validate complete workspace data

## Migration Notes

This refactoring maintains 100% backward compatibility. All existing imports will continue to work:

```typescript
// This still works exactly as before
import { createWorkspace, getWorkspaceBySlug } from "@/services/workspace";
```

## Benefits

1. **Modularity**: Clear separation of concerns
2. **Maintainability**: Easier to understand and modify specific functionality
3. **Testability**: Individual modules can be tested in isolation
4. **Reusability**: Modules can be imported granularly
5. **Type Safety**: Better TypeScript support and intellisense
6. **Scalability**: Easy to add new functionality without bloating existing modules

## Future Enhancements

Consider adding these modules as the service grows:
- `workspace-members.ts` - Member management operations
- `workspace-settings.ts` - Workspace configuration management
- `workspace-events.ts` - Event tracking and auditing
- `workspace-integrations.ts` - Third-party service integrations