const vscode = require("vscode");
const packageJson = require("../package.json");
let buildInfo = null;
try {
  buildInfo = require("./build-info.json");
} catch {
  buildInfo = null;
}

class McpSseClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sseResponse = null;
    this.reader = null;
    this.endpointUrl = null;
    this.requestId = 0;
    this.pending = new Map();
    this.readLoopPromise = null;
  }

  nextId() {
    this.requestId += 1;
    return this.requestId;
  }

  async connect() {
    try {
      this.sseResponse = await fetch(`${this.baseUrl}/sse`);
    } catch (error) {
      throw new Error(`Could not reach MCP server at ${this.baseUrl}. Start mcp-writing and verify mcpWriting.serverUrl. (${error instanceof Error ? error.message : String(error)})`);
    }

    if (!this.sseResponse.ok || !this.sseResponse.body) {
      throw new Error(`Failed to connect to MCP SSE endpoint at ${this.baseUrl}/sse (${this.sseResponse.status}).`);
    }

    this.reader = this.sseResponse.body.getReader();
    this.readLoopPromise = this.readLoop();
    this.endpointUrl = await this.waitForEndpoint();

    await this.initialize();
  }

  async waitForEndpoint(timeoutMs = 15000) {
    const start = Date.now();
    while (!this.endpointUrl) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("Timed out waiting for MCP message endpoint.");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.endpointUrl;
  }

  async readLoop() {
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await this.reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        this.handleSseChunk(chunk);
      }
    }
  }

  handleSseChunk(chunk) {
    const lines = chunk.split(/\r?\n/);
    let event = "message";
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    const data = dataLines.join("\n");
    if (!data) return;

    if (event === "endpoint") {
      this.endpointUrl = data.startsWith("http") ? data : `${this.baseUrl}${data}`;
      return;
    }

    try {
      const message = JSON.parse(data);
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "MCP request failed."));
        else resolve(message.result);
      }
    } catch {
      // Ignore non-JSON messages.
    }
  }

  async postMessage(payload) {
    if (!this.endpointUrl) {
      throw new Error("MCP endpoint is not initialized.");
    }
    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`MCP POST failed (${response.status}).`);
    }
  }

  async sendRequest(method, params) {
    const id = this.nextId();
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const resultPromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    await this.postMessage(request);
    return resultPromise;
  }

  async sendNotification(method, params) {
    const request = {
      jsonrpc: "2.0",
      method,
      params,
    };
    await this.postMessage(request);
  }

  async initialize() {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "mcp-writing-vscode",
        version: "0.0.1",
      },
    });
    await this.sendNotification("notifications/initialized", {});
  }

  async callTool(name, args = {}) {
    return this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
  }

  async close() {
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      this.sseResponse?.body?.cancel();
    } catch {}
  }
}

const EXISTING_STYLEGUIDE_MESSAGE = "A prose styleguide config already exists at the target location.";
const EXISTING_STYLEGUIDE_TITLE = "Styleguide already set up";
const EXISTING_STYLEGUIDE_FALLBACK = "Couldn't open styleguide editor. Try the styleguide update command from Command Palette.";
const EDIT_EXISTING_STYLEGUIDE_ACTION = "Edit existing styleguide";
const CANCEL_ACTION = "Cancel";

function isExistingStyleguideConfigError(payload) {
  return payload?.error?.code === "STYLEGUIDE_CONFIG_EXISTS";
}

function getExistingStyleguideUiState(payload) {
  if (!isExistingStyleguideConfigError(payload)) return null;
  return {
    title: EXISTING_STYLEGUIDE_TITLE,
    body: EXISTING_STYLEGUIDE_MESSAGE,
    primaryAction: EDIT_EXISTING_STYLEGUIDE_ACTION,
    secondaryAction: CANCEL_ACTION,
  };
}

async function handleExistingStyleguideDuringSetup(payload) {
  const state = getExistingStyleguideUiState(payload);
  if (!state) return false;

  const choice = await vscode.window.showWarningMessage(
    `${state.title}\n\n${state.body}`,
    { modal: true },
    state.primaryAction,
    state.secondaryAction
  );

  if (choice === state.primaryAction) {
    try {
      await vscode.commands.executeCommand("mcpWriting.updateProseStyleguide");
    } catch {
      await vscode.window.showErrorMessage(EXISTING_STYLEGUIDE_FALLBACK);
    }
  }

  return true;
}

function parseToolText(result) {
  const first = result?.content?.[0]?.text;
  if (!first) return { parsed: null, rawText: "" };
  try {
    return { parsed: JSON.parse(first), rawText: first };
  } catch {
    return { parsed: null, rawText: first };
  }
}

