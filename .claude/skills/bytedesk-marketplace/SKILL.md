```markdown
# bytedesk-marketplace Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `bytedesk-marketplace` TypeScript codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns. Use this guide to write consistent, maintainable code and streamline your workflow in this repository.

## Coding Conventions

### File Naming
- **PascalCase** is used for file names.
  - Example:  
    ```
    UserProfile.ts
    OrderService.ts
    ```

### Import Style
- **Relative imports** are preferred.
  - Example:
    ```typescript
    import { UserProfile } from './UserProfile';
    import { OrderService } from '../services/OrderService';
    ```

### Export Style
- **Named exports** are used instead of default exports.
  - Example:
    ```typescript
    // UserProfile.ts
    export interface UserProfile { ... }

    // OrderService.ts
    export function fetchOrders() { ... }
    ```

### Commit Message Patterns
- **Freeform** commit messages, often prefixed with `fleet`.
- Average length: ~55 characters.
  - Example:
    ```
    fleet: add new order processing logic to OrderService
    ```

## Workflows

### Creating a New Feature
**Trigger:** When adding a new feature or module  
**Command:** `/new-feature`

1. Create a new file using PascalCase (e.g., `NewFeature.ts`).
2. Use relative imports to include dependencies.
3. Export your functions, classes, or interfaces using named exports.
4. Write a corresponding test file named `NewFeature.test.ts`.
5. Commit your changes with a message prefixed by `fleet` (if applicable).

### Writing and Running Tests
**Trigger:** When verifying code correctness  
**Command:** `/test`

1. Create a test file with the pattern `*.test.ts` (e.g., `UserProfile.test.ts`).
2. Write your tests using the project's preferred (unknown) testing framework.
3. Run the test suite using the project's test runner (check project scripts or documentation).

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor`

1. Update file names to PascalCase if needed.
2. Ensure all imports are relative.
3. Change any default exports to named exports.
4. Update or add tests to cover refactored code.
5. Commit changes with a descriptive message.

## Testing Patterns

- Test files use the `*.test.ts` naming convention.
- The specific testing framework is unknown; check existing test files for patterns.
- Place tests alongside the modules they cover or in a dedicated `tests` directory.
- Example test file name:  
  ```
  UserProfile.test.ts
  ```

## Commands
| Command        | Purpose                                            |
|----------------|----------------------------------------------------|
| /new-feature   | Scaffold a new feature/module with proper patterns |
| /test          | Run the test suite                                 |
| /refactor      | Refactor code to match repository conventions      |
```
