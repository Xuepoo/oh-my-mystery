# OMM (Oh My Mystery) Developer & Agent Handbook

Welcome to **OMM (Oh My Mystery)** — A Zero-DOM, VectoJS-native mystery fiction knowledge graph visualization and recommendation web application.

---

## 1. Architecture & Monorepo Layout

This repository is managed with Bun and structured as a lightweight monorepo:

```text
omm/
├── .carryctx/            # Persistent task state and context continuity
├── .github/              # Issue and Pull Request templates
├── apps/
│   ├── web/              # Vite + TypeScript + VectoJS Native frontend
│   └── api/              # Hono on Cloudflare Workers backend + D1 bindings
├── packages/             # Shared packages and utilities
├── scripts/              # Cloudflare deployment and maintenance scripts
├── Justfile              # Unified task runner recipes (fmt, check, lint, test, deploy)
└── package.json          # Monorepo root
```

---

## 2. Engineering Standards & Quality Gates

This project standardizes on the Rust/Go-based toolchain aligned with VectoJS:

- **Package Manager & Runtime**: `bun` only (`bun install`, `bun run ...`).
- **Task Runner**: `just` (`just check`, `just fmt`, `just lint`, `just test`, `just verify`, `just deploy`).
- **Code Formatter (Authority)**: `oxfmt` (`.oxfmtrc.json`). Single quotes in JS/TS.
- **Linter (Authority)**: `oxlint` (`.oxlintrc.json`) with `--deny-warnings`.
- **Markdown Linter**: `markdownlint-cli2` (`.markdownlint-cli2.jsonc`).
- **Git Hooks**: `lefthook` (`lefthook.yml`) enforcing `oxfmt`, `oxlint`, and `commitlint` on commits.
- **Commit Messages**: `commitlint` with Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).

---

## 3. CarryCtx & Git Worktree Workflow

All feature work, bugfixes, and refactors **must** be isolated in Git worktrees and tracked via `carryctx`:

```bash
# 1. Check current status & resume context
carryctx resume --agent <you>

# 2. Claim and start a task
carryctx task create --title "feat: implement 1-hop lazy graph expand"
carryctx task claim CTX-0001 --agent <you>
carryctx task start CTX-0001 --agent <you>

# 3. Create an isolated Git worktree for the task
carryctx worktree create CTX-0001
# (or use the Just recipe: just wt-create CTX-0001)

# 4. Work in the worktree, track progress
carryctx progress todo "Add API adapter for D1 endpoint" --agent <you>
carryctx progress note "Verified 1-hop expansion latency < 15ms" --agent <you>

# 5. Checkpoint before committing or ending session
carryctx checkpoint --agent <you> --task CTX-0001 --done "API adapter completed" --remaining "UI drawer integration" --blocker "none"

# 6. Complete task and clean up worktree
carryctx task complete CTX-0001 --agent <you>
just wt-clean ctx-0001
```

---

## 4. VectoJS Upstream Collaboration Protocol

When defects, performance bottlenecks, or missing capabilities are discovered in `@vectojs/*` during development:

1. **Locate Upstream**: The VectoJS framework repository is located at `https://github.com/vectojs/vectojs`.
2. **Reproduce & Report**: File a clear issue in upstream with reproduction steps or minimal test case.
3. **Fix in Upstream**:
   - Inspect upstream source (`packages/core`, `packages/knowledge-graph`, `packages/graph3d`, `packages/ui`, etc.).
   - Follow upstream rules (`AGENTS.md` in VectoJS): write unit tests in Vitest, run `just verify` / `just wasm-check`.
   - Run `bun run changeset` to create a changeset for public package modifications.
   - Submit a pull request to `vectojs/vectojs`.
4. **Release & Bump**: Once the fix is merged and released upstream, update the package dependency versions in `omm`.

---

## 5. Deployment

Deployment is performed via Cloudflare Pages and Workers using Wrangler:

```bash
just deploy
# runs scripts/deploy-pages.sh to safely deploy apps/web/dist to Cloudflare Pages
```

---

## 6. Data Pipeline & Snow Sync

The authoritative crawler database lives on the cloud server `snow` (~/mystery-clawer/data/mystery.db, ~4GB, NO_GIT).
The crawler source lives in the sibling git repo `../mystery-clawer` (local).

```text
local mystery-clawer (git)
  └─ rsync code ──▶ snow:~/mystery-clawer (NO_GIT)
                       └─ uv run python scripts/run.py [--only <source>]   # crawl (sources in config.yaml)
                       └─ uv run python scripts/export_full.py / export_rdf.py   # export/ (ttl, facts.jsonl, ...)
  ◀── rsync data/mystery.db back ──┘
omm/scripts/build-d1-db.ts   # reads ../mystery-clawer/data/mystery.db → omm/data/omm-d1.sqlite
omm/scripts/import-d1.ts     # full remote D1 import (~2h) — use targeted wrangler d1 execute --file for deltas
omm/scripts/cleanup-remote-d1.ts  # delete remote rows not present in the local canonical id list
```

Key rules:

- Code changes: commit locally, then `rsync -avz --delete src/ scripts/ snow:~/mystery-clawer/src/` (adjust paths as needed); never edit on snow.
- DB pull: `rsync -avz snow:~/mystery-clawer/data/mystery.db ../mystery-clawer/data/mystery.db`.
- Build D1 from repo root: `bun scripts/build-d1-db.ts`. In a git worktree, symlink `.worktrees/mystery-clawer -> ../../mystery-clawer` first (the script resolves `scripts/../../mystery-clawer/data/mystery.db`).
- Remote D1 access requires the proxy: `HTTPS_PROXY=$NETWORK_PROXY wrangler d1 execute omm-db --remote ...` (without proxy, wrangler fetch fails).
- Worker deploy: `cd apps/api && HTTPS_PROXY=$NETWORK_PROXY wrangler deploy`.
- Verify prod from snow (local network proxy blocks workers.dev):
  `ssh snow 'curl -s https://omm-api.ven3428set.workers.dev/api/health'`.
