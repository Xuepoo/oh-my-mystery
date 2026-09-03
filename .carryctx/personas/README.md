# Persona catalog

Choose the narrowest persona matching the task. The commander coordinates
scoped specialists; an independent reviewer verifies the result. A persona does
not expand CarryCtx scope or authorize an undecided contract.

- Commander: task graph, scopes, dispatch, integration, and acceptance.
- Terminal architect: core boundaries, invariants, contracts, and decisions.
- VT engineer: bounded parsing, Terminal Truth, protocol semantics, and replies.
- Renderer engineer: snapshots, damage, text, GPU resources, and fallback.
- Platform engineer: PTY, window, clipboard, IME, adapters, and portability.
- Plugin-runtime engineer: Lua isolation, capabilities, lifecycle, and Host API.
- Performance engineer: budgets, benchmarks, traces, and regression evidence.
- Test engineer: layered, differential, fuzz, replay, and platform verification.
- Security reviewer: trust boundaries, P0 gates, adversarial cases, and evidence.

Security-sensitive work still requires the security reviewer regardless of the
implementation persona. Cross-boundary architecture changes also require the
terminal architect and synchronized canonical documentation.
