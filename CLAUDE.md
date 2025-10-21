# Superset Monorepo Guide

Guidelines for agents and developers working in this repository.

## Structure

Bun + Turbo monorepo with:
- **Apps**: `apps/*` (empty, to be added)
- **Packages**:
  - `packages/ui` - Shared UI components (shadcn/ui + TailwindCSS v4)
  - `packages/db` - Drizzle ORM database schema
  - `packages/constants` - Shared constants
  - `packages/models` - Shared data models
  - `packages/scripts` - CLI tooling
  - `packages/typescript-config` - TypeScript configs

## Tech Stack

- **Package Manager**: Bun (no npm/yarn/pnpm)
- **Build System**: Turborepo
- **Database**: Drizzle ORM + PostgreSQL
- **UI**: React + TailwindCSS v4 + shadcn/ui
- **Code Quality**: Biome (formatting + linting at root)

## Common Commands

```bash
# Development
bun dev                    # Start all dev servers
bun test                   # Run tests
bun build                  # Build all packages

# Code Quality
bun run lint               # Format + lint + fix auto-fixable issues
bun run lint:check         # Check only (no changes, for CI)
bun run format             # Format code only
bun run format:check       # Check formatting only (CI)
bun run typecheck          # Type check all packages

# Database
bun run db:push            # Apply schema changes
bun run db:seed            # Seed database
bun run db:migrate         # Run migrations
bun run db:studio          # Open Drizzle Studio

# Maintenance
bun run clean              # Clean root node_modules
bun run clean:workspaces   # Clean all workspace node_modules
```

## UI Components

All components in `packages/ui`:
- **Import**: `@superset/ui/button`, `@superset/ui/input`, etc.
- **Icons**: `@superset/ui/icons`
- **Utils**: `@superset/ui/utils`
- **Hooks**: `@superset/ui/hooks`
- **Styles**: `@superset/ui/globals.css`
- **Add shadcn component**: `npx shadcn@latest add <component>` (run in `packages/ui/`)

## Code Quality

**Biome runs at root level** (not per-package) for speed:
- `biome check --write` = format + lint + organize imports + fix safe issues
- `biome check` = check only (no changes)
- `biome format` = format only
- Use `bun run lint` to fix all issues automatically

## Agent Rules

1. **Keep diffs minimal** - targeted edits only
2. **Follow existing patterns** - match the codebase style
3. **Use Bun** - not npm/yarn/pnpm
4. **Don't modify**: lockfiles, generated files, node_modules
5. **Type safety** - avoid `any` unless necessary
6. **Don't run dev servers** in automation
7. **Search narrowly** - avoid reading large files/assets

## Database Rules

- Schema in `packages/db/src/`
- Use Drizzle ORM for all database operations
- **DO NOT run `db:gen`** - reserved for maintainers
