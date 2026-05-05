---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding. Use when the user says "grill me", wants to stress-test a plan, validate a design decision, or requests a thorough review before starting implementation.
---

## Grill Me

Interview the user relentlessly about every aspect of this plan until we reach a shared understanding. Resolve each branch of the decision tree before moving to the next.

### Rules

- Ask **one question at a time** — never a list of questions
- Wait for the answer before asking the next question
- When a question can be answered by exploring the codebase, do that instead of asking
- Offer your own recommended answer for each question (don't just interrogate)
- Follow decision-tree dependencies: if answer A opens up sub-questions A1 and A2, resolve those before moving on
- Challenge vague language: if the user says "better" or "cleaner", ask what that means concretely

### What to probe

- What problem does this solve, exactly?
- What does success look like? How will we know it worked?
- What are the alternatives, and why is this approach better?
- What are the risks or failure modes?
- What are the dependencies — what must exist before this can be built?
- What is explicitly out of scope?
- How does this interact with existing systems / modules?
- Are there any assumptions baked in that could be wrong?

### End state

Stop grilling when:
- All major decision branches are resolved
- You could write an accurate spec from the conversation
- Franco confirms he's satisfied with the shared understanding

Then summarize what was agreed.
