# Performance rules

1. Performance is a contract expressed through accepted, measurable budgets;
   descriptive goals alone are not acceptance criteria.
2. A claim records workload, input corpus, hardware, OS, build profile,
   toolchain, warmup, sample size, variance, baseline, and exact revision.
3. Measure input-to-state latency, state-to-frame latency, frame pacing,
   throughput, startup, memory, allocation, GPU resources, and energy separately.
4. Plugins never execute in terminal, render, or input hot paths. Blocking I/O,
   unbounded allocation, and uncontrolled queues are forbidden there.
5. Bound protocol payloads, decoded images, dimensions, stores, caches, queues,
   callbacks, tasks, and plugin execution before optimizing them.
6. Benchmark fixtures and traces must be reproducible and secret-minimizing.
   Cross-platform claims require evidence on the named platform.
7. A benchmark improvement cannot weaken correctness, security, compatibility,
   accessibility, portability, fallback, or recovery.
8. Record regressions and residual uncertainty in CarryCtx; update canonical
   performance requirements when an accepted budget changes.
