# MCP Writing for VS Code

Set up your MCP Writing prose styleguide directly in VS Code with a guided flow.

## What this extension does

- Connects to your running MCP Writing server
- Walks you through styleguide setup with interactive prompts
- Supports project selection when multiple projects are available
- Saves setup configuration through MCP Writing tools

## Commands

- `MCP Writing: Test Server Connection`
- `MCP Writing: Setup Prose Styleguide`
- `MCP Writing: Update Prose Styleguide`

## Requirements

- A running MCP Writing server (default URL: `http://localhost:3000`)
- VS Code `1.100.0` or newer

## Quick start

1. Start your MCP Writing server.
2. In VS Code, open Command Palette and run `MCP Writing: Test Server Connection`.
3. Run `MCP Writing: Setup Prose Styleguide`.
4. Follow the prompts to complete setup.

## Extension settings

- `mcpWriting.serverUrl`: Base URL for MCP Writing server (`http://localhost:3000` by default).

## Troubleshooting

- If you get `fetch failed`, verify the server is running and reachable from VS Code.
- If setup cannot write config, ensure your `WRITING_SYNC_DIR` is writable.

## Project links

- MCP Writing: [github.com/hannasdev/mcp-writing](https://github.com/hannasdev/mcp-writing)
- Extension repository: [github.com/hannasdev/mcp-writing-vscode](https://github.com/hannasdev/mcp-writing-vscode)
