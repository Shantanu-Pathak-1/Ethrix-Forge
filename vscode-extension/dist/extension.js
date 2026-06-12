"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  checkBackendAlive: () => checkBackendAlive,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
var cp2 = __toESM(require("child_process"));

// src/chatWebview.ts
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var cp = __toESM(require("child_process"));
var http = __toESM(require("http"));
var https = __toESM(require("https"));
function postJson(urlStr, body, customHeaders) {
  return new Promise((resolve2, reject) => {
    try {
      const url = new URL(urlStr);
      const bodyStr = JSON.stringify(body);
      const isHttps = url.protocol === "https:";
      const requestLib = isHttps ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...customHeaders
        },
        timeout: 9e4
        // 90 seconds (local LLMs can be slow to initialize)
      };
      const req = requestLib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve2(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse JSON response: ${e}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on("error", (err) => {
        reject(err);
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out after 90 seconds"));
      });
      req.write(bodyStr);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
var EthrixChatProvider = class {
  constructor(_extensionUri, _context) {
    this._extensionUri = _extensionUri;
    this._context = _context;
  }
  _view;
  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "sendMessage":
          await this.handleChatSubmit(message.text, message.history);
          break;
        case "getSettings":
          this.sendSettingsToWebview();
          break;
        case "updateSettings":
          await this.updateExtensionSettings(message.settings);
          break;
        case "checkStatus":
          await this.checkServerStatus();
          break;
        case "quickAction":
          await this.handleQuickAction(message.action);
          break;
        case "startBackend":
          await vscode.commands.executeCommand("ethrix-forge.startBackend");
          await this.checkServerStatus();
          break;
        case "getOllamaModels":
          await this.sendOllamaModelsToWebview();
          break;
        case "startOllama":
          try {
            const ollamaProc = cp.spawn("ollama", ["serve"], {
              shell: true,
              env: { ...process.env }
            });
            ollamaProc.stdout?.on("data", (d) => console.log(`[Ollama stdout] ${d}`));
            ollamaProc.stderr?.on("data", (d) => console.error(`[Ollama stderr] ${d}`));
            ollamaProc.unref();
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to start Ollama: ${e}`);
          }
          break;
      }
    });
    this.checkServerStatus();
    const interval = setInterval(() => {
      if (this._view && this._view.visible) {
        this.checkServerStatus();
      }
    }, 5e3);
    webviewView.onDidDispose(() => {
      clearInterval(interval);
    });
    this.sendSettingsToWebview();
  }
  /**
   * Updates settings in Webview when configurations change.
   */
  updateSettings() {
    this.sendSettingsToWebview();
  }
  sendSettingsToWebview() {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration("ethrix");
    const settings = {
      backendUrl: config.get("backendUrl", "http://127.0.0.1:8000"),
      provider: config.get("provider", "online"),
      model: config.get("model", "llama-3.3-70b-versatile"),
      groqApiKey: config.get("groqApiKey", "")
    };
    this._view.webview.postMessage({ command: "settings", data: settings });
  }
  async updateExtensionSettings(newSettings) {
    const config = vscode.workspace.getConfiguration("ethrix");
    if (newSettings.backendUrl !== void 0) {
      await config.update("backendUrl", newSettings.backendUrl, vscode.ConfigurationTarget.Global);
    }
    if (newSettings.provider !== void 0) {
      await config.update("provider", newSettings.provider, vscode.ConfigurationTarget.Global);
    }
    if (newSettings.model !== void 0) {
      await config.update("model", newSettings.model, vscode.ConfigurationTarget.Global);
    }
    if (newSettings.groqApiKey !== void 0) {
      await config.update("groqApiKey", newSettings.groqApiKey, vscode.ConfigurationTarget.Global);
    }
    this.sendSettingsToWebview();
  }
  async checkServerStatus() {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration("ethrix");
    const backendUrl = config.get("backendUrl", "http://127.0.0.1:8000");
    const alive = await checkBackendAlive(backendUrl);
    this._view.webview.postMessage({ command: "status", alive });
  }
  async handleQuickAction(action) {
    switch (action) {
      case "analyze":
        await vscode.commands.executeCommand("ethrix-forge.analyzeCode");
        break;
      case "fix":
        await vscode.commands.executeCommand("ethrix-forge.fixCode");
        break;
      case "docgen":
        await vscode.commands.executeCommand("ethrix-forge.docgenCode");
        break;
    }
  }
  async handleChatSubmit(text, history) {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration("ethrix");
    const backendUrl = config.get("backendUrl", "http://127.0.0.1:8000");
    const provider = config.get("provider", "online");
    const model = config.get("model", "llama-3.3-70b-versatile");
    const groqApiKey = config.get("groqApiKey", "");
    const formattedHistory = history.map((h) => ({
      role: h.role === "ai" ? "model" : "user",
      text: h.text
    }));
    const folders = vscode.workspace.workspaceFolders;
    const workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : void 0;
    let workspaceFiles = "";
    if (workspaceRoot) {
      try {
        const files = fs.readdirSync(workspaceRoot);
        const fileList = files.filter((f) => !f.startsWith(".") && f !== "node_modules" && f !== "venv" && f !== ".venv" && f !== "__pycache__" && f !== "dist" && f !== "out").slice(0, 35).map((f) => {
          try {
            const stat = fs.statSync(path.join(workspaceRoot, f));
            return `- ${f} [${stat.isDirectory() ? "Dir" : "File"}]`;
          } catch {
            return `- ${f} [File]`;
          }
        }).join("\n");
        workspaceFiles = `- Top-level Files/Folders in Workspace:
${fileList}
`;
      } catch (e) {
      }
    }
    let workspaceContext = "";
    if (workspaceRoot) {
      workspaceContext = `[Workspace Context]
- Active Workspace Root: ${workspaceRoot}
` + workspaceFiles + `- Note: When using filesystem tools like 'read_file', 'write_file', or 'list_directory', you MUST resolve them relative to the active workspace root: ${workspaceRoot} using absolute paths.
`;
    } else {
      workspaceContext = `[Workspace Context]
- No workspace folder is open.
`;
    }
    const reportFileName = config.get("reportFileName", "ethrix_report.md");
    let editor = vscode.window.activeTextEditor;
    if (!editor || path.basename(editor.document.fileName) === reportFileName) {
      const nonReportEditor = vscode.window.visibleTextEditors.find(
        (e) => path.basename(e.document.fileName) !== reportFileName
      );
      if (nonReportEditor) {
        editor = nonReportEditor;
      }
    }
    let activeFileContext = "";
    if (editor) {
      const filePath = editor.document.fileName;
      const fileContent = editor.document.getText();
      const selectionText = editor.document.getText(editor.selection);
      activeFileContext = `[Active File Context]
- Active File Path: ${filePath}
- Active File Name: ${path.basename(filePath)}
- Language: ${editor.document.languageId}
`;
      if (selectionText && selectionText.trim()) {
        activeFileContext += `- Active Selected Text:
\`\`\`
${selectionText}
\`\`\`
`;
      } else {
        const lines = fileContent.split("\n");
        const truncatedContent = lines.slice(0, 150).join("\n");
        const hasMore = lines.length > 150 ? "\n... [Truncated, total lines: " + lines.length + "] ..." : "";
        activeFileContext += `- Active File Content:
\`\`\`
${truncatedContent}${hasMore}
\`\`\`
`;
      }
    } else {
      activeFileContext = `[Active File Context]
- No active editor or file open.
`;
    }
    const fullMessage = `${workspaceContext}
${activeFileContext}
[User Message]
${text}`;
    try {
      const headers = {};
      if (groqApiKey) {
        headers["X-Groq-API-Key"] = groqApiKey;
      }
      const data = await postJson(`${backendUrl}/chat`, {
        message: fullMessage,
        history: formattedHistory,
        provider,
        model
      }, headers);
      this._view.webview.postMessage({
        command: "response",
        success: true,
        reply: data.reply
      });
    } catch (err) {
      this._view.webview.postMessage({
        command: "response",
        success: false,
        error: err.message || err
      });
    }
  }
  async sendOllamaModelsToWebview() {
    if (!this._view) {
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2e3) });
      if (response.ok) {
        const data = await response.json();
        const models = (data.models || []).map((m) => m.name);
        this._view.webview.postMessage({ command: "ollamaModels", success: true, models });
        return;
      }
    } catch (e) {
    }
    this._view.webview.postMessage({ command: "ollamaModels", success: false, models: [] });
  }
  getHtmlForWebview(webview) {
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "resources", "logo.png"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ethrix AI Chat</title>
    <!-- Marked JS for parsing markdown -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <!-- Prism CSS & JS for code blocks -->
    <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
    <style>
        :root {
            --bg-color: #0b0f19;
            --card-bg: rgba(17, 24, 39, 0.7);
            --card-border: rgba(124, 58, 237, 0.2);
            --accent-cyan: #22d3ee;
            --accent-purple: #8b5cf6;
            --text-color: #f8fafc;
            --text-muted: #94a3b8;
            --input-bg: #111827;
            --glow-color: rgba(34, 211, 238, 0.15);
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 10px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
            overflow: hidden;
        }

        /* Scrollbar styles */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(124, 58, 237, 0.3);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(34, 211, 238, 0.5);
        }

        /* Header block */
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--card-border);
            margin-bottom: 10px;
            flex-shrink: 0;
        }

        .title {
            font-size: 16px;
            font-weight: 800;
            background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.02em;
        }

        .header-logo-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .header-logo {
            width: 22px;
            height: 22px;
            object-fit: contain;
            filter: drop-shadow(0 0 4px var(--accent-cyan));
        }

        .status-pill {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 12px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.25);
            color: #ef4444;
            cursor: pointer;
        }

        .status-pill.online {
            background: rgba(34, 211, 238, 0.1);
            border: 1px solid rgba(34, 211, 238, 0.25);
            color: var(--accent-cyan);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: #ef4444;
            display: inline-block;
        }

        .online .status-dot {
            background-color: var(--accent-cyan);
            box-shadow: 0 0 8px var(--accent-cyan);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.9); opacity: 0.6; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.9); opacity: 0.6; }
        }

        /* Settings Gear & Collapsible Panel */
        .settings-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            border-radius: 4px;
        }

        .settings-btn:hover {
            color: var(--accent-cyan);
            background: rgba(255, 255, 255, 0.05);
        }

        .settings-panel {
            display: none;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 10px;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .settings-group {
            margin-bottom: 8px;
        }

        .settings-group:last-child {
            margin-bottom: 0;
        }

        .settings-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 4px;
            display: block;
        }

        .settings-input, select {
            width: 100%;
            background-color: var(--input-bg);
            border: 1px solid var(--card-border);
            color: var(--text-color);
            padding: 6px;
            border-radius: 4px;
            font-size: 12px;
            box-sizing: border-box;
        }

        .settings-input:focus, select:focus {
            outline: none;
            border-color: var(--accent-cyan);
            box-shadow: 0 0 6px var(--glow-color);
        }

        /* Chat Threads */
        .chat-container {
            flex-grow: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding-right: 4px;
            margin-bottom: 10px;
        }

        .message {
            max-width: 85%;
            padding: 10px;
            border-radius: 12px;
            font-size: 13px;
            line-height: 1.5;
            position: relative;
        }

        .message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(124, 58, 237, 0.25));
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-bottom-right-radius: 2px;
            color: var(--text-color);
        }

        .message.ai {
            align-self: flex-start;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-bottom-left-radius: 2px;
            color: var(--text-color);
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }

        .message.ai p {
            margin: 0 0 8px 0;
        }

        .message.ai p:last-child {
            margin-bottom: 0;
        }

        .message.ai ul, .message.ai ol {
            margin: 0 0 8px 0;
            padding-left: 20px;
        }

        /* Glassmorphic code blocks */
        .message pre {
            background-color: #1e293b !important;
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 6px;
            padding: 8px;
            overflow-x: auto;
            margin: 6px 0;
        }

        .message code {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            color: #fb7185;
            background: rgba(255, 255, 255, 0.05);
            padding: 1px 3px;
            border-radius: 3px;
        }

        .message pre code {
            color: inherit;
            background: none;
            padding: 0;
            border-radius: 0;
        }

        /* Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex-grow: 1;
            text-align: center;
            padding: 20px;
            color: var(--text-muted);
        }

        .empty-icon {
            font-size: 32px;
            margin-bottom: 12px;
            color: var(--accent-cyan);
            filter: drop-shadow(0 0 8px var(--glow-color));
        }

        .empty-logo {
            width: 60px;
            height: 60px;
            object-fit: contain;
            margin-bottom: 12px;
            filter: drop-shadow(0 0 10px rgba(34, 211, 238, 0.4));
            animation: floatLogo 3s ease-in-out infinite;
        }

        @keyframes floatLogo {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-5px); }
            100% { transform: translateY(0px); }
        }

        .empty-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-color);
            margin-bottom: 6px;
        }

        .empty-desc {
            font-size: 12px;
            margin-bottom: 16px;
        }

        .quick-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
            max-width: 200px;
        }

        .action-btn {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--card-border);
            color: var(--text-color);
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .action-btn:hover {
            background: linear-gradient(135deg, rgba(34, 211, 238, 0.1), rgba(124, 58, 237, 0.1));
            border-color: var(--accent-cyan);
            transform: translateY(-1px);
            box-shadow: 0 4px 10px rgba(34, 211, 238, 0.08);
        }

        /* Input Block */
        .input-container {
            display: flex;
            gap: 8px;
            border-top: 1px solid var(--card-border);
            padding-top: 10px;
            flex-shrink: 0;
        }

        textarea {
            flex-grow: 1;
            background-color: var(--input-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            color: var(--text-color);
            padding: 8px 10px;
            font-size: 13px;
            resize: none;
            height: 38px;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }

        textarea:focus {
            outline: none;
            border-color: var(--accent-cyan);
            box-shadow: 0 0 8px var(--glow-color);
        }

        .send-btn {
            background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan));
            border: none;
            border-radius: 8px;
            color: white;
            cursor: pointer;
            width: 38px;
            height: 38px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .send-btn:hover {
            opacity: 0.95;
            transform: scale(1.03);
            box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
        }

        .send-btn:disabled {
            background: #475569;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .typing-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 8px 12px;
            border-radius: 12px;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            align-self: flex-start;
        }

        .typing-dot {
            width: 6px;
            height: 6px;
            background-color: var(--accent-cyan);
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
        }

        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1.0); }
        }
    </style>
