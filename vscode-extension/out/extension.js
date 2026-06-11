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
exports.activate = activate;
exports.deactivate = deactivate;
exports.checkBackendAlive = checkBackendAlive;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const cp = __importStar(require("child_process"));
const chatWebview_1 = require("./chatWebview");
let backendProcess = null;
function activate(context) {
    console.log('Ethrix Forge extension is now active!');
    // Initialize Sidebar Webview Chat Provider
    const chatProvider = new chatWebview_1.EthrixChatProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ethrixChat', chatProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('ethrix-forge.analyzeCode', () => handleCodeAction('analyze')), vscode.commands.registerCommand('ethrix-forge.fixCode', () => handleCodeAction('fix')), vscode.commands.registerCommand('ethrix-forge.docgenCode', () => handleCodeAction('docgen')), vscode.commands.registerCommand('ethrix-forge.startBackend', () => startBackendServer(true)));
    // Watch for config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ethrix')) {
            chatProvider.updateSettings();
        }
    }));
}
function deactivate() {
    stopBackendServer();
}
/**
 * Gets the current active workspace root folder path.
 */
function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return undefined;
}
/**
 * Ensures the report file exists in the active workspace and returns its path.
 * If deleted, it will be recreated.
 */
function getOrCreateReportFile() {
    const root = getWorkspaceRoot();
    if (!root) {
        return undefined;
    }
    const config = vscode.workspace.getConfiguration('ethrix');
    const fileName = config.get('reportFileName', 'ethrix_report.md');
    const reportPath = path.join(root, fileName);
    if (!fs.existsSync(reportPath)) {
        try {
            fs.writeFileSync(reportPath, `# Ethrix Forge: Initial Report\n\nWelcome to Ethrix Forge! Your code review and analysis reports will appear here automatically.`, { encoding: 'utf-8' });
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to create report file: ${e}`);
            return undefined;
        }
    }
    return reportPath;
}
/**
 * Updates the report file with new content and opens it.
 */
async function updateReportFile(content) {
    const reportPath = getOrCreateReportFile();
    if (!reportPath) {
        // Fallback: write to a temp file and open it
        try {
            const tempDir = path.join(vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || osTempDir(), '.ethrix');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempReportPath = path.join(tempDir, 'ethrix_temp_report.md');
            fs.writeFileSync(tempReportPath, content, { encoding: 'utf-8' });
            await openMarkdownFile(tempReportPath);
        }
        catch (err) {
            vscode.window.showErrorMessage(`No active workspace and failed to save temp report: ${err}`);
        }
        return;
    }
    try {
        fs.writeFileSync(reportPath, content, { encoding: 'utf-8' });
        await openMarkdownFile(reportPath);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to write to report file: ${e}`);
    }
}
function osTempDir() {
    return process.env.TEMP || process.env.TMP || '/tmp';
}
/**
 * Opens a markdown file and displays its preview side-by-side.
 */
