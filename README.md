# Oh My Mystery (OMM)

Global Mystery Fiction Knowledge Graph Visualization & Recommendation System.
Built with **VectoJS Native (Zero-DOM Canvas)** and deployed on **Cloudflare Pages & Workers**.

---

## Tech Stack

- **Frontend**: Vite + TypeScript + `@vectojs/knowledge-graph` + `@vectojs/core` + `@vectojs/ui`
- **Backend API**: Hono running on Cloudflare Workers
- **Database**: Cloudflare D1 (Serverless SQLite)
- **Deployment**: Cloudflare Pages (`mystery.xuepoo.xyz`)
- **Task Management**: CarryCtx + Git Worktrees
- **Toolchain**: Bun, oxfmt, oxlint, markdownlint-cli2, lefthook, commitlint, just

---

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Run quality checks
just check

# 3. Start development server
just dev

# 4. Deploy to Cloudflare Pages
just deploy
```
