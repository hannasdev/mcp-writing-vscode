const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let warningImpl = async () => null;
let errorImpl = async () => null;
let executeCommandImpl = async () => undefined;

Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        showQuickPick: async () => null,
        showInputBox: async () => null,
        showInformationMessage: async () => null,
        showWarningMessage: async (...args) => warningImpl(...args),
        showErrorMessage: async (...args) => errorImpl(...args),
      },
      workspace: {
        getConfiguration: () => ({ get: (_k, d) => d }),
      },
      commands: {
        registerCommand: () => ({ dispose() {} }),
        executeCommand: async (...args) => executeCommandImpl(...args),
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const extension = require('../src/extension.js');
const {
  parseToolText,
  isExistingStyleguideConfigError,
  EXISTING_STYLEGUIDE_MESSAGE,
  EXISTING_STYLEGUIDE_TITLE,
  EXISTING_STYLEGUIDE_FALLBACK,
  EDIT_EXISTING_STYLEGUIDE_ACTION,
  CANCEL_ACTION,
  getExistingStyleguideUiState,
  handleExistingStyleguideDuringSetup,
} = extension.__test;

test.beforeEach(() => {
  warningImpl = async () => null;
  errorImpl = async () => null;
  executeCommandImpl = async () => undefined;
});

test.after(() => {
  Module._load = originalLoad;
});

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

test('STYLEGUIDE_CONFIG_EXISTS maps to dedicated existing-config UI state', () => {
  const state = getExistingStyleguideUiState({ error: { code: 'STYLEGUIDE_CONFIG_EXISTS' } });
  assert.deepEqual(state, {
    title: EXISTING_STYLEGUIDE_TITLE,
    body: EXISTING_STYLEGUIDE_MESSAGE,
    primaryAction: EDIT_EXISTING_STYLEGUIDE_ACTION,
    secondaryAction: CANCEL_ACTION,
  });
});

test('setup existing-config handler shows dedicated state and routes primary action to update flow', async () => {
  let warningArgs;
  let executed;
  warningImpl = async (...args) => {
    warningArgs = args;
    return EDIT_EXISTING_STYLEGUIDE_ACTION;
  };
  executeCommandImpl = async (...args) => {
    executed = args;
  };
  errorImpl = async () => {
    throw new Error('showErrorMessage should not be called on successful routing');
  };

  const handled = await handleExistingStyleguideDuringSetup({ error: { code: 'STYLEGUIDE_CONFIG_EXISTS' } });
  assert.equal(handled, true);
  assert.ok(warningArgs[0].includes(EXISTING_STYLEGUIDE_TITLE));
  assert.ok(warningArgs[0].includes(EXISTING_STYLEGUIDE_MESSAGE));
  assert.equal(warningArgs[2], EDIT_EXISTING_STYLEGUIDE_ACTION);
  assert.equal(warningArgs[3], CANCEL_ACTION);
  assert.deepEqual(executed, ['mcpWriting.updateProseStyleguide']);
});

test('setup existing-config handler shows fallback guidance when update flow cannot open', async () => {
  let fallbackMessage = '';
  warningImpl = async () => EDIT_EXISTING_STYLEGUIDE_ACTION;
  executeCommandImpl = async () => {
    throw new Error('command failed');
  };
  errorImpl = async (msg) => {
    fallbackMessage = msg;
  };

  const handled = await handleExistingStyleguideDuringSetup({ error: { code: 'STYLEGUIDE_CONFIG_EXISTS' } });
  assert.equal(handled, true);
  assert.ok(fallbackMessage.startsWith(EXISTING_STYLEGUIDE_FALLBACK));
  assert.ok(fallbackMessage.includes('command failed'));
});
