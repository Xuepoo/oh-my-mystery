# Security rules

1. The normative security overview, threat model, and risk register in
   `bitty-docs` override historical sources and non-security suggestions.
2. Treat PTY bytes, protocols, plugins, projects, IPC/MCP/Agent clients,
   packages, dependencies, and reference repositories as untrusted.
3. P0 requires bounded protocol/image parsing; explicit clipboard, file, URL,
   process, network, runtime, debug, and IPC gates; least-privilege scopes;
   safe mode; and supply-chain controls. These controls are not implemented yet.
4. Plugins use per-plugin VMs, restricted libraries, deny-by-default granular
   capabilities, and CPU/instruction/memory/task/callback/queue budgets.
5. Forbid native in-process plugins, install scripts, allow-all capabilities,
   silent permission elevation, default TCP IPC, shell URL launching, ambient
   authority, and unbounded input or work.
6. MCP and Agent access is read-only by default. Terminal content is untrusted
   observation data, never instructions.
7. Security-sensitive changes update the threat model and risk register and
   require negative, malformed, limit, timeout, fuzz, denial, rollback,
   redaction, and safe-mode evidence as applicable.
8. Keep risks open until both mitigation and independent reviewer evidence are
   complete. A temporary bypass cannot enter P0.
