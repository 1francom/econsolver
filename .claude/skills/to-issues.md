---
name: to-issues
description: Convert a plan, spec, or conversation into independently-executable GitHub issues using vertical slices. Use when the user has a plan or PRD and wants to break it into trackable, agent-executable work items. Each issue is a thin but complete end-to-end slice.
---

## To Issues — Plan → GitHub Issues

Convert this plan into independently-executable issues using vertical slices (tracer bullets).

### Core Principle

Each slice must be a **narrow but COMPLETE path through every layer** (math, service, component, UI, tests) — not a horizontal layer slice (e.g., "add all DB migrations", "write all tests").

A completed slice should be demoable or verifiable in the browser independently.

### Process

1. **Gather context** — read the conversation, CLAUDE.md, and ClaudePlan.md
2. **Explore codebase** — understand current state, use domain vocabulary from CLAUDE.md
3. **Draft vertical slices** — each is one thin end-to-end path
4. **Quiz the user** — ask about:
   - Granularity (too thin? too thick?)
   - Dependencies between slices
   - HITL vs AFK classification
5. **Publish issues** in dependency order

### Issue Classification

- **HITL** (Human In The Loop): requires a design decision, architectural choice, or review before proceeding
- **AFK** (Away From Keyboard): can be implemented and merged autonomously — preferred

### Issue Template

For each issue:

```markdown
## What to build
[End-to-end behavior description — what the user sees / what tests verify]

## Acceptance criteria
- [ ] [specific, verifiable condition]
- [ ] [specific, verifiable condition]

## Depends on
- #[issue number] [title]

## Notes
[Any context, edge cases, CLAUDE.md invariants to respect]
```

### Rules

- Many thin slices over few thick ones
- Each issue must make sense in isolation — a new agent should be able to pick it up
- Use CLAUDE.md domain vocabulary in titles and descriptions
- Iterate with the user before publishing
- Flag CLAUDE.md invariants that the implementer must respect
