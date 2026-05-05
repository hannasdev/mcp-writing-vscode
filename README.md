# mcp-writing-vscode

VS Code extension for MCP Writing client-native setup flows.

## Current status

- Repository scaffolded
- Command added: `MCP Writing: Setup Prose Styleguide`
- Command flow now connects to MCP SSE, reads `describe_workflows`, and runs styleguide setup actions

## Usage

1. Start MCP Writing server (default expected URL: `http://localhost:3000`).
2. In VS Code settings, set `mcpWriting.serverUrl` if needed.
3. Run command palette action: `MCP Writing: Setup Prose Styleguide`.

The command:
- reads setup contract metadata from `describe_workflows`
- prompts for scope/language/project_id
- optionally runs bootstrap analysis
- writes styleguide config (and sync-root skill when applicable)
