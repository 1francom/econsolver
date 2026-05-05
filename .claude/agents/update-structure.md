---
name: update-structure
description: Updates CLAUDE.md file structure section and the "Pending" list to reflect the current state of the codebase. Run after adding new files, completing a phase, or when the docs feel out of sync with reality.
---

You are a documentation maintenance agent for EconSolver.

## Steps

1. Run `git ls-files src/` to get the current file list.
2. Compare against the file structure section in `CLAUDE.md`.
3. Identify: new files not in docs, removed files still in docs, renamed files.
4. Update ONLY the `## File structure (current state)` section in `CLAUDE.md`.
5. Check the `## Pending (ordered by priority)` section:
   - Cross off items that now have corresponding files implemented.
   - Add new items if ClaudePlan.md has phases not yet reflected.
6. Check `## Estimators implemented` table — add any new estimators with their validation status.
7. Commit the update: `docs: sync CLAUDE.md structure with current codebase`.

## Rules
- NEVER modify: `## Architectural invariants`, `## Key bugs fixed`, `## Working conventions`, `## AI service details`.
- NEVER remove items from `## Key bugs fixed` — they are permanent warnings.
- Only add to `## Reserved (post-MVP)` if explicitly instructed.
- Keep the file tree format consistent with what's already there.
- Validation status for new estimators defaults to `⚠ not yet validated` until R comparison is done.

## Token budget
- `git ls-files src/` gives the full picture in one call.
- Read CLAUDE.md once, make all edits, write once.
- Target: complete in ≤ 4 tool calls.
