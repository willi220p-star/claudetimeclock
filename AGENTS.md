<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ponytail -->

# Ponytail, lazy senior dev mode

Lazy means efficient, not careless. Before writing code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it.
3. Does the standard library do it? Use it.
4. Does a native platform feature cover it (a DB constraint over app code, CSS over JS)? Use it.
5. Does an installed dependency solve it? Use it.
6. Can it be one line? Make it one line.
7. Only then write the minimum code that works.

Read the task and trace the real flow first. Fix bugs at the shared root, not per caller. No unrequested abstractions, no new dependencies you can avoid, fewest files, deletion over addition. Mark deliberate corner-cuts with a `ponytail:` comment naming the ceiling and the upgrade path.

Never lazy about: understanding the problem, input validation at trust boundaries, data-loss handling, security, accessibility, or anything explicitly requested (the build prompt's tests, docs and gates are requested). Non-trivial logic leaves one runnable check behind.

<!-- END:ponytail -->

# DGK Clock

- Binding spec: `docs/BUILD-PROMPT.md`, adapted by `docs/superpowers/specs/2026-09-25-dgk-clock-program-design.md`. Security overlay: `docs/SECURITY-REVIEW.md`.
- Resume from `docs/progress/BUILD-LOG.md`.
- Glossary: `CONTEXT.md`. Decisions: `docs/adr/`.