async function openMarkdownFile(filePath) {
    const uri = vscode.Uri.file(filePath);
    try {
        // Open document in a background column or beside the active editor
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
        // Show markdown preview to the side
        await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    }
    catch (e) {
        // If preview command fails, just show the document
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
}
/**
 * Handles action triggers (analyze, fix, docgen) on selected code or entire active file.
 */
async function handleCodeAction(actionType) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active text editor found. Please open a file first.');
        return;
    }
    let code = editor.document.getText(editor.selection);
    let targetLabel = 'Selection';
    if (!code) {
        code = editor.document.getText();
        targetLabel = 'Active File';
    }
    if (!code || !code.trim()) {
        vscode.window.showWarningMessage('The selected file or block is empty.');
        return;
    }
    const config = vscode.workspace.getConfiguration('ethrix');
    const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
    const provider = config.get('provider', 'online');
    const model = config.get('model', 'llama-3.3-70b-versatile');
    const groqApiKey = config.get('groqApiKey', '');
    const languageId = editor.document.languageId;
    // Check if server is running
    const isAlive = await checkBackendAlive(backendUrl);
    if (!isAlive) {
        if (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) {
            const startNow = await vscode.window.showWarningMessage('Ethrix backend is not running. Would you like to start it in the background?', 'Yes, start server', 'No');
            if (startNow === 'Yes, start server') {
                const started = await startBackendServer();
                if (!started) {
                    return;
                }
            }
            else {
                return;
            }
        }
        else {
            vscode.window.showErrorMessage(`Ethrix Core server at ${backendUrl} is unreachable. Please check your network or configuration settings.`);
            return;
        }
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Ethrix: Processing Code ${targetLabel}...`,
        cancellable: false
    }, async (progress) => {
        try {
            const endpoint = `${backendUrl}/${actionType}`;
            const headers = {
                'Content-Type': 'application/json'
            };
            if (groqApiKey) {
                headers['X-Groq-API-Key'] = groqApiKey;
            }
            const response = await fetch(endpoint, {
                method: 'POST',
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
            let reportMarkdown = '';
            if (actionType === 'analyze') {
                reportMarkdown = data.raw_markdown_report || JSON.stringify(data, null, 2);
            }
            else if (actionType === 'fix') {
                reportMarkdown = `# Ethrix Forge: Code Fix & Refactoring Report\n\n` +
                    `## Original Language\n- **Language ID**: \`${languageId}\`\n\n` +
                    `## Refactored Code\n\n\`\`\`${languageId}\n${data.refactored_code}\n\`\`\`\n\n` +
                    `## Optimization & Refactoring Explanation\n\n${data.explanation || 'No explanation provided.'}`;
            }
            else if (actionType === 'docgen') {
                reportMarkdown = `# Ethrix Forge: Documentation & Comments Report\n\n` +
                    `## Suggested Git Commit Message\n\`\`\`text\n${data.commit_message || 'docs: add inline documentation'}\n\`\`\`\n\n` +
                    `## Documented Code\n\n\`\`\`${languageId}\n${data.documented_code}\n\`\`\`\n`;
            }
            await updateReportFile(reportMarkdown);
            vscode.window.showInformationMessage(`Ethrix: Report generated and saved successfully!`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Ethrix operation failed: ${err.message || err}`);
        }
    });
}
/**
 * Checks if the backend server is reachable.
 */
async function checkBackendAlive(url) {
    try {
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1500) });
        return response.status === 200;
    }
    catch {
        return false;
    }
}
/**
 * Starts the FastAPI backend server using uvicorn in the workspace.
 */
async function startBackendServer(interactiveShow = false) {
    if (backendProcess) {
        if (interactiveShow) {
            vscode.window.showInformationMessage('Ethrix Backend is already running in the background.');
        }
        return true;
    }
    const config = vscode.workspace.getConfiguration('ethrix');
    const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
    // Parse port
    let port = '8000';
    try {
        const urlObj = new URL(backendUrl);
        if (urlObj.port) {
            port = urlObj.port;
        }
    }
    catch { }
    // Find backend folder
    // In our structure, backend is at the parent level of the extension or in the workspace root.
    // workspace folders[0] is Ethrix-Forge
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Please open a workspace folder to start the backend.');
        return false;
    }
    const backendDir = path.join(workspaceRoot, 'backend');
    const mainPyPath = path.join(backendDir, 'main.py');
    if (!fs.existsSync(mainPyPath)) {
        vscode.window.showErrorMessage(`FastAPI main.py not found in path: ${backendDir}`);
        return false;
    }
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Starting Ethrix FastAPI Server...',
        cancellable: false
    }, async (progress) => {
        return new Promise((resolve) => {
            try {
                // Determine command
                // Run using standard python -m uvicorn main:app
                // On Windows we need creationflags or just launch shell process
                const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                backendProcess = cp.spawn(pythonCmd, ['-m', 'uvicorn', 'main:app', '--port', port, '--host', '127.0.0.1'], {
                    cwd: backendDir,
                    env: { ...process.env },
                    shell: true
                });
                backendProcess.stdout?.on('data', (data) => {
                    console.log(`[Backend stdout] ${data}`);
                });
                backendProcess.stderr?.on('data', (data) => {
                    console.error(`[Backend stderr] ${data}`);
                });
                backendProcess.on('close', (code) => {
                    console.log(`Backend process closed with code ${code}`);
                    backendProcess = null;
                });
                // Poll for port availability
                let attempts = 0;
                const checkInterval = setInterval(async () => {
                    attempts++;
                    const alive = await checkBackendAlive(backendUrl);
                    if (alive) {
                        clearInterval(checkInterval);
                        vscode.window.showInformationMessage('Ethrix Backend Server started successfully!');
                        resolve(true);
                    }
                    else if (attempts >= 15) {
                        clearInterval(checkInterval);
                        vscode.window.showErrorMessage('Failed to start Ethrix Backend server. Check if port 8000 is occupied.');
                        stopBackendServer();
                        resolve(false);
                    }
                }, 1000);
            }
            catch (err) {
                vscode.window.showErrorMessage(`Failed to launch backend process: ${err}`);
                resolve(false);
            }
        });
    });
}
function stopBackendServer() {
    if (backendProcess) {
        try {
            if (process.platform === 'win32') {
                cp.execSync(`taskkill /pid ${backendProcess.pid} /T /F`);
            }
            else {
                backendProcess.kill();
            }
            console.log('Ethrix Backend server stopped.');
        }
        catch (e) {
            console.error('Error stopping backend:', e);
        }
        backendProcess = null;
    }
}
//# sourceMappingURL=extension.js.map