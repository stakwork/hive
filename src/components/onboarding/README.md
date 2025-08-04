# Onboarding Components

This directory contains the refactored onboarding components following a modular, maintainable architecture.

## Architecture Overview

The onboarding system has been broken down into several focused components:

### 1. `OnboardingHeader`

- **Purpose**: Reusable header component for onboarding pages
- **Features**:
  - Customizable title and description
  - Configurable icon (defaults to Building2)
  - Consistent styling across onboarding flows

### 2. `FormField`

- **Purpose**: Reusable form field component
- **Features**:
  - Supports both input and textarea types
  - Built-in error and help text display
  - Optional prefix support (e.g., "hive.app/")
  - Consistent styling and validation states

### 3. `WorkspaceForm`

- **Purpose**: Main workspace creation form
- **Features**:
  - Uses the `useWorkspaceForm` custom hook for logic
  - Composed of reusable `FormField` components
  - Handles form submission and error display

### 4. `useWorkspaceForm` Hook

- **Purpose**: Custom hook containing all form logic
- **Features**:
  - Form state management
  - Validation logic
  - API submission handling
  - Auto-slug generation from name

## Benefits of This Architecture

1. **Separation of Concerns**: Logic is separated from presentation
2. **Reusability**: Components can be used across different onboarding flows
3. **Maintainability**: Easier to update and test individual pieces
4. **Type Safety**: Full TypeScript support with proper interfaces
5. **Consistency**: Follows patterns established in other parts of the codebase

## Usage Example

```tsx
import { OnboardingHeader, WorkspaceForm } from "@/components/onboarding";

export function MyOnboardingPage() {
  return (
    <div className="container">
      <OnboardingHeader
        title="Setup Your Account"
        description="Let's get you started"
      />
      <WorkspaceForm />
    </div>
  );
}
```

## Future Enhancements

- Add more form field types (select, checkbox, etc.)
- Create additional onboarding step components
- Add progress indicator component
- Implement form persistence across page refreshes
