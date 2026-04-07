# General Development Rules

## Code Style & Organization
- Always use functional components with hooks
- Prefer TypeScript over JavaScript
- Use meaningful variable and function names
- Keep functions small and focused on a single responsibility
- Use proper TypeScript types and interfaces
- Follow the existing file structure and naming conventions

## File Organization
- Place components in `src/components/`
- Place pages in `src/app/`
- Place utilities in `src/lib/` or `src/utils/`
- Place types in `src/types/`
- Place hooks in `src/hooks/`

## Import/Export Guidelines
- Use named exports for components and utilities
- Use default exports for pages
- Group imports: React/Next.js, third-party libraries, local imports
- Use absolute imports from `src/` when possible

## Error Handling
- Always handle potential errors in async operations
- Use try-catch blocks appropriately
- Provide meaningful error messages
- Log errors for debugging purposes

## Performance
- Use React.memo for expensive components
- Implement proper loading states
- Optimize images and assets
- Use Next.js built-in optimizations