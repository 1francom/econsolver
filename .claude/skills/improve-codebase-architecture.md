---
name: improve-codebase-architecture
description: Identify and plan architectural improvements — shallow modules, tight coupling, untestable code paths, scattered concepts. Use when the user wants to improve code structure, reduce complexity, or plan a refactor. Produces a list of deepening candidates for user to choose from.
---

## Improve Codebase Architecture

Identify opportunities to deepen the architecture — refactoring shallow modules into deep ones to improve testability, navigability, and maintainability.

### Vocabulary

- **Module**: a unit with an interface and implementation
- **Interface**: what callers see (function signatures, props, exports)
- **Depth**: ratio of implementation complexity to interface complexity — deep = small interface, rich implementation
- **Seam**: a boundary where implementation can be swapped without callers changing
- **Adapter**: a module that translates between two seams
- **Leverage**: what callers gain by delegating to this module
- **Locality**: knowledge concentrated in one place, not scattered

### Phase 1 — Explore

Read CLAUDE.md first (domain glossary, architectural invariants). Then walk the codebase organically.

Watch for friction signals:
- Concepts scattered across many small modules (low locality)
- "Shallow" modules where interface complexity matches implementation (no leverage)
- Code paths with no tests or that are hard to test
- Tight coupling: callers that depend on internal structure of their collaborators
- Repeated logic that should be behind a shared interface

**Deletion test:** if you removed this module, would the complexity concentrate somewhere (good — it has leverage) or scatter everywhere (bad — it's load-bearing in the wrong way)?

### Phase 2 — Present Candidates

List 3–5 deepening opportunities. For each:

```
Files:    [affected files]
Problem:  [what the friction is, in domain vocabulary]
Solution: [proposed deep module — its interface, what it hides]
Benefits: [testability, locality, leverage gained]
```

Use CLAUDE.md vocabulary throughout. Flag invariant conflicts only when the friction is real enough to revisit them.

**Stop here — ask which candidate to explore.**

### Phase 3 — Grilling Loop

Dive into the chosen candidate with design exploration:
- What should the public interface look like?
- What does it hide from callers?
- How does it interact with existing seams?
- What tests become possible that weren't before?

Side effects:
- Add new domain terms to CLAUDE.md when naming deepened modules
- Offer an ADR only when rejecting a candidate for load-bearing architectural reasons

Prioritize **locality** and **leverage** over rigid patterns.
