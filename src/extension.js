const vscode = require("vscode");

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
    this.sseResponse = await fetch(`${this.baseUrl}/sse`);
    if (!this.sseResponse.ok || !this.sseResponse.body) {
      throw new Error(`Failed to connect to MCP SSE endpoint (${this.sseResponse.status}).`);
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

function parseToolText(result) {
  const first = result?.content?.[0]?.text;
  if (!first) return null;
  try {
    return JSON.parse(first);
  } catch {
    return null;
  }
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

async function runStyleguideSetupFlow() {
  const config = vscode.workspace.getConfiguration("mcpWriting");
  const serverUrl = config.get("serverUrl", "http://localhost:3000");
  const client = new McpSseClient(serverUrl);

  try {
    await client.connect();

    const workflowResult = await client.callTool("describe_workflows", {});
    const workflowPayload = parseToolText(workflowResult);
    if (!workflowPayload?.ok) {
      throw new Error("describe_workflows did not return an ok payload.");
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
      const input = await vscode.window.showInputBox({
        title: "Project ID",
        prompt: "Enter project_id for project-root styleguide config.",
        value: projectId,
        ignoreFocusOut: true,
      });
      if (!input) return;
      projectId = input.trim();
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
      const bootstrapArgs = {
        ...(scopePick.value === "project_root" ? { project_id: projectId } : {}),
        max_scenes: Math.max(1, workflowPayload.context?.scene_count ?? 1),
      };
      const bootstrapResult = await client.callTool("bootstrap_prose_styleguide_config", bootstrapArgs);
      const bootstrapPayload = parseToolText(bootstrapResult);
      if (!bootstrapPayload?.ok) {
        throw new Error(`Bootstrap failed: ${bootstrapPayload?.error?.message ?? "unknown error"}`);
      }
    }

    const setupResult = await client.callTool("setup_prose_styleguide_config", setupArgs);
    const setupPayload = parseToolText(setupResult);
    if (!setupPayload?.ok) {
      throw new Error(`Config setup failed: ${setupPayload?.error?.message ?? "unknown error"}`);
    }

    if (scopePick.value === "sync_root") {
      const skillResult = await client.callTool("setup_prose_styleguide_skill", { overwrite: false });
      const skillPayload = parseToolText(skillResult);
      if (!skillPayload?.ok) {
        throw new Error(`Skill setup failed: ${skillPayload?.error?.message ?? "unknown error"}`);
      }
    }

    vscode.window.showInformationMessage("MCP Writing prose styleguide setup completed.");
  } finally {
    await client.close();
  }
}

function activate(context) {
  const disposable = vscode.commands.registerCommand("mcpWriting.setupProseStyleguide", async () => {
    try {
      await runStyleguideSetupFlow();
    } catch (error) {
      vscode.window.showErrorMessage(`MCP Writing setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
