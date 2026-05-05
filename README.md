# mcp-writing-vscode

VS Code extension for MCP Writing client-native setup flows.

Repository: [github.com/hannasdev/mcp-writing-vscode](https://github.com/hannasdev/mcp-writing-vscode)

## Features

- `MCP Writing: Test Server Connection`
- `MCP Writing: Setup Prose Styleguide`
- Contract-driven setup prompts for scope/language/project selection
- Optional bootstrap preview flow before config write

## Usage

1. Start MCP Writing server (default expected URL: `http://localhost:3000`).
2. In VS Code settings, set `mcpWriting.serverUrl` if needed.
3. Run command palette action: `MCP Writing: Test Server Connection`.
4. Run command palette action: `MCP Writing: Setup Prose Styleguide`.

The setup command:
- reads setup metadata from `describe_workflows`
- prompts for scope/language/project context
- optionally runs bootstrap analysis
- writes styleguide config (and sync-root skill when applicable)

## Local development

```sh
npm install
# Press F5 in VS Code to start Extension Development Host
```

## Packaging

```sh
npm run package
```

This produces a `.vsix` file you can install locally in VS Code.

## Publish to VS Code Marketplace

1. Create a publisher in the VS Code Marketplace.
2. Create a Personal Access Token for that publisher.
3. Login once:

```sh
npx vsce login hannasdev
```

4. Publish:

```sh
npm run publish:marketplace
```
