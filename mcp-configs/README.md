# ShipGate Context — Third-Party Coding Agent MCP Setup

Once `shipgate-context-forge` is deployed to your Atlassian Cloud workspace (`forge deploy && forge install`), its `rovo:mcp` module (`shipgate-mcp-server`) automatically exposes 4 tools through the **Atlassian MCP Server**:

- `fetch-context-graph`
- `verify-adr-compliance`
- `create-mitigation-subtasks`
- `log-release-attestation`

## 1. Claude Code / Claude Desktop / Cursor / Google Antigravity (`mcp_client_config.json`)

Add the snippet in `mcp_client_config.json` to:
- **Claude Code**: `.mcp.json` or `~/.claude.json`
- **Cursor**: `.cursor/mcp.json`
- **Google Antigravity**: `~/.gemini/antigravity/mcp_config.json`

Also copy [`../SKILL.md`](../SKILL.md) into `.agents/skills/shipgate-atlassian-context/SKILL.md` (or `.claude/skills/shipgate-atlassian-context/SKILL.md`) so the coding agent automatically runs ADR & Teamwork Graph blast-radius checks before every PR or migration.

## 2. OpenAI Codex CLI (`codex_config.toml`)

Append `codex_config.toml` into `~/.codex/config.toml`.