function formatVersionInfoMessage() {
  const extensionVersion = packageJson.version ?? "unknown";
  const buildSha = buildInfo?.git_sha ?? "unknown";
  const buildBranch = buildInfo?.git_branch ?? "unknown";
  const buildTime = buildInfo?.build_time_utc ?? "unknown";
  const repoDirty = typeof buildInfo?.repo_dirty === "boolean" ? String(buildInfo.repo_dirty) : "unknown";
  return [
    `MCP Writing VS Code`,
    `Extension version: ${extensionVersion}`,
    `Build commit: ${buildSha}`,
    `Build branch: ${buildBranch}`,
    `Build time (UTC): ${buildTime}`,
    `Build repo_dirty: ${repoDirty}`,
  ].join("\n");
}

function getServerUrl() {
  const config = vscode.workspace.getConfiguration("mcpWriting");
  return config.get("serverUrl", "http://localhost:3000");
}

async function pickScope() {
  return vscode.window.showQuickPick(
    [
      { label: "Project root", value: "project_root" },
      { label: "Sync root", value: "sync_root" },
    ],
    { title: "Styleguide scope" }
  );
}

async function pickLanguage(languages) {
  return vscode.window.showQuickPick(
    languages.map((lang) => ({ label: lang, value: lang })),
    { title: "Primary language" }
  );
}

async function pickProjectIdForBootstrap(client, defaultProjectId) {
  const discoverResult = await client.callTool("find_scenes", { page_size: 200, page: 1 });
  const discoverEnvelope = parseToolText(discoverResult);
  const discoverPayload = discoverEnvelope.parsed;
  const results = Array.isArray(discoverPayload?.results) ? discoverPayload.results : [];
  const ids = [...new Set(results.map((row) => row?.project_id).filter((v) => typeof v === "string" && v.trim().length > 0))];

  if (ids.length > 0) {
    const sortedIds = ids.sort((a, b) => a.localeCompare(b));
    const picked = await vscode.window.showQuickPick(
      sortedIds.map((id) => ({ label: id, value: id })),
      {
        title: "Project ID for bootstrap",
        placeHolder: "Choose which project to analyze scene conventions from",
      }
    );
    if (picked?.value) return picked.value;
  }

  const input = await vscode.window.showInputBox({
    title: "Project ID for bootstrap",
    prompt: "Could not auto-discover project IDs. Enter project_id for bootstrap analysis.",
    value: defaultProjectId ?? "",
    ignoreFocusOut: true,
  });
  return input?.trim() || "";
}

async function pickProjectIdForConfig(client, defaultProjectId) {
  const discoverResult = await client.callTool("find_scenes", { page_size: 200, page: 1 });
  const discoverEnvelope = parseToolText(discoverResult);
  const discoverPayload = discoverEnvelope.parsed;
  const results = Array.isArray(discoverPayload?.results) ? discoverPayload.results : [];
  const ids = [...new Set(results.map((row) => row?.project_id).filter((v) => typeof v === "string" && v.trim().length > 0))];

  if (ids.length > 0) {
    const sortedIds = ids.sort((a, b) => a.localeCompare(b));
    const picked = await vscode.window.showQuickPick(
      sortedIds.map((id) => ({ label: id, value: id })),
      {
        title: "Project ID",
        placeHolder: "Choose where project-root styleguide config should be written",
      }
    );
    if (picked?.value) return picked.value;
  }

  const input = await vscode.window.showInputBox({
    title: "Project ID",
    prompt: "Enter project_id for project-root styleguide config.",
    value: defaultProjectId ?? "",
    ignoreFocusOut: true,
  });
  return input?.trim() || "";
}

async function testServerConnection() {
  const serverUrl = getServerUrl();
  const client = new McpSseClient(serverUrl);

  try {
    await client.connect();
    const workflowResult = await client.callTool("describe_workflows", {});
    const workflowEnvelope = parseToolText(workflowResult);
    const workflowPayload = workflowEnvelope.parsed;
    if (!workflowPayload?.ok) {
      throw new Error(`Connected, but describe_workflows did not return ok. Raw response: ${workflowEnvelope.rawText || "<empty>"}`);
    }
    vscode.window.showInformationMessage(`MCP Writing server connection successful (${serverUrl}).`);
  } finally {
    await client.close();
  }
}

