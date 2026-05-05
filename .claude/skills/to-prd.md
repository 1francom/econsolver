---
name: to-prd
description: Synthesize the current conversation into a structured Product Requirements Document (PRD) and save it to ClaudePlan.md. Use when the user has discussed a feature or phase and wants a formal spec written before implementation begins.
---

## To PRD — Conversation → Product Requirements Document

Synthesize the current conversation into a structured PRD. Do not ask interview questions — derive from what has been discussed. Explore the codebase to fill gaps.

### Process

1. **Read CLAUDE.md** — domain vocabulary, architectural invariants, existing estimators/pipeline steps
2. **Read ClaudePlan.md** — current phase status, what's already done
3. **Explore codebase** — understand current state relevant to the feature
4. **Draft PRD** — using the template below
5. **Present to user** for review before saving

### PRD Template

```markdown
## Problem Statement
[What problem does this solve, from the user's perspective?]

## Solution
[What does the solution do, from the user's perspective?]

## User Stories
1. As a [PhD student / policy analyst], I want [X], so that [Y]
2. ...

## Implementation Decisions

### New files
| File | Purpose |
|------|---------|
| ... | ... |

### Modified files
| File | Changes |
|------|---------|
| ... | ... |

### Interfaces
[Key function signatures, component props, data shapes]

### Architecture notes
[How this fits into the existing system — which invariants apply, which seams are used]

## Testing Decisions
[What behaviors to test, which modules to cover, where seams exist for testing]

## Out of Scope
[Explicit exclusions]

## Build Order
[Ordered steps — each must make the next unblocked]
```

### Rules

- Use CLAUDE.md domain vocabulary throughout
- Note which architectural invariants (non-destructive pipeline, zero React in math/, single API egress) apply
- Prioritize deep modules — small interfaces hiding rich implementations
- Build order must be dependency-ordered, not arbitrary
- Save to ClaudePlan.md as a new Phase section once approved
