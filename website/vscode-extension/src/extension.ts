import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { EthrixChatProvider } from './chatWebview';

let backendProcess: cp.ChildProcess | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    console.log('Ethrix Forge extension is now active!');

    // Initialize Sidebar Webview Chat Provider
    const chatProvider = new EthrixChatProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'ethrixChat',
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ethrix-forge.analyzeCode', () => handleCodeAction('analyze')),
        vscode.commands.registerCommand('ethrix-forge.fixCode', () => handleCodeAction('fix')),
        vscode.commands.registerCommand('ethrix-forge.docgenCode', () => handleCodeAction('docgen')),
        vscode.commands.registerCommand('ethrix-forge.startBackend', () => startBackendServer(true)),
        vscode.commands.registerCommand('ethrix-forge.focusChat', () => {
            vscode.commands.executeCommand('ethrixChat.focus');
        }),
        vscode.commands.registerCommand('ethrix-forge.sendToChat', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.selection;
                const text = editor.document.getText(selection);
                const languageId = editor.document.languageId;
                if (text && text.trim()) {
                    chatProvider.sendSelectionToWebview(text, languageId);
                } else {
                    vscode.window.showWarningMessage('No text selected to send to Ethrix Chat.');
                }
            } else {
                vscode.window.showErrorMessage('No active text editor found.');
            }
        })
    );

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ethrix')) {
                chatProvider.updateSettings();
            }
        })
    );

    // Auto-start backend server if needed (either configured locally or as a fallback)
    getActiveBackendUrl().then(async (activeUrl) => {
        if (activeUrl.includes('localhost') || activeUrl.includes('127.0.0.1')) {
            const alive = await checkBackendAlive(activeUrl);
            if (!alive) {
                console.log('Local FastAPI server is offline at startup. Auto-starting...');
                startBackendServer(false, true); // silent auto-start on launch
            }
        }
    });

    // Register Code Action Provider for sending selection to chat
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { pattern: '**/*' },
            new EthrixCodeActionProvider(),
            {
                providedCodeActionKinds: [vscode.CodeActionKind.Refactor]
            }
        )
    );
}

export function deactivate() {
    stopBackendServer();
}

/**
 * Gets the current active workspace root folder path.
 */