</head>
<body>
    <header>
        <div class="header-logo-container">
            <img src="${logoUri}" alt="Ethrix Logo" class="header-logo">
            <div class="title">ETHRIX FORGE</div>
        </div>
        <div id="statusPill" class="status-pill" onclick="triggerStartBackend()">
            <span class="status-dot"></span>
            <span id="statusText">CHECKING</span>
        </div>
        <button class="settings-btn" id="toggleSettingsBtn" onclick="toggleSettings()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
            </svg>
        </button>
    </header>

    <div class="settings-panel" id="settingsPanel">
        <div class="settings-group">
            <label class="settings-label">Backend URL</label>
            <input type="text" id="settingBackendUrl" class="settings-input" onchange="saveSettings()">
        </div>
        <div class="settings-group">
            <label class="settings-label">Provider</label>
            <select id="settingProvider" onchange="handleProviderChange()">
                <option value="online">Online Cloud (Groq)</option>
                <option value="offline">Offline Local (Ollama)</option>
            </select>
        </div>
        <div class="settings-group">
            <label class="settings-label">Model</label>
            <div id="modelContainer">
                <input type="text" id="settingModel" class="settings-input" onchange="saveSettings()">
            </div>
        </div>
        <div class="settings-group" id="apiKeyGroup">
            <label class="settings-label">Groq API Key (Optional Override)</label>
            <input type="password" id="settingApiKey" class="settings-input" onchange="saveSettings()" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">
        </div>
    </div>

    <div class="chat-container" id="chatContainer">
        <!-- Empty State -->
        <div class="empty-state" id="emptyState">
            <img src="${logoUri}" alt="Ethrix Logo" class="empty-logo">
            <div class="empty-title">Ethrix AI Assistant</div>
            <div class="empty-desc">Ask me to review, explain, or optimize code. Run workspace commands directly below:</div>
            
            <div class="quick-actions">
                <button class="action-btn" onclick="triggerQuickAction('analyze')">
                    <span>\u{1F50D}</span> Analyze Active Selection
                </button>
                <button class="action-btn" onclick="triggerQuickAction('fix')">
                    <span>\u26A1</span> Optimize &amp; Fix Code
                </button>
                <button class="action-btn" onclick="triggerQuickAction('docgen')">
                    <span>\u{1F4DD}</span> Generate Documentation
                </button>
            </div>
        </div>
    </div>

    <div class="input-container">
        <textarea id="chatInput" placeholder="Type a message or paste code..." onkeydown="handleKeydown(event)"></textarea>
        <button class="send-btn" id="sendBtn" onclick="sendMessage()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z"/>
            </svg>
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let history = [];
        let isOnline = false;

        // Custom config states
        let configSettings = {
            backendUrl: 'http://127.0.0.1:8000',
            provider: 'online',
            model: 'llama-3.3-70b-versatile',
            groqApiKey: ''
        };

        // Marked js configuration for formatting
        marked.setOptions({
            gfm: true,
            breaks: true
        });

        // Initialize Webview
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'settings':
                    configSettings = message.data;
                    populateSettings();
                    break;
                case 'status':
                    updateStatus(message.alive);
                    break;
                case 'response':
                    handleResponse(message);
                    break;
                case 'ollamaModels':
                    handleOllamaModelsResponse(message.success, message.models);
                    break;
            }
        });

        // Request settings on load
        vscode.postMessage({ command: 'getSettings' });
        vscode.postMessage({ command: 'checkStatus' });

        function populateSettings() {
            document.getElementById('settingBackendUrl').value = configSettings.backendUrl;
            document.getElementById('settingProvider').value = configSettings.provider;
            document.getElementById('settingApiKey').value = configSettings.groqApiKey;
            renderModelSelector();
        }

        function renderModelSelector() {
            const provider = document.getElementById('settingProvider').value;
            const container = document.getElementById('modelContainer');
            const apiKeyGroup = document.getElementById('apiKeyGroup');
            
            if (provider === 'online') {
                apiKeyGroup.style.display = 'block';
                container.innerHTML = '<select id="settingModel" onchange="saveSettings()">' +
                    '<option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Default)</option>' +
                    '<option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>' +
                    '<option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>' +
                    '</select>';
                document.getElementById('settingModel').value = configSettings.model;
            } else {
                apiKeyGroup.style.display = 'none';
                container.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">Detecting local models...</div>';
                vscode.postMessage({ command: 'getOllamaModels' });
            }
        }

        function handleOllamaModelsResponse(success, models) {
            const provider = document.getElementById('settingProvider').value;
            if (provider !== 'offline') return;
            
            const container = document.getElementById('modelContainer');
            if (success && models && models.length > 0) {
                let optionsHtml = '';
                models.forEach(m => {
                    const isSelected = m === configSettings.model ? 'selected' : '';
                    optionsHtml += '<option value="' + m + '" ' + isSelected + '>' + m + '</option>';
                });
                container.innerHTML = '<select id="settingModel" onchange="saveSettings()">' +
                    optionsHtml +
                    '</select>';
                const currentVal = document.getElementById('settingModel').value;
                if (currentVal !== configSettings.model) {
                    configSettings.model = currentVal;
                    saveSettings();
                }
            } else {
                container.innerHTML = '<input type="text" id="settingModel" class="settings-input" onchange="saveSettings()" placeholder="e.g. llama3">' +
                    '<div style="font-size: 10px; color: #ef4444; margin-top: 4px; display: flex; align-items: center; justify-content: space-between; gap: 4px;">' +
                    '<span>Ollama offline or no models found.</span>' +
                    '<button onclick="startOllamaService()" style="font-size: 9px; padding: 2px 6px; background: var(--accent-cyan); border: none; color: black; border-radius: 3px; cursor: pointer; font-weight: bold; flex-shrink: 0;">Start Ollama</button>' +
                    '</div>';
                document.getElementById('settingModel').value = configSettings.model || 'llama3';
            }
        }

        function startOllamaService() {
            vscode.postMessage({ command: 'startOllama' });
            const container = document.getElementById('modelContainer');
            container.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">Starting Ollama & detecting...</div>';
            setTimeout(() => {
                vscode.postMessage({ command: 'getOllamaModels' });
            }, 3000);
        }

        function handleProviderChange() {
            const provider = document.getElementById('settingProvider').value;
            if (provider === 'online') {
                configSettings.model = 'llama-3.3-70b-versatile';
            } else {
                configSettings.model = 'llama3';
            }
            saveSettings();
            renderModelSelector();
        }

        function saveSettings() {
            const settings = {
                backendUrl: document.getElementById('settingBackendUrl').value,
                provider: document.getElementById('settingProvider').value,
                model: document.getElementById('settingModel').value,
                groqApiKey: document.getElementById('settingApiKey').value
            };
            configSettings = settings;
            vscode.postMessage({ command: 'updateSettings', settings });
        }

        function toggleSettings() {
            const panel = document.getElementById('settingsPanel');
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        }

        function updateStatus(alive) {
            isOnline = alive;
            const pill = document.getElementById('statusPill');
            const text = document.getElementById('statusText');
            if (alive) {
                pill.className = 'status-pill online';
                text.textContent = 'RUNNING';
            } else {
                pill.className = 'status-pill';
                text.textContent = 'OFFLINE';
            }
        }

        function triggerStartBackend() {
            if (!isOnline) {
                vscode.postMessage({ command: 'startBackend' });
            }
        }

        function triggerQuickAction(action) {
            vscode.postMessage({ command: 'quickAction', action });
        }

        function handleKeydown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }

        function sendMessage() {
            const input = document.getElementById('chatInput');
            const text = input.value.trim();
            if (!text) return;

            // Clear empty state
            const emptyState = document.getElementById('emptyState');
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            // Append user message
            appendMessage('user', text);
            input.value = '';
            input.disabled = true;
            document.getElementById('sendBtn').disabled = true;

            // Add typing indicator
            appendTypingIndicator();

            // Send to Extension
            vscode.postMessage({
                command: 'sendMessage',
                text: text,
                history: history
            });

            // Store in local history
            history.push({ role: 'user', text: text });
            scrollToBottom();
        }

        function handleResponse(message) {
            removeTypingIndicator();
            const input = document.getElementById('chatInput');
            input.disabled = false;
            document.getElementById('sendBtn').disabled = false;
            input.focus();

            if (message.success) {
                appendMessage('ai', message.reply);
                history.push({ role: 'ai', text: message.reply });
            } else {
                appendMessage('ai', '\u26A0\uFE0F **Error calling Ethrix:** ' + message.error);
            }
            scrollToBottom();
        }

        function appendMessage(role, text) {
            const container = document.getElementById('chatContainer');
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message ' + role;
            
            if (role === 'ai') {
                msgDiv.innerHTML = marked.parse(text);
                // Highlight code blocks
                setTimeout(() => {
                    Prism.highlightAllUnder(msgDiv);
                }, 50);
            } else {
                msgDiv.textContent = text;
            }

            container.appendChild(msgDiv);
        }

        function appendTypingIndicator() {
            const container = document.getElementById('chatContainer');
            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.id = 'typingIndicator';
            indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
            container.appendChild(indicator);
        }

        function removeTypingIndicator() {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) {
                indicator.remove();
            }
        }

        function scrollToBottom() {
            const container = document.getElementById('chatContainer');
            container.scrollTop = container.scrollHeight;
        }
    </script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
