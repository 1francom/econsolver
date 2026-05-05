---
name: tdd
description: Test-driven development using red-green-refactor with vertical slices (tracer bullets). Use when the user wants to build a feature with tests, add tests to existing code, or practice TDD discipline. Never write all tests upfront — one test, one implementation, repeat.
---

## TDD — Red-Green-Refactor with Vertical Slices

### Philosophy

Tests should verify **behavior through public interfaces**, not implementation details. Code can change entirely; tests shouldn't.

Good tests:
- Exercise real code paths through public APIs
- Describe *what* the system does, not *how*
- Read like specifications: "user can checkout with valid cart"
- Survive refactors because they don't care about internal structure

Bad tests:
- Mock internal collaborators
- Test private methods
- Break on refactors when behavior hasn't changed

### Anti-Pattern: Horizontal Slices — DO NOT DO THIS

Do not write all tests first, then all implementation. This produces brittle tests that test imagined behavior.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
```

### Workflow

#### 1. Planning

Before writing any code:
- [ ] Confirm with user what interface changes are needed
- [ ] Confirm which behaviors to test (prioritize critical paths)
- [ ] Design interfaces for testability
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

You can't test everything — focus on critical paths and complex logic.

#### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails (confirm it fails for the right reason)
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet — proves the path works end-to-end.

#### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:
- One test at a time
- Only enough code to pass the current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

#### 4. Refactor

After ALL tests pass:
- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

### Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```
