# Issue-to-merge workflow

## Purpose

Use this workflow for repository changes after a GitHub Issue identifies the
outcome. It defines durable CarryCtx mapping, isolated delivery, independent
acceptance, and documentation synchronization. It does not authorize product
implementation or remote mutation by itself.

## 1. Establish intent

1. Open or link a GitHub Issue with outcome, scope, constraints, security and
   performance impact, documentation impact, and acceptance evidence.
2. Confirm the work belongs to this repository. Split cross-repository work into
   linked Issues with explicit ordering.
3. Resolve or identify the accepted requirement, specification, ADR, RFC, or
   normative security control. Do not implement an undecided public boundary.

## 2. Encode execution in CarryCtx

1. Create or select the CarryCtx task linked to the Issue.
2. Assign its team, required persona, owner, priority, and strong or
   informational dependencies.
3. Add exact file scopes and inspect conflicts. Serialize overlapping contracts.
4. Bind a named agent session and read team context before changes.
5. Record progress, decisions, risks, blockers, handoffs, and checkpoints during
   the work.

## 3. Select workspace isolation

1. After the repository has a first commit, create a dedicated CarryCtx
   worktree and branch for parallel or substantial work.
2. Keep one task outcome per branch and preserve unrelated changes.
3. In an unborn repository, branch/worktree/commit/PR stages are unavailable.
   The commander may authorize a shared checkout only when scopes are disjoint
   and local CI-equivalent checks are possible.
4. End the unborn exception after repository initialization; do not retain it as
   the normal path.

## 4. Implement and verify

1. Adopt the assigned persona and applicable delivery, documentation, security,
   and performance rules.
2. Implement only the accepted contract in scope. Add focused tests first where
   practical, then cover errors, bounds, denial, cleanup, and recovery.
3. Update affected canonical `bitty-docs` material for architecture, security,
   public behavior, configuration, compatibility, and developer workflows.
4. Run focused checks and the repository integration gate. Record exact commands,
   environment, results, and residual gaps in CarryCtx.
5. Checkpoint a coherent milestone before handoff or task switching.

## 5. Commit and open a pull request

1. Review the diff for scope, generated artifacts, secrets, accidental API
   expansion, and stale documentation.
2. Create coherent commits linked to the Issue and CarryCtx task when commit
   authority exists.
3. Open a pull request that states outcome, contracts, security/performance
   impact, docs synchronization, verification, dependencies, and merge order.
4. Link affected cross-repository pull requests and the exact docs revision.

## 6. Independent review and CI

1. Move the task to review; the implementer does not self-accept.
2. The reviewer reads the authoritative contracts, inspects the diff, reruns
   relevant checks, and records findings or acceptance in CarryCtx.
3. Required architecture, security, performance, platform, test, and docs owners
   review changes crossing their boundaries.
4. Resolve every blocking finding and CI failure before merge. A self-report or
   partial gate is not acceptance evidence.

## 7. Merge and close

1. Merge only after independent acceptance, required CI, synchronized docs, and
   cross-repository ordering are satisfied.
2. Verify the merged revision and any pinned documentation relationship.
3. Record final evidence and revision in a CarryCtx checkpoint.
4. Complete the CarryCtx task and close the GitHub Issue. Preserve separately
   authorized follow-up work as linked tasks rather than hidden residual gaps.
