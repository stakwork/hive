# GitHub App Integration Architecture

This document outlines the new architecture for GitHub App integration, replacing the previous simple approach with a more scalable multi-org/multi-user system.

## Problem Statement

The original GitHub App integration had several limitations:

1. **Installation vs Access Confusion**: Stored `githubInstallationId` on the Swarm model (per workspace)
2. **Token Scope Issues**: User's app token stored on user account didn't capture which orgs they can access
3. **Workspace Rigidity**: Multiple workspaces couldn't easily share the same GitHub org
4. **Repository Limitations**: Each workspace was tied to one installation but might need repos from multiple orgs

## New Architecture

### Core Models

#### SourceControlOrg
Represents a GitHub organization or user account where the app is installed.

```prisma
model SourceControlOrg {
  id                   String                @id @default(cuid())
  type                 SourceControlOrgType  @default(ORG)
  githubLogin          String                @unique // e.g. "anthropic", "evanfeenstra"
  githubInstallationId Int                   @unique
  name                 String?               // Display name
  avatarUrl            String?
  description          String?
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt

  // Relationships
  tokens       SourceControlToken[]
  repositories Repository[]
}
```

#### SourceControlToken
Represents individual user access tokens to a specific SourceControlOrg.

```prisma
model SourceControlToken {
  id                  String           @id @default(cuid())
  userId              String
  sourceControlOrgId  String
  token               String           // Encrypted app access token
  refreshToken        String?          // Encrypted refresh token
  expiresAt           DateTime?
  scopes              String[]         @default([])
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  // Relationships
  user             User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceControlOrg SourceControlOrg @relation(fields: [sourceControlOrgId], references: [id], onDelete: Cascade)

  @@unique([userId, sourceControlOrgId])
}
```

### Updated Models

#### Repository
Now links to both Workspace and SourceControlOrg:

```prisma
model Repository {
  // ... existing fields ...

  // Repository belongs to workspace (unchanged)
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // NEW: Repository belongs to source control org
  sourceControlOrgId String?
  sourceControlOrg   SourceControlOrg? @relation(fields: [sourceControlOrgId], references: [id], onDelete: SetNull)
}
```

#### User
Gains relationship to SourceControlTokens:

```prisma
model User {
  // ... existing fields ...

  // NEW: Source control tokens
  sourceControlTokens SourceControlToken[]
}
```

## Installation Flow

### First User in Org (App Installation)
1. User creates workspace from `github.com/anthropic/some-repo`
2. System extracts org name (`anthropic`)
3. **Check installation**: Call `/api/github/app/check-installation?owner=anthropic`
4. If not installed → Redirect to GitHub App install flow
5. After installation → Creates `SourceControlOrg` record
6. User gets OAuth token → Creates `SourceControlToken` record
7. Repository gets linked to `SourceControlOrg`

### Subsequent Users from Same Org (OAuth Only)
1. User creates workspace from `github.com/anthropic/some-repo`
2. System extracts org name (`anthropic`)
3. **Check installation**: Call `/api/github/app/check-installation?owner=anthropic`
4. If installed → Redirect to OAuth flow (not install flow)
5. User gets OAuth token → Creates `SourceControlToken` for existing `SourceControlOrg`
6. Repository gets linked to existing `SourceControlOrg`

## API Implementation

### Installation Check Endpoint
`GET /api/github/app/check-installation?owner={orgName}`

**Logic:**
1. Extract owner from query params
2. Use user's existing app tokens to check GitHub API
3. Determine if owner is user or org via GitHub API
4. Check appropriate endpoint:
   - `GET /orgs/{org}/installation` for orgs
   - `GET /users/{user}/installation` for users
5. Return installation status and details

**Response:**
```typescript
{
  installed: boolean;
  installationId?: number;
  type?: 'user' | 'org';
}
```

### Enhanced useGithubApp Hook
Updated to include installation checking capability:

```typescript
interface GithubAppStatus {
  hasTokens: boolean;
  isLoading: boolean;
  error: string | null;
  checkAppInstallation: (ownerName: string) => Promise<{
    installed: boolean;
    installationId?: number;
    type?: 'user' | 'org';
  }>;
}
```

## Benefits of New Architecture

1. **Clear Separation of Concerns**:
   - `SourceControlOrg`: Where the app is installed
   - `SourceControlToken`: Who can access the installation
   - `Repository`: Which repos belong to which org

2. **Multi-Org Support**: Workspaces can have repositories from different orgs (future feature)

3. **Proper Token Scoping**: Users have tokens scoped to specific orgs they can access

4. **Shared Installations**: Multiple workspaces can reference the same `SourceControlOrg`

5. **User vs Org Parity**: Handles GitHub app installations on both user accounts and organizations identically

## Migration Path

### Phase 1: Schema Migration ✅
- Add `SourceControlOrg` and `SourceControlToken` models
- Add `sourceControlOrgId` to `Repository` model
- Create database migration

### Phase 2: API Implementation ✅
- Implement `/api/github/app/check-installation` endpoint
- Update `useGithubApp` hook with installation checking

### Phase 3: Data Migration (TODO)
- Migrate existing `githubInstallationId` from `Swarm` to `SourceControlOrg`
- Create corresponding `SourceControlToken` records
- Link existing repositories to appropriate `SourceControlOrg`

### Phase 4: Integration (TODO)
- Update workspace creation flow to use new architecture
- Update repository creation to link to `SourceControlOrg`
- Remove old `githubInstallationId` from `Swarm` model

### Phase 5: Testing (TODO)
- Test installation flow for new orgs
- Test OAuth flow for existing orgs
- Test multi-user access to same org
- Test user vs organization installations

## Current Status

✅ Schema models designed and added to Prisma schema
✅ API endpoint for installation checking implemented
✅ useGithubApp hook enhanced with installation checking capability
⏳ Database migration ready to run: `npx prisma migrate dev --name add_source_control_models`

Next steps: Run migration and begin implementing the integration logic.