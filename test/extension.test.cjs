const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        showQuickPick: async () => null,
        showInputBox: async () => null,
        showInformationMessage: async () => null,
        showWarningMessage: async () => null,
        showErrorMessage: async () => null,
      },
      workspace: {
        getConfiguration: () => ({ get: (_k, d) => d }),
      },
      commands: {
        registerCommand: () => ({ dispose() {} }),
        executeCommand: async () => undefined,
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const extension = require('../src/extension.js');
const { parseToolText, isExistingStyleguideConfigError, EXISTING_STYLEGUIDE_MESSAGE } = extension.__test;

test('parseToolText parses JSON content', () => {
  const parsed = parseToolText({ content: [{ text: '{"ok":true,"value":1}' }] });
  assert.deepEqual(parsed.parsed, { ok: true, value: 1 });
});

test('parseToolText preserves raw text when payload is not JSON', () => {
  const parsed = parseToolText({ content: [{ text: 'not-json' }] });
  assert.equal(parsed.parsed, null);
  assert.equal(parsed.rawText, 'not-json');
});

test('isExistingStyleguideConfigError matches STYLEGUIDE_CONFIG_EXISTS only', () => {
  assert.equal(isExistingStyleguideConfigError({ error: { code: 'STYLEGUIDE_CONFIG_EXISTS' } }), true);
  assert.equal(isExistingStyleguideConfigError({ error: { code: 'OTHER' } }), false);
  assert.equal(isExistingStyleguideConfigError(null), false);
});

test('existing config message is the approved user-facing copy', () => {
  assert.equal(EXISTING_STYLEGUIDE_MESSAGE, 'A prose styleguide config already exists for this project.');
});
