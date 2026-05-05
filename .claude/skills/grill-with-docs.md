---
name: grill-with-docs
description: Interview-style session to stress-test a plan against the project's domain model, terminology, and documented decisions in CLAUDE.md and docs/. Use when validating a design against existing architecture, spotting terminology conflicts, or aligning intent with what's actually in the codebase.
---

## Grill With Docs

Stress-test this plan against the project's domain model and documented architectural decisions.

### Approach

- Ask one question at a time, wait for answer before proceeding
- When a question can be answered by reading the codebase or CLAUDE.md, do that instead of asking
- Challenge vague language and spot conflicts with existing terms
- Test domain relationships with concrete edge-case scenarios

### What to probe

**Terminology conflicts:**
"Your CLAUDE.md defines X as Y, but you seem to mean Z — which is it?"

**Code/intent misalignment:**
Compare stated behavior against actual implementation in the codebase.

**Boundary conditions:**
Use invented scenarios to force precision on concept relationships.

**Overloaded terms:**
Propose precise canonical terms to replace fuzzy language.

**Architectural invariants:**
Does this plan violate any invariant in CLAUDE.md? (Non-destructive pipeline, zero React in math/, single API egress, etc.)

### Documentation outcomes

- Update CLAUDE.md inline as terms resolve — don't batch
- Create `docs/adr/` files only when:
  - Decision is hard to reverse
  - Surprising without context
  - Represents a genuine trade-off between real alternatives
- Skip the ADR if the decision is obvious or easily reversible

### End state

Stop when the plan is fully aligned with the domain model and all terminology is unambiguous. Summarize any new terms added and decisions documented.
