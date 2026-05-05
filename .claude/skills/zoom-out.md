---
name: zoom-out
description: Get a high-level architectural map of an unfamiliar area of the codebase. Use when you don't know this section of code well, need to understand how a module fits into the bigger picture, or want a map of all relevant callers and dependents before making changes.
---

I don't know this area of code well. Go up a layer of abstraction. Give me a map of all the relevant modules and callers, using the project's domain glossary vocabulary.

- Which files import or call into this area?
- What does this module expose to the rest of the system?
- What are its dependencies?
- Where does data flow in and out?
- Are there any architectural seams or boundaries worth noting?

Use the CLAUDE.md domain vocabulary. Keep it a map — not a tutorial.