async function runStyleguideUpdateFlow() {
  const serverUrl = getServerUrl();
  const client = new McpSseClient(serverUrl);

  try {
    await client.connect();

    const scopePick = await pickScope();
    if (!scopePick) return;

    let projectId = "";
    if (scopePick.value === "project_root") {
      const workflowResult = await client.callTool("describe_workflows", {});
      const workflowEnvelope = parseToolText(workflowResult);
      const workflowPayload = workflowEnvelope.parsed;
      projectId = workflowPayload?.context?.project_id ?? "";

      const input = await pickProjectIdForConfig(client, projectId);
      if (!input) return;
      projectId = input;
      if (!projectId) {
        throw new Error("project_id is required for project_root scope.");
      }
    }

    const updatesText = await vscode.window.showInputBox({
      title: "Styleguide updates (JSON)",
      prompt: "Enter JSON updates for update_prose_styleguide_config (example: {\"voice_notes\":\"Tighter POV, lighter adverbs\"})",
      value: "{}",
      ignoreFocusOut: true,
    });
    if (!updatesText) return;

    let updates;
    try {
      updates = JSON.parse(updatesText);
    } catch {
      throw new Error("Invalid JSON for styleguide updates.");
    }

    const previewArgs = {
      scope: scopePick.value,
      ...(scopePick.value === "project_root" ? { project_id: projectId } : {}),
      updates,
    };

    const previewResult = await client.callTool("preview_prose_styleguide_config_update", previewArgs);
    const previewEnvelope = parseToolText(previewResult);
    const previewPayload = previewEnvelope.parsed;
    if (!previewPayload?.ok) {
      throw new Error(`Update preview failed: ${previewPayload?.error?.message ?? previewEnvelope.rawText ?? "unknown error"}`);
    }

    const changedFields = Array.isArray(previewPayload.changed_fields) ? previewPayload.changed_fields.join(", ") : "";
    const confirm = await vscode.window.showInformationMessage(
      changedFields ? `Apply styleguide updates? Changed fields: ${changedFields}` : "Apply styleguide updates?",
      { modal: true },
      "Apply updates",
      "Cancel"
    );
    if (confirm !== "Apply updates") return;

    const updateResult = await client.callTool("update_prose_styleguide_config", previewArgs);
    const updateEnvelope = parseToolText(updateResult);
    const updatePayload = updateEnvelope.parsed;
    if (!updatePayload?.ok) {
      throw new Error(`Styleguide update failed: ${updatePayload?.error?.message ?? updateEnvelope.rawText ?? "unknown error"}`);
    }

    vscode.window.showInformationMessage("MCP Writing prose styleguide updated.");
  } finally {
    await client.close();
  }
}
async function runStyleguideSetupFlow() {
  const serverUrl = getServerUrl();
  const client = new McpSseClient(serverUrl);

  try {
    await client.connect();

    const workflowResult = await client.callTool("describe_workflows", {});
    const workflowEnvelope = parseToolText(workflowResult);
    const workflowPayload = workflowEnvelope.parsed;
    if (!workflowPayload?.ok) {
      throw new Error(`describe_workflows did not return an ok payload. Raw response: ${workflowEnvelope.rawText || "<empty>"}`);
    }

    const setupContract = workflowPayload.context?.setup_contract;
    const flowPreview = setupContract?.plan_preview;
    if (!setupContract || !flowPreview) {
      throw new Error("Server did not provide setup contract metadata in describe_workflows.");
    }

    const scopePick = await pickScope();
    if (!scopePick) return;

    let projectId = workflowPayload.context?.project_id ?? "";
    if (scopePick.value === "project_root") {
      const input = await pickProjectIdForConfig(client, projectId);
      if (!input) return;
      projectId = input;
      if (!projectId) {
        throw new Error("project_id is required for project_root scope.");
      }
    }

    const languages = [
      "english_us", "english_uk", "english_au", "english_ca", "swedish", "norwegian", "danish", "finnish",
      "french", "italian", "russian", "portuguese_pt", "portuguese_br", "german", "dutch", "polish",
      "czech", "hungarian", "spanish", "irish", "japanese", "korean", "chinese_traditional", "chinese_simplified",
    ];
    const languagePick = await pickLanguage(languages);
    if (!languagePick) return;

    const shouldBootstrap = await vscode.window.showQuickPick(
      [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
      { title: "Bootstrap from scenes first?" }
    );
    if (!shouldBootstrap) return;

    const voiceNotes = await vscode.window.showInputBox({
      title: "Voice notes (optional)",
      prompt: "Optional freeform voice notes",
      ignoreFocusOut: true,
    });

    const previewActions = flowPreview.actions.map((action) => action.tool).join(" -> ");
    const confirmed = await vscode.window.showInformationMessage(
      `Run setup flow now? Planned default actions: ${previewActions}`,
      { modal: true },
      "Run setup"
    );
    if (confirmed !== "Run setup") return;

    const setupArgs = {
      scope: scopePick.value,
      language: languagePick.value,
      ...(scopePick.value === "project_root" ? { project_id: projectId } : {}),
      ...(voiceNotes?.trim() ? { voice_notes: voiceNotes.trim() } : {}),
      overwrite: false,
    };

    if (shouldBootstrap.value) {
      let bootstrapProjectId = projectId;
      if (!bootstrapProjectId) {
        const bootstrapInput = await pickProjectIdForBootstrap(client, workflowPayload.context?.project_id);
        if (!bootstrapInput) {
          const skipBootstrap = await vscode.window.showWarningMessage(
            "No project_id provided for bootstrap. Continue without bootstrap?",
            { modal: true },
            "Continue without bootstrap",
            "Cancel"
          );
          if (skipBootstrap !== "Continue without bootstrap") {
            return;
          }
        } else {
          bootstrapProjectId = bootstrapInput.trim();
        }
      }

      if (bootstrapProjectId) {
      const bootstrapArgs = {
        project_id: bootstrapProjectId,
        max_scenes: Math.max(1, workflowPayload.context?.scene_count ?? 1),
      };
      const bootstrapResult = await client.callTool("bootstrap_prose_styleguide_config", bootstrapArgs);
      const bootstrapEnvelope = parseToolText(bootstrapResult);
      const bootstrapPayload = bootstrapEnvelope.parsed;
      if (!bootstrapPayload?.ok) {
        const details = bootstrapPayload?.error?.message
          ?? bootstrapEnvelope.rawText
          ?? "unknown error";
        const proceed = await vscode.window.showWarningMessage(
          `Bootstrap failed. Continue with setup anyway? Details: ${details}`,
          { modal: true },
          "Continue",
          "Cancel"
        );
        if (proceed !== "Continue") {
          throw new Error(`Bootstrap failed: ${details}`);
        }
      }
      }
    }

    const setupResult = await client.callTool("setup_prose_styleguide_config", setupArgs);
    const setupEnvelope = parseToolText(setupResult);
    const setupPayload = setupEnvelope.parsed;
    if (!setupPayload?.ok) {
      if (await handleExistingStyleguideDuringSetup(setupPayload)) {
        return;
      }
      throw new Error(`Config setup failed: ${setupPayload?.error?.message ?? setupEnvelope.rawText ?? "unknown error"}`);
    }

    if (scopePick.value === "sync_root") {
      const skillResult = await client.callTool("setup_prose_styleguide_skill", { overwrite: false });
      const skillEnvelope = parseToolText(skillResult);
      const skillPayload = skillEnvelope.parsed;
      if (!skillPayload?.ok) {
        throw new Error(`Skill setup failed: ${skillPayload?.error?.message ?? skillEnvelope.rawText ?? "unknown error"}`);
      }
    }

    vscode.window.showInformationMessage("MCP Writing prose styleguide setup completed.");
  } finally {
    await client.close();
  }
}

function activate(context) {
  const setupDisposable = vscode.commands.registerCommand("mcpWriting.setupProseStyleguide", async () => {
    try {
      await runStyleguideSetupFlow();
    } catch (error) {
      vscode.window.showErrorMessage(`MCP Writing setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const updateDisposable = vscode.commands.registerCommand("mcpWriting.updateProseStyleguide", async () => {
    try {
      await runStyleguideUpdateFlow();
    } catch (error) {
      vscode.window.showErrorMessage(`MCP Writing styleguide update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const showVersionInfoDisposable = vscode.commands.registerCommand("mcpWriting.showVersionInfo", async () => {
    vscode.window.showInformationMessage(formatVersionInfoMessage());
  });

  const testConnectionDisposable = vscode.commands.registerCommand("mcpWriting.testServerConnection", async () => {
    try {
      await testServerConnection();
    } catch (error) {
      vscode.window.showErrorMessage(`MCP Writing connection test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  context.subscriptions.push(setupDisposable, updateDisposable, testConnectionDisposable, showVersionInfoDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  __test: {
    parseToolText,
    isExistingStyleguideConfigError,
    EXISTING_STYLEGUIDE_MESSAGE,
    EXISTING_STYLEGUIDE_TITLE,
    EXISTING_STYLEGUIDE_FALLBACK,
    EDIT_EXISTING_STYLEGUIDE_ACTION,
    CANCEL_ACTION,
    getExistingStyleguideUiState,
    handleExistingStyleguideDuringSetup,
    formatVersionInfoMessage,
  },
};