</body>
</html>`;
  }
};

// src/extension.ts
var backendProcess = null;
var extensionContext = null;
function activate(context) {
  extensionContext = context;
  console.log("Ethrix Forge extension is now active!");
  const chatProvider = new EthrixChatProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode2.window.registerWebviewViewProvider(
      "ethrixChat",
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("ethrix-forge.analyzeCode", () => handleCodeAction("analyze")),
    vscode2.commands.registerCommand("ethrix-forge.fixCode", () => handleCodeAction("fix")),
    vscode2.commands.registerCommand("ethrix-forge.docgenCode", () => handleCodeAction("docgen")),
    vscode2.commands.registerCommand("ethrix-forge.startBackend", () => startBackendServer(true)),
    vscode2.commands.registerCommand("ethrix-forge.focusChat", () => {
      vscode2.commands.executeCommand("ethrixChat.focus");
    })
  );
  context.subscriptions.push(
    vscode2.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ethrix")) {
        chatProvider.updateSettings();
      }
    })
  );
  const config = vscode2.workspace.getConfiguration("ethrix");
  const backendUrl = config.get("backendUrl", "http://127.0.0.1:8000");
  if (backendUrl.includes("localhost") || backendUrl.includes("127.0.0.1")) {
    checkBackendAlive(backendUrl).then((alive) => {
      if (!alive) {
        console.log("Local FastAPI server is offline at startup. Auto-starting...");
        startBackendServer(false, true);
      }
    });
  }
}
function deactivate() {
  stopBackendServer();
}
function getWorkspaceRoot() {
  const folders = vscode2.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return void 0;
}
function getOrCreateReportFile() {
  const root = getWorkspaceRoot();
  if (!root) {
    return void 0;
  }
  const config = vscode2.workspace.getConfiguration("ethrix");
  const fileName = config.get("reportFileName", "ethrix_report.md");
  const reportPath = path2.join(root, fileName);
  if (!fs2.existsSync(reportPath)) {
    try {
      fs2.writeFileSync(
        reportPath,
        `# Ethrix Forge: Initial Report

