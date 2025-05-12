import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';

// Cache interface
interface CacheEntry {
    response: any;
    timestamp: number;
    hash: string;
}

// Cache configuration
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_CACHE_SIZE = 1000; // Maximum number of cache entries

// Cache storage
let responseCache: Map<string, CacheEntry> = new Map();

// Helper function to generate cache key
function generateCacheKey(data: any): string {
    const content = JSON.stringify(data);
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Helper function to clean old cache entries
function cleanCache() {
    const now = Date.now();
    for (const [key, entry] of responseCache.entries()) {
        if (now - entry.timestamp > CACHE_DURATION) {
            responseCache.delete(key);
        }
    }
    
    // If still too many entries, remove oldest ones
    if (responseCache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(responseCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const entriesToRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
        entriesToRemove.forEach(([key]) => responseCache.delete(key));
    }
}

// Helper function for HTTP requests with caching
async function fetchWithTimeout(url: string, options: RequestInit, timeout = 5000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

// Helper to get all files in the workspace with contents (limit to 20 files, 100KB total)
async function getProjectFilesWithContents(): Promise<{ filename: string, content: string, language: string }[]> {
    const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py,java,cpp,c,h,cs,go,rb,php,html,css,scss,md,json}', '**/node_modules/**', 20);
    let totalSize = 0;
    const result: { filename: string, content: string, language: string }[] = [];
    for (const file of files) {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const content = doc.getText();
            totalSize += content.length;
            if (totalSize > 100000) break; // 100KB limit
            result.push({
                filename: vscode.workspace.asRelativePath(file),
                content,
                language: doc.languageId
            });
        } catch (e) {
            // Ignore files that can't be read
        }
    }
    return result;
}

export function activate(context: vscode.ExtensionContext) {
    let tutorPanel: vscode.WebviewPanel | undefined;
    let lastActivityTime = Date.now();
    const INACTIVITY_THRESHOLD = 5000; // 5 seconds
    let hasTriggeredInactivity = false;
    let lastErrorHash = '';
    let errorDebounceTimeout: NodeJS.Timeout | undefined;
    let isConnected = false;

    // Create and show the tutor panel
    function createTutorPanel() {
        tutorPanel = vscode.window.createWebviewPanel(
            'realtutor-ai.tutorView',
            'AI Tutor',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        tutorPanel.webview.html = getWebviewContent();

        tutorPanel.onDidDispose(() => {
            tutorPanel = undefined;
        });

        // Handle messages from the webview
        tutorPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'userMessage':
                    if (isConnected) {
                        // Always send code context with every chat message
                        const activeeditor = vscode.window.activeTextEditor;
                        const context = activeeditor ? {
                            codeContext: activeeditor.document.getText(),
                            language: activeeditor.document.languageId,
                            fileName: activeeditor.document.fileName
                        } : {};
                        await sendAnalysisRequest({
                            userMessage: message.data.message,
                            ...context
                        });
                    } else {
                        tutorPanel?.webview.postMessage({
                            type: 'error',
                            data: { message: 'Not connected to server' }
                        });
                    }
                    break;
                case 'getStatus':
                    checkServerStatus();
                    break;
                case 'feedback':
                    // For now, just show a notification. In the future, you can log this to a file or server.
                    vscode.window.showInformationMessage(`Feedback received: ${message.data.feedback === 'up' ? 'Helpful' : 'Not Helpful'}`);
                    break;
                case 'insertCode':
                    const codeeditor = vscode.window.activeTextEditor;
                    if (codeeditor) {
                        codeeditor.edit(editBuilder => {
                            editBuilder.insert(codeeditor.selection.active, message.data.code);
                        });
                        vscode.window.showInformationMessage('Code inserted into editor!');
                    } else {
                        vscode.window.showErrorMessage('No active editor to insert code.');
                    }
                    break;
                case 'analyzeProject':
                    const filesDetailed = await getProjectFilesWithContents();
                    await sendAnalysisRequest({
                        userMessage: 'Analyze my project and suggest improvements or issues.',
                        projectFilesDetailed: filesDetailed
                    });
                    vscode.window.showInformationMessage('Project analysis (with file contents) sent to RealTutor AI!');
                    break;
                case 'clearCache':
                    responseCache.clear();
                    vscode.window.showInformationMessage('RealTutor AI cache cleared');
                    break;
                case 'refreshContext':
                    const contexteditor = vscode.window.activeTextEditor;
                    if (contexteditor) {
                        await sendAnalysisRequest({
                            userMessage: 'Refresh code context',
                            codeContext: contexteditor.document.getText(),
                            language: contexteditor.document.languageId,
                            fileName: contexteditor.document.fileName
                        });
                        vscode.window.showInformationMessage('Code context refreshed!');
                    } else {
                        vscode.window.showErrorMessage('No active editor to refresh context.');
                    }
                    break;
                case 'applyFix':
                    const codeeditorApplyFix = vscode.window.activeTextEditor;
                    if (codeeditorApplyFix) {
                        await codeeditorApplyFix.edit(editBuilder => {
                            const selection = codeeditorApplyFix.selection;
                            editBuilder.replace(selection, message.data.code);
                        });
                        vscode.window.showInformationMessage('AI fix applied to your code!');
                    } else {
                        vscode.window.showErrorMessage('No active editor to apply fix.');
                    }
                    break;
            }
        });
    }

    // Use HTTP instead of WebSocket with caching
    async function sendAnalysisRequest(data: any, retryCount = 0): Promise<boolean> {
        try {
            const cacheKey = generateCacheKey(data);
            const cachedResponse = responseCache.get(cacheKey);
            
            if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_DURATION) {
                if (tutorPanel) {
                    tutorPanel.webview.postMessage({
                        type: 'response',
                        data: {
                            message: cachedResponse.response,
                            model: 'realtutor-ai'
                        }
                    });
                }
                return true;
            }

            let language = 'plaintext';
            if (data.language) {
                language = data.language;
            } else if (vscode.window.activeTextEditor) {
                language = vscode.window.activeTextEditor.document.languageId;
            }

            const response = await fetchWithTimeout('http://localhost:3001/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ...data,
                    language
                })
            }, 30000);

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const result = await response.json();
            
            // Cache the response
            responseCache.set(cacheKey, {
                response: result.data.message,
                timestamp: Date.now(),
                hash: cacheKey
            });

            // Enforce cache size limit (linter-safe)
            if (responseCache.size > MAX_CACHE_SIZE) {
                const oldestKey = responseCache.keys().next().value;
                if (oldestKey !== undefined) {
                    responseCache.delete(oldestKey);
                }
            }

            if (tutorPanel) {
                tutorPanel.webview.postMessage({
                    type: 'response',
                    data: {
                        message: result.data.message,
                        model: result.data.model || 'realtutor-ai'
                    }
                });
            }
            return true;
        } catch (error) {
            if (retryCount < 2) {
                // Retry up to 2 times
                return await sendAnalysisRequest(data, retryCount + 1);
            }
            console.error('HTTP request error:', error);
            vscode.window.showErrorMessage('Failed to connect to RealTutor AI server. Please check your connection or try again.');
            if (tutorPanel && isConnected) {
                isConnected = false;
                tutorPanel.webview.postMessage({ 
                    type: 'error', 
                    data: { 
                        message: (error as Error)?.message || 'Server not responding. Please try again later.'
                    } 
                });
            }
            return false;
        }
    }

    // Check server status
    async function checkServerStatus() {
        try {
            const response = await fetchWithTimeout('http://localhost:3001/status', {
                method: 'GET'
            }, 5000);
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log("Server status:", data);
            
            if (data.status === 'running') {
                isConnected = true;
                vscode.window.showInformationMessage('Connected to RealTutor AI server');
                if (tutorPanel) {
                    tutorPanel.webview.postMessage({ 
                        type: 'status', 
                        data: { 
                            connected: true,
                            model: data.model || 'realtutor-ai'
                        } 
                    });
                }
                return true;
            }
            return false;
        } catch (error) {
            console.error('Server status check failed:', error);
            isConnected = false;
            vscode.window.showErrorMessage('Failed to connect to RealTutor AI server');
            if (tutorPanel) {
                tutorPanel.webview.postMessage({ 
                    type: 'status', 
                    data: { 
                        connected: false,
                        error: 'Server not responding'
                    } 
                });
            }
            return false;
        }
    }

    // Monitor editor activity
    function monitorEditorActivity() {
        const disposables: vscode.Disposable[] = [];

        // Monitor text changes
        disposables.push(
            vscode.workspace.onDidChangeTextDocument(() => {
                lastActivityTime = Date.now();
                hasTriggeredInactivity = false; // Reset flag when user is active
            })
        );

        // Monitor cursor position changes
        disposables.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                lastActivityTime = Date.now();
                hasTriggeredInactivity = false; // Reset flag when user is active
            })
        );

        // Check for inactivity
        const interval = setInterval(() => {
            // Only send requests if user has been inactive AND we haven't already triggered for this inactivity period
            if (Date.now() - lastActivityTime > INACTIVITY_THRESHOLD && !hasTriggeredInactivity) {
                const editor = vscode.window.activeTextEditor;
                if (editor && isConnected) {
                    const document = editor.document;
                    const selection = editor.selection;
                    const text = document.getText(selection);
                    
                    if (text.trim()) {
                        hasTriggeredInactivity = true; // Set flag to prevent repeated requests
                        sendAnalysisRequest({
                            text,
                            language: document.languageId,
                            position: selection.active,
                            fileName: document.fileName
                        });
                    }
                }
            }
        }, 1000);

        context.subscriptions.push(...disposables, { dispose: () => clearInterval(interval) });
    }

    // Error detection using diagnostics
    function monitorDiagnostics() {
        vscode.languages.onDidChangeDiagnostics((e) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !isConnected) return;
            
            const document = editor.document;
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errors.length > 0) {
                // Hash the error content to avoid duplicate triggers
                const errorText = errors.map(e => e.message + e.range.start.line + e.range.start.character).join('|');
                const errorHash = Buffer.from(errorText).toString('base64');
                if (errorHash !== lastErrorHash) {
                    lastErrorHash = errorHash;
                    if (errorDebounceTimeout) clearTimeout(errorDebounceTimeout);
                    errorDebounceTimeout = setTimeout(() => {
                        const text = document.getText();
                        sendAnalysisRequest({
                            text,
                            language: document.languageId,
                            position: editor.selection.active,
                            fileName: document.fileName,
                            error: errors[0].message
                        });
                    }, 1200); // Debounce to avoid spamming
                }
            }
        });
    }

    // Add a manual analyze command
    let analyzeCommand = vscode.commands.registerCommand('realtutor-ai.analyzeCode', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const text = selection.isEmpty ? 
                document.getText() : // If no selection, use entire document
                document.getText(selection); // Otherwise use selection
            
            if (text.trim()) {
                sendAnalysisRequest({
                    text,
                    language: document.languageId,
                    position: selection.active,
                    fileName: document.fileName
                });
            } else {
                vscode.window.showInformationMessage('No code selected to analyze.');
            }
        } else {
            vscode.window.showErrorMessage('No active editor to analyze code.');
        }
    });

    // Register command to start tutoring
    let disposable = vscode.commands.registerCommand('realtutor-ai.startTutoring', () => {
        if (!tutorPanel) {
            createTutorPanel();
            checkServerStatus().then(connected => {
                if (connected) {
                    monitorEditorActivity();
                    monitorDiagnostics();
                }
            });
        }
    });

    // Auto-start when extension is activated
    createTutorPanel();
    checkServerStatus().then(connected => {
        if (connected) {
            monitorEditorActivity();
            monitorDiagnostics();
        }
    });
    
    // Check server status every 30 seconds
    const statusInterval = setInterval(() => {
        if (tutorPanel) {
            checkServerStatus();
        } else {
            clearInterval(statusInterval);
        }
    }, 30000);

    // Add command to open chat panel
    let chatCommandDisposable = vscode.commands.registerCommand('realtutor-ai.openChat', () => {
        if (!tutorPanel) {
            createTutorPanel();
        } else {
            tutorPanel.reveal();
        }
    });

    // Add cache status to status bar
    function updateCacheStatus() {
        const cacheSize = responseCache.size;
        const cacheStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        cacheStatus.text = `$(database) Cache: ${cacheSize}/${MAX_CACHE_SIZE}`;
        cacheStatus.tooltip = 'RealTutor AI Response Cache';
        cacheStatus.show();
        return cacheStatus;
    }

    const cacheStatus = updateCacheStatus();

    // Update cache status every minute
    const cacheStatusInterval = setInterval(() => {
        cacheStatus.text = `$(database) Cache: ${responseCache.size}/${MAX_CACHE_SIZE}`;
    }, 60000);

    // Add cache clear command
    let clearCacheCommand = vscode.commands.registerCommand('realtutor-ai.clearCache', () => {
        responseCache.clear();
        vscode.window.showInformationMessage('RealTutor AI cache cleared');
        cacheStatus.text = `$(database) Cache: 0/${MAX_CACHE_SIZE}`;
    });

    // Add command to analyze project
    let analyzeProjectCommand = vscode.commands.registerCommand('realtutor-ai.analyzeProject', async () => {
        const filesDetailed = await getProjectFilesWithContents();
        if (filesDetailed.length === 0) {
            vscode.window.showWarningMessage('No project files found.');
            return;
        }
        // Send project context to backend
        await sendAnalysisRequest({
            userMessage: 'Analyze my project and suggest improvements or issues.',
            projectFilesDetailed: filesDetailed
        });
        vscode.window.showInformationMessage('Project analysis (with file contents) sent to RealTutor AI!');
    });

    // Make activity bar icon always open/focus the chat panel
    let activityBarDisposable = vscode.commands.registerCommand('realtutor-ai.focusTutorPanel', () => {
        if (!tutorPanel) {
            createTutorPanel();
        } else {
            tutorPanel.reveal();
        }
    });

    // Register CodeActionProvider for inline AI suggestions
    const supportedLanguages = [
        'javascript',
        'typescript',
        'python',
        'javascriptreact',   // for .jsx
        'typescriptreact'    // for .tsx
    ];

    class RealTutorAICodeActionProvider implements vscode.CodeActionProvider {
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] | undefined {
            if (range.isEmpty && !context.diagnostics.length) {
                return;
            }
            const actions: vscode.CodeAction[] = [];
            // Suggestion action
            const suggestionAction = new vscode.CodeAction('Ask RealTutor AI for suggestion', vscode.CodeActionKind.QuickFix);
            suggestionAction.command = {
                title: 'Ask RealTutor AI for suggestion',
                command: 'realtutor-ai.askForSuggestion',
                arguments: [document, range]
            };
            actions.push(suggestionAction);
            // Refactor action
            const refactorAction = new vscode.CodeAction('Refactor with RealTutor AI', vscode.CodeActionKind.Refactor);
            refactorAction.command = {
                title: 'Refactor with RealTutor AI',
                command: 'realtutor-ai.refactorWithAI',
                arguments: [document, range]
            };
            actions.push(refactorAction);
            // Error correction action (only if there are error diagnostics)
            const errorDiagnostic = context.diagnostics.find(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errorDiagnostic) {
                const fixAction = new vscode.CodeAction('Fix with RealTutor AI', vscode.CodeActionKind.QuickFix);
                fixAction.command = {
                    title: 'Fix with RealTutor AI',
                    command: 'realtutor-ai.fixWithAI',
                    arguments: [document, range, errorDiagnostic]
                };
                actions.push(fixAction);
            }
            return actions;
        }
    }

    // Register the provider for supported languages
    for (const lang of supportedLanguages) {
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                { language: lang },
                new RealTutorAICodeActionProvider(),
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
            )
        );
    }

    // Register the command that handles the code action
    context.subscriptions.push(
        vscode.commands.registerCommand('realtutor-ai.askForSuggestion', async (document: vscode.TextDocument, range: vscode.Range) => {
            const code = document.getText(range);
            if (!code.trim()) {
                vscode.window.showInformationMessage('No code selected for AI suggestion.');
                return;
            }
            vscode.window.showInformationMessage('Requesting AI suggestion...');
            await sendAnalysisRequest({
                userMessage: 'Suggest improvements or fixes for the following code:',
                codeContext: code,
                language: document.languageId,
                fileName: document.fileName
            });
        })
    );

    // Register the command that handles the refactor code action
    context.subscriptions.push(
        vscode.commands.registerCommand('realtutor-ai.refactorWithAI', async (document: vscode.TextDocument, range: vscode.Range) => {
            const code = document.getText(range);
            if (!code.trim()) {
                vscode.window.showInformationMessage('No code selected for AI refactor.');
                return;
            }
            vscode.window.showInformationMessage('Requesting AI refactor...');
            await sendAnalysisRequest({
                userMessage: 'Refactor the following code to improve readability, performance, and follow best practices. If possible, convert to async and optimize for modern standards:',
                codeContext: code,
                language: document.languageId,
                fileName: document.fileName
            });
        })
    );

    // Register the command that handles the error correction code action
    context.subscriptions.push(
        vscode.commands.registerCommand('realtutor-ai.fixWithAI', async (document: vscode.TextDocument, range: vscode.Range, diagnostic: vscode.Diagnostic) => {
            const code = document.getText(range);
            const errorMsg = diagnostic?.message || 'Unknown error';
            if (!code.trim()) {
                vscode.window.showInformationMessage('No code selected for AI fix.');
                return;
            }
            vscode.window.showInformationMessage('Requesting AI fix for error...');
            // Send to backend for fix
            await sendAnalysisRequest({
                userMessage: `Fix the following code. Error: ${errorMsg}\nReturn ONLY the fixed code, and a short explanation.`,
                codeContext: code,
                language: document.languageId,
                fileName: document.fileName,
                error: errorMsg
            });
        })
    );

    context.subscriptions.push(
        disposable, 
        analyzeCommand, 
        chatCommandDisposable,
        clearCacheCommand,
        cacheStatus,
        analyzeProjectCommand,
        activityBarDisposable,
        { dispose: () => {
            clearInterval(statusInterval);
            clearInterval(cacheStatusInterval);
        }}
    );
}
function getWebviewContent() {
    // Using a different approach to avoid backtick issues
    const html = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="UTF-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '    <title>RealTutor AI</title>',
        '    <style>',
        '        :root {',
        '            --primary-color: #4e8cff;',
        '            --primary-dark: #2563eb;',
        '            --success-color: #00b894;',
        '            --background-dark: #1e1e1e;',
        '            --background-darker: #141414;',
        '            --background-lighter: #2d2d2d;',
        '            --text-color: #e0e0e0;',
        '            --text-muted: #a0a0a0;',
        '            --border-color: #333333;',
        '        }',
        '        * {',
        '            box-sizing: border-box;',
        '            margin: 0;',
        '            padding: 0;',
        '        }',
        '        body {',
        '            font-family: \'Segoe UI\', \'Roboto\', Arial, sans-serif;',
        '            margin: 0;',
        '            padding: 0;',
        '            background: var(--background-dark);',
        '            color: var(--text-color);',
        '            height: 100vh;',
        '            overflow: hidden;',
        '        }',
        '        .app-container {',
        '            display: flex;',
        '            flex-direction: column;',
        '            height: 100vh;',
        '            background: var(--background-dark);',
        '        }',
        '        .header {',
        '            display: flex;',
        '            justify-content: space-between;',
        '            align-items: center;',
        '            padding: 12px 20px;',
        '            background: var(--background-darker);',
        '            border-bottom: 1px solid var(--border-color);',
        '        }',
        '        .header-title {',
        '            display: flex;',
        '            align-items: center;',
        '            gap: 10px;',
        '        }',
        '        .header-title h1 {',
        '            font-size: 16px;',
        '            font-weight: 500;',
        '            color: var(--text-color);',
        '        }',
        '        .logo {',
        '            width: 24px;',
        '            height: 24px;',
        '            background: var(--primary-color);',
        '            border-radius: 6px;',
        '            display: flex;',
        '            align-items: center;',
        '            justify-content: center;',
        '            font-weight: bold;',
        '            color: white;',
        '            font-size: 14px;',
        '        }',
        '        .toolbar {',
        '            display: flex;',
        '            gap: 8px;',
        '            align-items: center;',
        '            padding: 10px 16px;',
        '            background: var(--background-lighter);',
        '            border-bottom: 1px solid var(--border-color);',
        '        }',
        '        .toolbar button {',
        '            padding: 6px 12px;',
        '            border-radius: 4px;',
        '            border: none;',
        '            background: var(--background-darker);',
        '            color: var(--text-color);',
        '            cursor: pointer;',
        '            font-size: 12px;',
        '            transition: all 0.2s ease;',
        '            border: 1px solid var(--border-color);',
        '        }',
        '        .toolbar button:hover {',
        '            background: var(--primary-color);',
        '            color: white;',
        '            border-color: var(--primary-color);',
        '        }',
        '        .status-bar {',
        '            display: flex;',
        '            justify-content: space-between;',
        '            align-items: center;',
        '            padding: 8px 16px;',
        '            background: var(--background-darker);',
        '            border-bottom: 1px solid var(--border-color);',
        '            font-size: 12px;',
        '            color: var(--text-muted);',
        '        }',
        '        .status-indicator {',
        '            display: flex;',
        '            align-items: center;',
        '            gap: 6px;',
        '        }',
        '        .status-dot {',
        '            width: 8px;',
        '            height: 8px;',
        '            border-radius: 50%;',
        '            background: #4CAF50;',
        '        }',
        '        .disconnected {',
        '            background: #F44336;',
        '        }',
        '        .chat-container {',
        '            flex: 1;',
        '            display: flex;',
        '            flex-direction: column;',
        '            overflow: hidden;',
        '        }',
        '        .messages {',
        '            flex: 1;',
        '            overflow-y: auto;',
        '            padding: 20px;',
        '            display: flex;',
        '            flex-direction: column;',
        '            gap: 16px;',
        '            scroll-behavior: smooth;',
        '        }',
        '        .message-row {',
        '            display: flex;',
        '            gap: 12px;',
        '            max-width: 90%;',
        '        }',
        '        .message-row.user {',
        '            align-self: flex-end;',
        '            flex-direction: row-reverse;',
        '        }',
        '        .avatar {',
        '            width: 32px;',
        '            height: 32px;',
        '            border-radius: 50%;',
        '            display: flex;',
        '            align-items: center;',
        '            justify-content: center;',
        '            font-size: 14px;',
        '            color: white;',
        '            font-weight: 500;',
        '            flex-shrink: 0;',
        '        }',
        '        .ai-avatar {',
        '            background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);',
        '            box-shadow: 0 2px 10px rgba(78, 140, 255, 0.3);',
        '        }',
        '        .user-avatar {',
        '            background: linear-gradient(135deg, var(--success-color) 0%, #009b77 100%);',
        '            box-shadow: 0 2px 10px rgba(0, 184, 148, 0.3);',
        '        }',
        '        .message-content {',
        '            display: flex;',
        '            flex-direction: column;',
        '            gap: 4px;',
        '        }',
        '        .bubble {',
        '            padding: 12px 16px;',
        '            border-radius: 12px;',
        '            font-size: 14px;',
        '            line-height: 1.5;',
        '            position: relative;',
        '            word-break: break-word;',
        '            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);',
        '        }',
        '        .ai-bubble {',
        '            background: var(--background-lighter);',
        '            border-bottom-left-radius: 4px;',
        '            border: 1px solid var(--border-color);',
        '        }',
        '        .user-bubble {',
        '            background: var(--success-color);',
        '            color: white;',
        '            border-bottom-right-radius: 4px;',
        '        }',
        '        .timestamp {',
        '            font-size: 10px;',
        '            color: var(--text-muted);',
        '            margin-top: 4px;',
        '        }',
        '        .actions {',
        '            display: flex;',
        '            gap: 8px;',
        '            margin-top: 8px;',
        '        }',
        '        .action-btn {',
        '            background: var(--background-darker);',
        '            border: 1px solid var(--border-color);',
        '            color: var(--text-color);',
        '            border-radius: 4px;',
        '            padding: 4px 8px;',
        '            font-size: 12px;',
        '            cursor: pointer;',
        '            transition: all 0.2s ease;',
        '        }',
        '        .action-btn:hover {',
        '            background: var(--primary-color);',
        '            color: white;',
        '            border-color: var(--primary-color);',
        '        }',
        '        .feedback {',
        '            display: flex;',
        '            gap: 8px;',
        '            margin-top: 8px;',
        '        }',
        '        .feedback button {',
        '            background: transparent;',
        '            border: none;',
        '            color: var(--text-muted);',
        '            cursor: pointer;',
        '            font-size: 16px;',
        '            padding: 2px;',
        '            border-radius: 4px;',
        '            transition: all 0.2s ease;',
        '        }',
        '        .feedback button:hover {',
        '            color: var(--text-color);',
        '            background: rgba(255, 255, 255, 0.1);',
        '        }',
        '        .input-container {',
        '            display: flex;',
        '            gap: 8px;',
        '            padding: 16px;',
        '            background: var(--background-darker);',
        '            border-top: 1px solid var(--border-color);',
        '        }',
        '        .input-wrapper {',
        '            flex: 1;',
        '            position: relative;',
        '            display: flex;',
        '            align-items: center;',
        '        }',
        '        #messageInput {',
        '            width: 100%;',
        '            padding: 12px 16px;',
        '            border: 1px solid var(--border-color);',
        '            border-radius: 8px;',
        '            background: var(--background-lighter);',
        '            color: var(--text-color);',
        '            font-size: 14px;',
        '            resize: none;',
        '            outline: none;',
        '            transition: border-color 0.2s ease;',
        '            line-height: 1.5;',
        '        }',
        '        #messageInput:focus {',
        '            border-color: var(--primary-color);',
        '        }',
        '        #sendButton {',
        '            padding: 12px 20px;',
        '            background: var(--primary-color);',
        '            color: white;',
        '            border: none;',
        '            border-radius: 8px;',
        '            cursor: pointer;',
        '            font-weight: 500;',
        '            font-size: 14px;',
        '            transition: background 0.2s ease;',
        '            display: flex;',
        '            align-items: center;',
        '            justify-content: center;',
        '        }',
        '        #sendButton:hover {',
        '            background: var(--primary-dark);',
        '        }',
        '        .code-block {',
        '            background: var(--background-darker);',
        '            border: 1px solid var(--border-color);',
        '            border-radius: 6px;',
        '            padding: 12px;',
        '            margin: 8px 0;',
        '            font-family: \'Consolas\', \'Monaco\', monospace;',
        '            font-size: 13px;',
        '            color: var(--text-color);',
        '            white-space: pre-wrap;',
        '            overflow-x: auto;',
        '        }',
        '        .typing-indicator {',
        '            display: none;',
        '            align-items: center;',
        '            padding: 8px 12px;',
        '            background: var(--background-lighter);',
        '            border-radius: 8px;',
        '            margin: 4px 0 4px 40px;',
        '            width: fit-content;',
        '        }',
        '        .typing-dot {',
        '            width: 8px;',
        '            height: 8px;',
        '            background: var(--primary-color);',
        '            border-radius: 50%;',
        '            margin: 0 2px;',
        '            animation: typing 1s infinite;',
        '            opacity: 0.7;',
        '        }',
        '        .typing-dot:nth-child(2) { animation-delay: 0.2s; }',
        '        .typing-dot:nth-child(3) { animation-delay: 0.4s; }',
        '        @keyframes typing {',
        '            0%, 100% { transform: translateY(0); }',
        '            50% { transform: translateY(-4px); }',
        '        }',
        '        /* Custom scrollbar */  ',
        '        ::-webkit-scrollbar {',
        '            width: 6px;',
        '            height: 6px;',
        '        }',
        '        ::-webkit-scrollbar-track {',
        '            background: var(--background-dark);',
        '        }',
        '        ::-webkit-scrollbar-thumb {',
        '            background: var(--border-color);',
        '            border-radius: 6px;',
        '        }',
        '        ::-webkit-scrollbar-thumb:hover {',
        '            background: var(--primary-color);',
        '        }',
        '        /* Custom cursor */  ',
        '        body, button, input {',
        '            cursor: default;',
        '        }',
        '        button, input, .action-btn, .feedback button {',
        '            cursor: pointer;',
        '        }',
        '        ::selection {',
        '            background: rgba(78, 140, 255, 0.3);',
        '        }',
        '    </style>',
        '</head>',
        '<body>',
        '    <div class="app-container">',
        '        <div class="header">',
        '            <div class="header-title">',
        '                <div class="logo">RT</div>',
        '                <h1>RealTutor AI</h1>',
        '            </div>',
        '            <div id="modelInfo">deepseek-r1-distill</div>',
        '        </div>',
        '        <div class="toolbar">',
        '            <button id="clearCacheBtn">Clear Cache</button>',
        '            <button id="analyzeProjectBtn">Analyze Project</button>',
        '            <button id="refreshContextBtn">Refresh Context</button>',
        '        </div>',
        '        <div class="status-bar">',
        '            <div class="status-indicator">',
        '                <div id="statusDot" class="status-dot"></div>',
        '                <span id="connectionStatus">Connected</span>',
        '            </div>',
        '            <div>Ready to assist with your code</div>',
        '        </div>',
        '        <div class="chat-container">',
        '            <div class="messages" id="messages"></div>',
        '            <div class="typing-indicator" id="typingIndicator">',
        '                <div class="typing-dot"></div>',
        '                <div class="typing-dot"></div>',
        '                <div class="typing-dot"></div>',
        '            </div>',
        '            <div class="input-container">',
        '                <div class="input-wrapper">',
        '                    <input type="text" id="messageInput" placeholder="Ask a question about your code..." />',
        '                </div>',
        '                <button id="sendButton">Send</button>',
        '            </div>',
        '        </div>',
        '    </div>',
        '    <script>',
        '        const vscode = acquireVsCodeApi();',
        '        const messagesContainer = document.getElementById(\'messages\');',
        '        const messageInput = document.getElementById(\'messageInput\');',
        '        const sendButton = document.getElementById(\'sendButton\');',
        '        const connectionStatus = document.getElementById(\'connectionStatus\');',
        '        const statusDot = document.getElementById(\'statusDot\');',
        '        const modelInfo = document.getElementById(\'modelInfo\');',
        '        const typingIndicator = document.getElementById(\'typingIndicator\');',
        '        let messageHistory = [];',
        '',
        '        function formatTime(date) {',
        '            return date.toLocaleTimeString([], { hour: \'2-digit\', minute: \'2-digit\' });',
        '        }',
        '',
        '        function addMessage(content, isUser = false, messageId = undefined) {',
        '            const row = document.createElement(\'div\');',
        '            row.className = \'message-row\' + (isUser ? \' user\' : \'\');',
        '',
        '            const avatar = document.createElement(\'div\');',
        '            avatar.className = \'avatar \' + (isUser ? \'user-avatar\' : \'ai-avatar\');',
        '            avatar.textContent = isUser ? \'You\' : \'AI\';',
        '',
        '            const messageContent = document.createElement(\'div\');',
        '            messageContent.className = \'message-content\';',
        '',
        '            const bubble = document.createElement(\'div\');',
        '            bubble.className = \'bubble \' + (isUser ? \'user-bubble\' : \'ai-bubble\');',
        '            ',
        '            // Code block support with Apply Fix button for AI',
        '            if (!isUser && content.indexOf("```") !== -1) {',
        '                const parts = content.split("```");',
        '                for (let index = 0; index < parts.length; index++) {',
        '                    const part = parts[index];',
        '                    if (index % 2 === 0) {',
        '                        if (part) bubble.appendChild(document.createTextNode(part));',
        '                    } else {',
        '                        const codeBlock = document.createElement(\'pre\');',
        '                        codeBlock.className = \'code-block\';',
        '                        codeBlock.textContent = part;',
        '                        bubble.appendChild(codeBlock);',
        '',
        '                        const actions = document.createElement(\'div\');',
        '                        actions.className = \'actions\';',
        '',
        '                        const applyBtn = document.createElement(\'button\');',
        '                        applyBtn.className = \'action-btn\';',
        '                        applyBtn.textContent = \'Apply Fix\';',
        '                        applyBtn.onclick = function() {',
        '                            vscode.postMessage({ type: \'applyFix\', data: { code: part } });',
        '                        };',
        '                        actions.appendChild(applyBtn);',
        '',
        '                        const copyBtn = document.createElement(\'button\');',
        '                        copyBtn.className = \'action-btn\';',
        '                        copyBtn.textContent = \'Copy\';',
        '                        copyBtn.onclick = function() {',
        '                            navigator.clipboard.writeText(part);',
        '                            copyBtn.textContent = \'Copied!\';',
        '                            setTimeout(() => { copyBtn.textContent = \'Copy\'; }, 2000);',
        '                        };',
        '                        actions.appendChild(copyBtn);',
        '',
        '                        bubble.appendChild(actions);',
        '                    }',
        '                }',
        '            } else if (content.indexOf("```") !== -1) {',
        '                // User message with code block, no Apply Fix',
        '                const parts = content.split("```");',
        '                for (let index = 0; index < parts.length; index++) {',
        '                    const part = parts[index];',
        '                    if (index % 2 === 0) {',
        '                        if (part) bubble.appendChild(document.createTextNode(part));',
        '                    } else {',
        '                        const codeBlock = document.createElement(\'pre\');',
        '                        codeBlock.className = \'code-block\';',
        '                        codeBlock.textContent = part;',
        '                        bubble.appendChild(codeBlock);',
        '                    }',
        '                }',
        '            } else {',
        '                bubble.textContent = content;',
        '            }',
        '',
        '            messageContent.appendChild(bubble);',
        '',
        '            const timestamp = document.createElement(\'div\');',
        '            timestamp.className = \'timestamp\';',
        '            timestamp.textContent = formatTime(new Date());',
        '            messageContent.appendChild(timestamp);',
        '',
        '            if (!isUser) {',
        '                const feedback = document.createElement(\'div\');',
        '                feedback.className = \'feedback\';',
        '',
        '                const thumbsUp = document.createElement(\'button\');',
        '                thumbsUp.textContent = \'👍\';',
        '                thumbsUp.title = \'Helpful\';',
        '                thumbsUp.onclick = function() {',
        '                    vscode.postMessage({ type: \'feedback\', data: { messageId, feedback: \'up\' } });',
        '                    thumbsUp.style.color = \'#4CAF50\';',
        '                    thumbsDown.disabled = true;',
        '                    thumbsUp.disabled = true;',
        '                };',
        '',
        '                const thumbsDown = document.createElement(\'button\');',
        '                thumbsDown.textContent = \'👎\';',
        '                thumbsDown.title = \'Not Helpful\';',
        '                thumbsDown.onclick = function() {',
        '                    vscode.postMessage({ type: \'feedback\', data: { messageId, feedback: \'down\' } });',
        '                    thumbsDown.style.color = \'#F44336\';',
        '                    thumbsUp.disabled = true;',
        '                    thumbsDown.disabled = true;',
        '                };',
        '',
        '                feedback.appendChild(thumbsUp);',
        '                feedback.appendChild(thumbsDown);',
        '                messageContent.appendChild(feedback);',
        '            }',
        '',
        '            row.appendChild(avatar);',
        '            row.appendChild(messageContent);',
        '',
        '            messagesContainer.appendChild(row);',
        '            messagesContainer.scrollTop = messagesContainer.scrollHeight;',
        '            messageHistory.push({ content, isUser });',
        '        }',
        '',
        '        function showTypingIndicator() {',
        '            typingIndicator.style.display = \'flex\';',
        '            messagesContainer.scrollTop = messagesContainer.scrollHeight;',
        '        }',
        '        ',
        '        function hideTypingIndicator() {',
        '            typingIndicator.style.display = \'none\';',
        '        }',
        '        ',
        '        function sendMessage() {',
        '            const message = messageInput.value.trim();',
        '            if (message) {',
        '                addMessage(message, true);',
        '                messageInput.value = \'\';',
        '                showTypingIndicator();',
        '                vscode.postMessage({',
        '                    type: \'userMessage\',',
        '                    data: { message }',
        '                });',
        '            }',
        '        }',
        '        ',
        '        sendButton.addEventListener(\'click\', sendMessage);',
        '        messageInput.addEventListener(\'keypress\', function(e) {',
        '            if (e.key === \'Enter\' && !e.shiftKey) {',
        '                e.preventDefault();',
        '                sendMessage();',
        '            }',
        '        });',
        '        ',
        '        window.addEventListener(\'message\', function(event) {',
        '            const message = event.data;',
        '            ',
        '            switch (message.type) {',
        '                case \'status\':',
        '                    connectionStatus.textContent = message.data.connected ? \'Connected\' : \'Disconnected\';',
        '                    statusDot.classList.toggle(\'disconnected\', !message.data.connected);',
        '                    if (message.data.model) {',
        '                        modelInfo.textContent = message.data.model;',
        '                    }',
        '                    break;',
        '                    ',
        '                case \'response\':',
        '                    hideTypingIndicator();',
        '                    addMessage(message.data.message, false, message.messageId);',
        '                    break;',
        '                    ',
        '                case \'error\':',
        '                    hideTypingIndicator();',
        '                    addMessage(\'Error: \' + message.data.message);',
        '                    break;',
        '            }',
        '        });',
        '        ',
        '        // Request initial status',
        '        vscode.postMessage({ type: \'getStatus\' });',
        '',
        '        // Toolbar button handlers',
        '        document.getElementById(\'clearCacheBtn\').onclick = function() {',
        '            vscode.postMessage({ type: \'clearCache\' });',
        '        };',
        '        document.getElementById(\'analyzeProjectBtn\').onclick = function() {',
        '            vscode.postMessage({ type: \'analyzeProject\' });',
        '        };',
        '        document.getElementById(\'refreshContextBtn\').onclick = function() {',
        '            vscode.postMessage({ type: \'refreshContext\' });',
        '        };',
        '',
        '        // Focus input on load',
        '        messageInput.focus();',
        '',
        '        // Add welcome message',
        '        setTimeout(() => {',
        '            addMessage("👋 Hi! I\'m RealTutor AI, your coding assistant. How can I help you today?");',
        '        }, 500);',
        '    </script>',
        '</body>',
        '</html>'
    ].join('\n');

    return html;
}