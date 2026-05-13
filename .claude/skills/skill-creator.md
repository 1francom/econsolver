---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
---

# Skill Creator

A skill for creating new skills and iteratively improving them.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Create a few test prompts and run claude-with-access-to-the-skill on them
- Help the user evaluate the results both qualitatively and quantitatively
  - While the runs happen in the background, draft some quantitative evals if there aren't any (if there are some, you can either use as is or modify if you feel something needs to change about them). Then explain them to the user (or if they already existed, explain the ones that already exist)
  - Use the `eval-viewer/generate_review.py` script to show the user the results for them to look at, and also let them look at the quantitative metrics
- Rewrite the skill based on feedback from the user's evaluation of the results (and also if there are any glaring flaws that become apparent from the quantitative benchmarks)
- Repeat until you're satisfied
- Expand the test set and try again at larger scale

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages.

## Communicating with the user

Pay attention to context cues to understand how to phrase your communication. In the default case:
- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion" you want to see serious cues from the user that they know what those things are before using them without explaining them

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture. If so, extract answers from the conversation history first.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works?

### Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism — include both what the skill does AND specific contexts for when to use it. Make descriptions "pushy" to combat undertriggering.
- **the rest of the skill**

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** - As needed (unlimited)

#### Writing Patterns

Prefer using the imperative form in instructions. Try to explain the **why** behind everything you're asking the model to do.

## Running and evaluating test cases

For each test case, spawn two subagents — one with the skill, one without (baseline). Launch everything at once.

Put results in `<skill-name>-workspace/` as a sibling to the skill directory. Within the workspace, organize results by iteration (`iteration-1/`, `iteration-2/`, etc.).

### Grade, aggregate, and launch the viewer

Once all runs are done:

1. Grade each run using `agents/grader.md`
2. Aggregate into benchmark: `python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>`
3. Launch the viewer: `nohup python <skill-creator-path>/eval-viewer/generate_review.py <workspace>/iteration-N --skill-name "my-skill" --benchmark <workspace>/iteration-N/benchmark.json > /dev/null 2>&1 &`

**GENERATE THE EVAL VIEWER *BEFORE* evaluating inputs yourself.** Get them in front of the human ASAP.

## Improving the skill

1. **Generalize from the feedback.** Don't make fiddly overfitty changes.
2. **Keep the prompt lean.** Remove things that aren't pulling their weight.
3. **Explain the why.** Try hard to explain the reasoning behind every instruction.
4. **Look for repeated work across test cases.** If all test cases resulted in the subagent writing similar helpers, bundle that script.

## Description Optimization

After creating or improving a skill, offer to optimize the description for better triggering accuracy.

Generate 20 eval queries (mix of should-trigger and should-not-trigger), review with user, then run:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

## Core loop (repeat until satisfied)

- Figure out what the skill is about
- Draft or edit the skill
- Run claude-with-access-to-the-skill on test prompts
- With the user, evaluate the outputs via the eval viewer
- Repeat until satisfied
- Package the final skill: `python -m scripts.package_skill <path/to/skill-folder>`
