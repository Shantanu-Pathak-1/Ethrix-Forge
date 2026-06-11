"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EthrixChatProvider = void 0;
const vscode = __importStar(require("vscode"));
const extension_1 = require("./extension");
class EthrixChatProvider {
    _extensionUri;
    _context;
    _view;
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        // Receive messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this.handleChatSubmit(message.text, message.history);
                    break;
                case 'getSettings':
                    this.sendSettingsToWebview();
                    break;
                case 'updateSettings':
                    await this.updateExtensionSettings(message.settings);
                    break;
                case 'checkStatus':
                    await this.checkServerStatus();
                    break;
                case 'quickAction':
                    await this.handleQuickAction(message.action);
                    break;
                case 'startBackend':
                    await vscode.commands.executeCommand('ethrix-forge.startBackend');
                    await this.checkServerStatus();
                    break;
            }
        });
        // Periodic server status check
        this.checkServerStatus();
        const interval = setInterval(() => {
            if (this._view && this._view.visible) {
                this.checkServerStatus();
            }
        }, 5000);
        webviewView.onDidDispose(() => {
            clearInterval(interval);
        });
        // Initial settings send
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
        const config = vscode.workspace.getConfiguration('ethrix');
        const settings = {
            backendUrl: config.get('backendUrl', 'http://127.0.0.1:8000'),
            provider: config.get('provider', 'online'),
            model: config.get('model', 'llama-3.3-70b-versatile'),
            groqApiKey: config.get('groqApiKey', '')
        };
        this._view.webview.postMessage({ command: 'settings', data: settings });
    }
    async updateExtensionSettings(newSettings) {
        const config = vscode.workspace.getConfiguration('ethrix');
        if (newSettings.backendUrl !== undefined) {
            await config.update('backendUrl', newSettings.backendUrl, vscode.ConfigurationTarget.Global);
        }
        if (newSettings.provider !== undefined) {
            await config.update('provider', newSettings.provider, vscode.ConfigurationTarget.Global);
        }
        if (newSettings.model !== undefined) {
            await config.update('model', newSettings.model, vscode.ConfigurationTarget.Global);
        }
        if (newSettings.groqApiKey !== undefined) {
            await config.update('groqApiKey', newSettings.groqApiKey, vscode.ConfigurationTarget.Global);
        }
        this.sendSettingsToWebview();
    }
    async checkServerStatus() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration('ethrix');
        const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
        const alive = await (0, extension_1.checkBackendAlive)(backendUrl);
        this._view.webview.postMessage({ command: 'status', alive });
    }
    async handleQuickAction(action) {
        switch (action) {
            case 'analyze':
                await vscode.commands.executeCommand('ethrix-forge.analyzeCode');
                break;
            case 'fix':
                await vscode.commands.executeCommand('ethrix-forge.fixCode');
                break;
            case 'docgen':
                await vscode.commands.executeCommand('ethrix-forge.docgenCode');
                break;
        }
    }
    async handleChatSubmit(text, history) {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration('ethrix');
        const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
        const provider = config.get('provider', 'online');
        const model = config.get('model', 'llama-3.3-70b-versatile');
        const groqApiKey = config.get('groqApiKey', '');
        // Map roles for backend: 'model' is expected for AI responses
        const formattedHistory = history.map(h => ({
            role: h.role === 'ai' ? 'model' : 'user',
            text: h.text
        }));
        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (groqApiKey) {
                headers['X-Groq-API-Key'] = groqApiKey;
            }
            const response = await fetch(`${backendUrl}/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message: text,
                    history: formattedHistory,
                    provider,
                    model
                })
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `HTTP ${response.status}`);
            }
            const data = await response.json();
            this._view.webview.postMessage({
                command: 'response',
                success: true,
                reply: data.reply
            });
        }
        catch (err) {
            this._view.webview.postMessage({
                command: 'response',
                success: false,
                error: err.message || err
            });
        }
    }
    getHtmlForWebview(webview) {
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
        <div class="title">ETHRIX FORGE</div>
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
            <select id="settingProvider" onchange="toggleProvider(); saveSettings()">
                <option value="online">Online Cloud (Groq)</option>
                <option value="offline">Offline Local (Ollama)</option>
            </select>
        </div>
        <div class="settings-group">
            <label class="settings-label">Model</label>
            <input type="text" id="settingModel" class="settings-input" onchange="saveSettings()">
        </div>
        <div class="settings-group" id="apiKeyGroup">
            <label class="settings-label">Groq API Key (Optional Override)</label>
            <input type="password" id="settingApiKey" class="settings-input" onchange="saveSettings()" placeholder="••••••••">
        </div>
    </div>

    <div class="chat-container" id="chatContainer">
        <!-- Empty State -->
        <div class="empty-state" id="emptyState">
            <div class="empty-icon">⚡</div>
            <div class="empty-title">Ethrix AI Assistant</div>
            <div class="empty-desc">Ask me to review, explain, or optimize code. Run workspace commands directly below:</div>
            
            <div class="quick-actions">
                <button class="action-btn" onclick="triggerQuickAction('analyze')">
                    <span>🔍</span> Analyze Active Selection
                </button>
                <button class="action-btn" onclick="triggerQuickAction('fix')">
                    <span>⚡</span> Optimize &amp; Fix Code
                </button>
                <button class="action-btn" onclick="triggerQuickAction('docgen')">
                    <span>📝</span> Generate Documentation
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
            }
        });

        // Request settings on load
        vscode.postMessage({ command: 'getSettings' });
        vscode.postMessage({ command: 'checkStatus' });

        function populateSettings() {
            document.getElementById('settingBackendUrl').value = configSettings.backendUrl;
            document.getElementById('settingProvider').value = configSettings.provider;
            document.getElementById('settingModel').value = configSettings.model;
            document.getElementById('settingApiKey').value = configSettings.groqApiKey;
            toggleProvider();
        }

        function toggleProvider() {
            const provider = document.getElementById('settingProvider').value;
            const apiKeyGroup = document.getElementById('apiKeyGroup');
            if (provider === 'offline') {
                apiKeyGroup.style.display = 'none';
            } else {
                apiKeyGroup.style.display = 'block';
            }
        }

        function saveSettings() {
            const settings = {
                backendUrl: document.getElementById('settingBackendUrl').value,
                provider: document.getElementById('settingProvider').value,
                model: document.getElementById('settingModel').value,
                groqApiKey: document.getElementById('settingApiKey').value
            };
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
                appendMessage('ai', '⚠️ **Error calling Ethrix:** ' + message.error);
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
}
exports.EthrixChatProvider = EthrixChatProvider;
//# sourceMappingURL=chatWebview.js.map