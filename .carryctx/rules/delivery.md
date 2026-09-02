# Delivery rules

1. The primary lifecycle is GitHub Issue, CarryCtx task, team/dependencies,
   exact scopes, named session, isolated worktree/branch, coherent commits, pull
   request, independent review plus CI, merge, synchronized documentation,
   checkpoint/task completion, and Issue closure.
2. Link the Issue and task. Map ownership to a team, ordering to dependencies,
   edits to scopes, active work to a session and progress, recovery points to
   checkpoints, and ownership transfer to a handoff.
3. Start only assigned, dependency-ready work. Record decisions, progress,
   findings, risks, blockers, verification, and remaining gaps durably.
4. After the first commit, each parallel implementation task uses a dedicated
   branch and worktree. Cross-repository tasks declare dependencies and merge
   order rather than pretending to be atomic.
5. Before the first commit, worktree/branch/commit/PR stages are unavailable.
   The commander may authorize shared-checkout work only with disjoint scopes,
   preserved unrelated changes, and CI-equivalent local gates.
6. A pull request links its Issue and CarryCtx task and states contract outcome,
   security/performance impact, affected docs, validation, and follow-up.
7. Review is independent. The reviewer inspects authoritative contracts, diff,
   edge cases, synchronized docs, and reproducible evidence.
8. Merge only after required findings and CI failures are resolved. After merge,
   record the revision, verify docs synchronization, checkpoint, complete the
   task, and close the Issue.
9. Do not commit, push, merge, release, publish, or change remote state without
   explicit authority.
