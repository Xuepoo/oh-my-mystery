# Documentation rules

1. Repository-owned documentation is English-only.
2. `bitty-docs` is the canonical design and governance corpus. This repository
   owns implementation evidence and repository-local developer instructions.
3. Distinguish normative requirements, accepted decisions, candidates, open
   questions, and implemented behavior. A file or plan is not implementation.
4. Synchronize affected `bitty-docs` architecture, security, public behavior,
   configuration, compatibility, reference, developer, risk, and decision
   documents in the same delivery.
5. Link to one authoritative definition instead of copying a divergent contract
   into source comments, tests, or local documents.
6. Public commands, fields, protocols, errors, defaults, limits, platform
   support, and performance claims require implementation and test/release
   evidence from the owning revision.
7. Documentation status must stay honest while the repository is unborn and
   throughout implementation. Candidate text cannot authorize code by itself.
8. Record cross-repository docs tasks and ordering in CarryCtx; stale affected
   documentation keeps the implementation task incomplete.
9. Formal repository references use the canonical organization URL
   <https://github.com/bitty-terminal>.
