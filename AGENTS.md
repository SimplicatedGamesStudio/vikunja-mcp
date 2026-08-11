# Vikunja MCP Engineering Contract

Shared instructions for every coding agent working in this submodule.

## Commands

- Build: `npm run build`
- Focused test: `npm test -- <path-or-pattern>`
- Coverage gate: `npm run test:coverage`
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- MCP integration check: `npm run test:mcp`
- `npm run format` rewrites tracked files; run it only when formatting is part
  of the intended change.

Run the narrowest relevant check first. Before a release or broad change, run
lint, coverage, and type checking.

## Architecture

- This package is an MCP server. `src/index.ts` owns server startup and stdio
  transport; tools register through the central tool registry.
- Keep tool handlers thin: validate arguments at the boundary, delegate to the
  appropriate client/service layer, and return structured MCP errors.
- Preserve session-scoped client state and credential isolation. Do not log
  credentials, tokens, or raw authorization headers.
- Authentication capability is determined by the supplied credential type.
  Keep JWT-only operations unavailable to API-token sessions.
- Filtering may use server support with a client-side fallback. Bound memory and
  runtime for untrusted or unexpectedly large API responses.
- Retry, rate limiting, input validation, and error utilities are shared
  infrastructure. Reuse them instead of creating per-tool variants.

## Implementation and tests

- Keep TypeScript strict and use existing Zod schemas for external tool input.
- Preserve credential masking, structured errors, partial-success reporting,
  and cancellation or timeout behavior at API boundaries.
- Add or update focused Jest coverage for changed behavior, including malformed
  input, authentication boundaries, and external API failures where relevant.
- The enforced Jest thresholds are 90% branches, 98% functions, 95% lines,
  and 95% statements; treat them as the source of truth rather than historic
  coverage snapshots.
- Update README tool documentation only when a public tool contract changes.

## Working rules

- Inspect the current implementation and callers before editing. Reuse existing
  utilities and keep the smallest safe change.
- Do not add speculative abstractions, dependencies, or compatibility layers.
- Fail visibly and safely; do not silently discard an API or validation error.
- Preserve unrelated worktree changes. Run `git diff --check` before handoff.
