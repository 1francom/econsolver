---
name: mcp-builder
description: Build high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services. Use when the user wants to create, extend, or debug an MCP server — including designing tools, setting up authentication, writing schemas, testing with MCP Inspector, and creating evaluations. Trigger on requests like "build an MCP server", "add MCP tools for X", "create an MCP integration", "make my service accessible to Claude via MCP."
---

# MCP Builder Skill

You build high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools.

## Four-Phase Process

### Phase 1: Research & Planning

- Study the target service's API: key endpoints, authentication, rate limits, data models
- Balance API coverage vs. workflow tools — when unsure, prioritize comprehensive coverage (gives agents max flexibility)
- Review MCP protocol docs: `https://modelcontextprotocol.io`
- **Prefer TypeScript** for new servers — superior SDK support, strong static typing, better AI code generation compatibility

### Phase 2: Implementation

**Project structure:**
```
my-mcp-server/
├── src/
│   ├── index.ts        ← server entry, tool registration
│   ├── client.ts       ← API client + auth
│   ├── tools/          ← one file per domain area
│   └── schemas.ts      ← Zod schemas
├── package.json
└── tsconfig.json
```

**Tool design rules:**
- Use clear, action-oriented names with consistent prefixes: `github_create_issue`, `github_list_prs`
- Write focused descriptions — help agents find the right tool quickly
- Use Zod (TypeScript) or Pydantic (Python) for all input/output schemas
- Return structured data that supports agent filtering and composition
- Error messages must be actionable: tell the agent what went wrong AND what to try next

**Tool annotations:**
- `readOnlyHint: true` — for read-only operations (list, get, search)
- `destructiveHint: true` — for delete/overwrite operations
- `idempotentHint: true` — for operations safe to retry

**Authentication:** Build shared auth infrastructure — don't repeat auth logic per tool.

### Phase 3: Review & Testing

- Verify no duplicated code across tools
- Ensure consistent error handling patterns
- Full type coverage — no `any`
- Test with MCP Inspector: `npx @modelcontextprotocol/inspector`

### Phase 4: Evaluations

Create 10 complex, realistic test questions that verify LLMs can use the server effectively:
- Questions must be independent (no shared state)
- Read-only (no side effects)
- Verifiable (clear correct answer)
- Complex enough to require multiple tool calls

Output format:
```xml
<evaluations>
  <eval>
    <question>...</question>
    <expected_answer>...</expected_answer>
  </eval>
</evaluations>
```

## Key Design Principles

1. **Clear naming** — `service_action_object` pattern, consistent across all tools
2. **Actionable errors** — "Rate limit hit. Retry after 60s." not "Error 429"
3. **Focused returns** — return what agents need to make decisions, not entire API responses
4. **Stateless tools** — each tool call should be independently executable
5. **TypeScript first** — unless the user specifically requests Python

## Transport Options

- **stdio** — for local/CLI servers (default for most use cases)
- **Streamable HTTP** — for remote servers; stateless JSON, works across networks

## Reference Resources

- MCP protocol: `https://modelcontextprotocol.io`
- TypeScript SDK: `@modelcontextprotocol/sdk`
- Python SDK: `mcp` (FastMCP for rapid development)
- MCP Inspector: `npx @modelcontextprotocol/inspector`