Welcome to Ethrix Forge! Your code review and analysis reports will appear here automatically.`,
        { encoding: "utf-8" }
      );
    } catch (e) {
      vscode2.window.showErrorMessage(`Failed to create report file: ${e}`);
      return void 0;
    }
  }
  return reportPath;
}
async function updateReportFile(content) {
  const reportPath = getOrCreateReportFile();
  if (!reportPath) {
    try {
      const tempDir = path2.join(vscode2.workspace.workspaceFolders?.[0]?.uri?.fsPath || osTempDir(), ".ethrix");
      if (!fs2.existsSync(tempDir)) {
        fs2.mkdirSync(tempDir, { recursive: true });
      }
      const tempReportPath = path2.join(tempDir, "ethrix_temp_report.md");
      fs2.writeFileSync(tempReportPath, content, { encoding: "utf-8" });
      await openMarkdownFile(tempReportPath);
    } catch (err) {
      vscode2.window.showErrorMessage(`No active workspace and failed to save temp report: ${err}`);
    }
    return;
  }
  try {
    fs2.writeFileSync(reportPath, content, { encoding: "utf-8" });
    await openMarkdownFile(reportPath);
  } catch (e) {
    vscode2.window.showErrorMessage(`Failed to write to report file: ${e}`);
  }
}
function osTempDir() {
  return process.env.TEMP || process.env.TMP || "/tmp";
}
async function openMarkdownFile(filePath) {
  const uri = vscode2.Uri.file(filePath);
  try {
    const doc = await vscode2.workspace.openTextDocument(uri);
    await vscode2.window.showTextDocument(doc, vscode2.ViewColumn.One, true);
    await vscode2.commands.executeCommand("markdown.showPreviewToSide", uri);
  } catch (e) {
    const doc = await vscode2.workspace.openTextDocument(uri);
    await vscode2.window.showTextDocument(doc, vscode2.ViewColumn.Beside);
  }
}
async function handleCodeAction(actionType) {
  const editor = vscode2.window.activeTextEditor;
  if (!editor) {
    vscode2.window.showErrorMessage("No active text editor found. Please open a file first.");
    return;
  }
  let code = editor.document.getText(editor.selection);
  let targetLabel = "Selection";
  if (!code) {
    code = editor.document.getText();
    targetLabel = "Active File";
  }
  if (!code || !code.trim()) {
    vscode2.window.setStatusBarMessage("Ethrix: The selected file or block is empty.", 4e3);
    return;
  }
  const config = vscode2.workspace.getConfiguration("ethrix");
  const backendUrl = config.get("backendUrl", "http://127.0.0.1:8000");
  const provider = config.get("provider", "online");
  const model = config.get("model", "llama-3.3-70b-versatile");
  const groqApiKey = config.get("groqApiKey", "");
  const languageId = editor.document.languageId;
  const isAlive = await checkBackendAlive(backendUrl);
  if (!isAlive) {
    if (backendUrl.includes("localhost") || backendUrl.includes("127.0.0.1")) {
      const startNow = await vscode2.window.showWarningMessage(
        "Ethrix backend is not running. Would you like to start it in the background?",
        "Yes, start server",
        "No"
      );
      if (startNow === "Yes, start server") {
        const started = await startBackendServer();
        if (!started) {
          return;
        }
      } else {
        return;
      }
    } else {
      vscode2.window.showErrorMessage(`Ethrix Core server at ${backendUrl} is unreachable. Please check your network or configuration settings.`);
      return;
    }
  }
  await vscode2.window.withProgress({
    location: vscode2.ProgressLocation.Notification,
    title: `Ethrix: Processing Code ${targetLabel}...`,
    cancellable: false
  }, async (progress) => {
    try {
      const endpoint = `${backendUrl}/${actionType}`;
      const headers = {
        "Content-Type": "application/json"
      };
      if (groqApiKey) {
        headers["X-Groq-API-Key"] = groqApiKey;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code,
          language: languageId,
          provider,
          model
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API returned ${response.status}: ${text}`);
      }
      const data = await response.json();
      let reportMarkdown = "";
      if (actionType === "analyze") {
        reportMarkdown = data.raw_markdown_report || JSON.stringify(data, null, 2);
      } else if (actionType === "fix") {
        if (data.refactored_code && data.refactored_code.trim()) {
          reportMarkdown = `# Ethrix Forge: Code Fix & Refactoring Report

## Original Language
- **Language ID**: \`${languageId}\`

## Refactored Code

\`\`\`${languageId}
${data.refactored_code}
\`\`\`

## Optimization & Refactoring Explanation

${data.explanation || "No explanation provided."}`;
        } else {
          reportMarkdown = `# Ethrix Forge: Code Fix & Refactoring Report

\u2728 **Your code is completely healthy, correct, and bug-free!**

### Explanation:
${data.explanation || "No issues found."}`;
        }
      } else if (actionType === "docgen") {
        reportMarkdown = `# Ethrix Forge: Documentation & Architecture Report

## Architecture & Design Overview
${data.architecture_overview || "No overview generated."}

---

## \u{1F4CB} API & Functions Reference
${data.api_reference || "No API reference generated."}

---

## \u{1F680} Usage Recipes & Examples
${data.usage_examples || "No usage examples generated."}

---

## \u{1F4DD} Documented Source Code

\`\`\`${languageId}
${data.documented_code}
\`\`\`

---
*Commit message suggestion: \`${data.commit_message || "docs: add inline documentation"}\`*
`;
      }
      await updateReportFile(reportMarkdown);
      vscode2.window.setStatusBarMessage(`Ethrix: Report generated and saved successfully!`, 4e3);
    } catch (err) {
      vscode2.window.showErrorMessage(`Ethrix operation failed: ${err.message || err}`);
    }
  });
}
async function checkBackendAlive(url) {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(1500) });
    return response.status === 200;
  } catch {
    return false;
  }
}
async function startBackendServer(interactiveShow = false, silent = false) {
  if (backendProcess) {
    if (interactiveShow) {
      vscode2.window.setStatusBarMessage("Ethrix Backend is already running in the background.", 4e3);
    }
    return true;
  }
  const config = vscode2.workspace.getConfiguration("ethrix");
  const backendUrl = config.get("backendUrl", "http://127.0.0.1:8000");
  let port = "8000";
  try {
    const urlObj = new URL(backendUrl);
    if (urlObj.port) {
      port = urlObj.port;
    }
  } catch {
  }
  const extensionPath = extensionContext ? extensionContext.extensionPath : __dirname;
  let backendDir = path2.join(extensionPath, "backend");
  let mainPyPath = path2.join(backendDir, "main.py");
  if (!fs2.existsSync(mainPyPath)) {
    backendDir = path2.resolve(extensionPath, "..", "backend");
    mainPyPath = path2.join(backendDir, "main.py");
  }
  if (!fs2.existsSync(mainPyPath)) {
    if (interactiveShow) {
      vscode2.window.showErrorMessage(`FastAPI main.py not found in extension directory or sibling folder.`);
    }
    return false;
  }
  const runServer = () => {
    return new Promise((resolve2) => {
      try {
        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        backendProcess = cp2.spawn(
          pythonCmd,
          ["-m", "uvicorn", "main:app", "--port", port, "--host", "127.0.0.1"],
          {
            cwd: backendDir,
            env: { ...process.env },
            shell: true
          }
        );
        backendProcess.stdout?.on("data", (data) => {
          console.log(`[Backend stdout] ${data}`);
        });
        backendProcess.stderr?.on("data", (data) => {
          console.error(`[Backend stderr] ${data}`);
        });
        backendProcess.on("close", (code) => {
          console.log(`Backend process closed with code ${code}`);
          backendProcess = null;
        });
        let attempts = 0;
        const checkInterval = setInterval(async () => {
          attempts++;
          const alive = await checkBackendAlive(backendUrl);
          if (alive) {
            clearInterval(checkInterval);
            if (interactiveShow) {
              vscode2.window.setStatusBarMessage("Ethrix Backend Server started successfully!", 4e3);
            }
            resolve2(true);
          } else if (attempts >= 15) {
            clearInterval(checkInterval);
            if (interactiveShow) {
              vscode2.window.showErrorMessage("Failed to start Ethrix Backend server. Check if port 8000 is occupied.");
            }
            stopBackendServer();
            resolve2(false);
          }
        }, 1e3);
      } catch (err) {
        if (interactiveShow) {
          vscode2.window.showErrorMessage(`Failed to launch backend process: ${err}`);
        }
        resolve2(false);
      }
    });
  };
  if (silent) {
    return runServer();
  }
  return vscode2.window.withProgress({
    location: vscode2.ProgressLocation.Notification,
    title: "Starting Ethrix FastAPI Server...",
    cancellable: false
  }, async (progress) => {
    return runServer();
  });
}
function stopBackendServer() {
  if (backendProcess) {
    try {
      if (process.platform === "win32") {
        cp2.execSync(`taskkill /pid ${backendProcess.pid} /T /F`);
      } else {
        backendProcess.kill();
      }
      console.log("Ethrix Backend server stopped.");
    } catch (e) {
      console.error("Error stopping backend:", e);
    }
    backendProcess = null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  checkBackendAlive,
  deactivate
});
//# sourceMappingURL=extension.js.map
