# Releasing (VSIX + GitHub Releases)

This project ships via GitHub Releases and `.vsix` artifacts (no Marketplace token required).

## 1. Prepare version

- Update version:

```bash
npm version patch --no-git-tag-version
```

(or `minor`/`major` as needed)

## 2. Build + test + package + notes

```bash
npm run release:prep
```

This will:
- generate `src/build-info.json`
- run tests
- package `mcp-writing-vscode-<version>.vsix`
- generate `release/v<version>.md`

## 3. Commit and tag

```bash
git add package.json package-lock.json src/extension.js test/extension.test.cjs README.md .gitignore scripts/ release/ RELEASING.md
# plus any other intended release changes
git commit -m "chore(release): cut v<version>"
git tag v<version>
git push origin <branch>
git push origin v<version>
```

## 4. Create GitHub release

```bash
gh release create v<version> mcp-writing-vscode-<version>.vsix --title "v<version>" --notes-file release/v<version>.md
```

## 5. Install/update locally

In VS Code:
- `Extensions: Install from VSIX...`
- choose `mcp-writing-vscode-<version>.vsix`

## Notes

- `src/build-info.json` is generated and ignored; it is included in the VSIX artifact.
- Use `MCP Writing: Show Version Info` to verify extension version vs build commit.