function getWorkspaceRoot(): string | undefined {
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
function getOrCreateReportFile(): string | undefined {
    const root = getWorkspaceRoot();
    if (!root) {
        return undefined;
    }

    const config = vscode.workspace.getConfiguration('ethrix');
    const fileName = config.get<string>('reportFileName', 'ethrix_report.md');
    const reportPath = path.join(root, fileName);

    if (!fs.existsSync(reportPath)) {
        try {
            fs.writeFileSync(
                reportPath,
                `# Ethrix Forge: Initial Report\n\nWelcome to Ethrix Forge! Your code review and analysis reports will appear here automatically.`,
                { encoding: 'utf-8' }
            );
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to create report file: ${e}`);
            return undefined;
        }
    }
    return reportPath;
}

/**
 * Updates the report file with new content and opens it.
 */
async function updateReportFile(content: string) {
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
        } catch (err) {
            vscode.window.showErrorMessage(`No active workspace and failed to save temp report: ${err}`);
        }
        return;
    }

    try {
        fs.writeFileSync(reportPath, content, { encoding: 'utf-8' });
        await openMarkdownFile(reportPath);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed to write to report file: ${e}`);
    }
}

function osTempDir(): string {
    return process.env.TEMP || process.env.TMP || '/tmp';
}

/**
 * Opens a markdown file and displays its preview side-by-side.
 */
async function openMarkdownFile(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    try {
        // Open document in a background column or beside the active editor
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
        
        // Show markdown preview to the side
        await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    } catch (e) {
        // If preview command fails, just show the document
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
}

/**
 * Handles action triggers (analyze, fix, docgen) on selected code or entire active file.
 */
async function handleCodeAction(actionType: 'analyze' | 'fix' | 'docgen') {
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
        vscode.window.setStatusBarMessage('Ethrix: The selected file or block is empty.', 4000);
        return;
    }

    const config = vscode.workspace.getConfiguration('ethrix');
    const activeBackendUrl = await getActiveBackendUrl();
    const provider = config.get<string>('provider', 'online');
    const model = config.get<string>('model', 'llama-3.3-70b-versatile');
    const groqApiKey = config.get<string>('groqApiKey', '');

    const languageId = editor.document.languageId;

    // Check if server is running
    const isAlive = await checkBackendAlive(activeBackendUrl);
    if (!isAlive) {
        if (activeBackendUrl.includes('localhost') || activeBackendUrl.includes('127.0.0.1')) {
            const startNow = await vscode.window.showWarningMessage(
                'Ethrix backend is not running. Would you like to start it in the background?',
                'Yes, start server',
                'No'
            );
            if (startNow === 'Yes, start server') {
                const started = await startBackendServer();
                if (!started) {
                    return;
                }
            } else {
                return;
            }
        } else {
            vscode.window.showErrorMessage(`Ethrix Core server at ${activeBackendUrl} is unreachable. Please check your network or configuration settings.`);
            return;
        }
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Ethrix: Processing Code ${targetLabel}...`,
        cancellable: false
    }, async (progress) => {
        try {
            const endpoint = `${activeBackendUrl}/${actionType}`;
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (groqApiKey) {
                headers['X-Groq-API-Key'] = groqApiKey;
            }

            const response = await requestPost(endpoint, {
                code,
                language: languageId,
                provider,
                model
            }, headers);

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API returned ${response.status}: ${text}`);
            }

            const data: any = await response.json();
            let reportMarkdown = '';

            if (actionType === 'analyze') {
                reportMarkdown = data.raw_markdown_report || JSON.stringify(data, null, 2);
            } else if (actionType === 'fix') {
                if (data.refactored_code && data.refactored_code.trim()) {
                    reportMarkdown = `# Ethrix Forge: Code Fix & Refactoring Report\n\n` +
                        `## Original Language\n- **Language ID**: \`${languageId}\`\n\n` +
                        `## Refactored Code\n\n\`\`\`${languageId}\n${data.refactored_code}\n\`\`\`\n\n` +
                        `## Optimization & Refactoring Explanation\n\n${data.explanation || 'No explanation provided.'}`;
                } else {
                    reportMarkdown = `# Ethrix Forge: Code Fix & Refactoring Report\n\n` +
                        `✨ **Your code is completely healthy, correct, and bug-free!**\n\n` +
                        `### Explanation:\n${data.explanation || 'No issues found.'}`;
                }
            } else if (actionType === 'docgen') {
                reportMarkdown = `# Ethrix Forge: Documentation & Architecture Report\n\n` +
                    `## Architecture & Design Overview\n${data.architecture_overview || 'No overview generated.'}\n\n` +
                    `---\n\n` +
                    `## 📋 API & Functions Reference\n${data.api_reference || 'No API reference generated.'}\n\n` +
                    `---\n\n` +
                    `## 🚀 Usage Recipes & Examples\n${data.usage_examples || 'No usage examples generated.'}\n\n` +
                    `---\n\n` +
                    `## 📝 Documented Source Code\n\n\`\`\`${languageId}\n${data.documented_code}\n\`\`\`\n\n` +
                    `---\n*Commit message suggestion: \`${data.commit_message || 'docs: add inline documentation'}\`*\n`;
            }

            await updateReportFile(reportMarkdown);
            vscode.window.setStatusBarMessage(`Ethrix: Report generated and saved successfully!`, 4000);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Ethrix operation failed: ${err.message || err}`);
        }
    });
}

/**
 * Checks if the backend server is reachable.
 */
export function checkBackendAlive(urlStr: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const url = new URL(urlStr);
            const isHttps = url.protocol === 'https:';
            const requestLib = isHttps ? https : http;
            
            const req = requestLib.get(urlStr, { timeout: 1500 }, (res) => {
                resolve(res.statusCode === 200);
            });
            
            req.on('error', () => {
                resolve(false);
            });
            
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Resolves the active backend URL by checking the configured backendUrl first.
 * If the configured backendUrl is a hosted Render URL (or any non-local URL) and is unreachable,
 * it falls back to the local backend at 'http://127.0.0.1:8000'.
 */
export async function getActiveBackendUrl(): Promise<string> {
    const config = vscode.workspace.getConfiguration('ethrix');
    const configUrl = config.get<string>('backendUrl', 'https://ethrix-forge.onrender.com');
    
    // If the config url is already local, just use it
    if (configUrl.includes('localhost') || configUrl.includes('127.0.0.1')) {
        return configUrl;
    }

    // It's a remote URL. Let's check if it's alive.
    const alive = await checkBackendAlive(configUrl);
    if (alive) {
        return configUrl;
    }

    // Primary hosted backend is offline/unreachable. Fallback to local.
    console.log(`Hosted backend ${configUrl} is unreachable. Falling back to local backend.`);
    return 'http://127.0.0.1:8000';
}

function requestPost(urlStr: string, body: any, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const bodyStr = JSON.stringify(body);
            const isHttps = url.protocol === 'https:';
            const requestLib = isHttps ? https : http;
            
            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    ...headers
                },
                timeout: 90000
            };
            
            const req = requestLib.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode || 500,
                        text: async () => data,
                        json: async () => JSON.parse(data)
                    });
                });
            });
            
            req.on('error', (err) => {
                reject(err);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out after 90 seconds'));
            });
            
            req.write(bodyStr);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Starts the FastAPI backend server using uvicorn in the workspace.
 */
async function startBackendServer(interactiveShow: boolean = false, silent: boolean = false): Promise<boolean> {
    if (backendProcess) {
        if (interactiveShow) {
            vscode.window.setStatusBarMessage('Ethrix Backend is already running in the background.', 4000);
        }
        return true;
    }

    const config = vscode.workspace.getConfiguration('ethrix');
    // Default fallback to 8000 if backendUrl is not local
    const backendUrl = config.get<string>('backendUrl', 'https://ethrix-forge.onrender.com');
    
    // Parse port
    let port = '8000';
    try {
        if (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) {
            const urlObj = new URL(backendUrl);
            if (urlObj.port) {
                port = urlObj.port;
            }
        }
    } catch {}

    // Find backend folder: check inside extension folder first (packaged mode), then check sibling (dev mode)
    const extensionPath = extensionContext ? extensionContext.extensionPath : __dirname;
    let backendDir = path.join(extensionPath, 'backend');
    let mainPyPath = path.join(backendDir, 'main.py');

    if (!fs.existsSync(mainPyPath)) {
        // Fallback to sibling directory for development mode
        backendDir = path.resolve(extensionPath, '..', 'backend');
        mainPyPath = path.join(backendDir, 'main.py');
    }

    if (!fs.existsSync(mainPyPath)) {
        // Fallback to workspace root 'backend' folder
        const root = getWorkspaceRoot();
        if (root) {
            backendDir = path.join(root, 'backend');
            mainPyPath = path.join(backendDir, 'main.py');
        }
    }

    if (!fs.existsSync(mainPyPath)) {
        // Fallback to sibling's parent directory (website/vscode-extension structure)
        backendDir = path.resolve(extensionPath, '..', '..', 'backend');
        mainPyPath = path.join(backendDir, 'main.py');
    }

    if (!fs.existsSync(mainPyPath)) {
        if (interactiveShow) {
            vscode.window.showErrorMessage(`FastAPI main.py not found in extension directory or sibling folder.`);
        }
        return false;
    }

    const runServer = () => {
        return new Promise<boolean>((resolve) => {
            try {
                // Determine command
                // Run using standard python -m uvicorn main:app
                // On Windows we need creationflags or just launch shell process
                const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                
                backendProcess = cp.spawn(
                    pythonCmd,
                    ['-m', 'uvicorn', 'main:app', '--port', port, '--host', '127.0.0.1'],
                    {
                        cwd: backendDir,
                        env: { ...process.env },
                        shell: true
                    }
                );

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
                        if (interactiveShow) {
                            vscode.window.setStatusBarMessage('Ethrix Backend Server started successfully!', 4000);
                        }
                        resolve(true);
                    } else if (attempts >= 15) {
                        clearInterval(checkInterval);
                        if (interactiveShow) {
                            vscode.window.showErrorMessage('Failed to start Ethrix Backend server. Check if port 8000 is occupied.');
                        }
                        stopBackendServer();
                        resolve(false);
                    }
                }, 1000);
            } catch (err) {
                if (interactiveShow) {
                    vscode.window.showErrorMessage(`Failed to launch backend process: ${err}`);
                }
                resolve(false);
            }
        });
    };

    if (silent) {
        return runServer();
    }

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Starting Ethrix FastAPI Server...',
        cancellable: false
    }, async (progress) => {
        return runServer();
    });
}

function stopBackendServer() {
    if (backendProcess) {
        try {
            if (process.platform === 'win32') {
                cp.execSync(`taskkill /pid ${backendProcess.pid} /T /F`);
            } else {
                backendProcess.kill();
            }
            console.log('Ethrix Backend server stopped.');
        } catch (e) {
            console.error('Error stopping backend:', e);
        }
        backendProcess = null;
    }
}

class EthrixCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        if (range.isEmpty) {
            return [];
        }

        const action = new vscode.CodeAction('Send Selection to Ethrix Chat', vscode.CodeActionKind.Refactor);
        action.command = {
            command: 'ethrix-forge.sendToChat',
            title: 'Send Selection to Ethrix Chat'
        };
        action.isPreferred = true;

        return [action];
    }
}
