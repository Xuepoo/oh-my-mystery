# OMM (Oh My Mystery) monorepo convenience recipes
# Run `just` to see all available recipes.

default:
    @just --list

# --- Quality Gates --------------------------------------------------------

# Format every source file in place (oxfmt — the authority).
fmt:
    @bun run format

# Full CI gate: format check + oxlint + markdownlint.
check:
    @bun run check

# Lint only, warnings are errors (oxlint).
lint:
    @bun run lint

# Run all unit tests.
test:
    @bun run test

# Format + lint + test — pre-commit habit.
verify: check test

# --- Development & Build --------------------------------------------------

# Start web app development server.
dev:
    @bun run dev

# Build all workspace packages and apps.
build:
    @bun run build

# --- Cloudflare Deployment -----------------------------------------------

# Deploy to Cloudflare Pages safely.
deploy public_dir="apps/web/dist" project_name="mystery-omm" branch="main":
    @./scripts/deploy-pages.sh {{public_dir}} {{project_name}} {{branch}}

# --- Worktree Management --------------------------------------------------

# Create a carryctx worktree for task, e.g. `just wt-create CTX-0001`.
wt-create task:
    @carryctx worktree create {{task}}

# Remove a finished carryctx worktree, e.g. `just wt-clean ctx-0001`.
wt-clean name:
    @git worktree remove --force .worktrees/{{name}} && git worktree prune
    @echo "Removed .worktrees/{{name}}"
