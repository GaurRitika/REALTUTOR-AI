import * as vscode from 'vscode';

// Helper function for HTTP requests
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
    }

    // Use HTTP instead of WebSocket
    async function sendAnalysisRequest(data: any) {
        try {
            console.log("Sending analysis request to http://localhost:3001/analyze");
            
            const response = await fetchWithTimeout('http://localhost:3001/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            }, 10000);
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log("Received response:", result);
            
            if (tutorPanel) {
                tutorPanel.webview.postMessage(result);
            }
            
            return true;
        } catch (error) {
            console.error('HTTP request error:', error);
            vscode.window.showErrorMessage('Failed to connect to RealTutor AI server');
            
            if (tutorPanel && isConnected) {
                isConnected = false;
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

    context.subscriptions.push(
        disposable, 
        analyzeCommand, 
        { dispose: () => clearInterval(statusInterval) }
    );
}

function getWebviewContent() {
    // Add a model indicator and clear button
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RealTutor AI</title>
        <style>
            body {
                padding: 20px;
                font-family: var(--vscode-font-family);
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
            }
            .response {
                margin: 10px 0;
                padding: 15px;
                border-radius: 5px;
                background-color: var(--vscode-editor-inactiveSelectionBackground);
                border: 1px solid var(--vscode-editor-lineHighlightBorder);
                box-shadow: 0 2px 8px rgba(0,0,0,0.04);
            }
            .response h3 {
                margin-top: 0;
                color: var(--vscode-editor-foreground);
            }
            .response p {
                margin: 5px 0;
                line-height: 1.5;
            }
            .loading {
                text-align: center;
                padding: 20px;
                color: var(--vscode-descriptionForeground);
            }
            .status {
                position: fixed;
                top: 10px;
                right: 10px;
                padding: 5px 10px;
                border-radius: 3px;
                font-size: 12px;
            }
            .status.connected {
                background-color: var(--vscode-testing-iconPassed);
                color: white;
            }
            .status.disconnected {
                background-color: var(--vscode-testing-iconFailed);
                color: white;
            }
            .model-indicator {
                position: fixed;
                top: 10px;
                left: 10px;
                padding: 5px 10px;
                border-radius: 3px;
                font-size: 12px;
                background: var(--vscode-editorWidget-background);
                color: var(--vscode-editorWidget-foreground);
                border: 1px solid var(--vscode-editorWidget-border);
            }
            .clear-btn {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 14px;
                border-radius: 2px;
                cursor: pointer;
                margin-bottom: 15px;
                float: right;
            }
            .clear-btn:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="status" class="status disconnected">Disconnected</div>
        <div id="modelIndicator" class="model-indicator">Model: ...</div>
        <h2>RealTutor AI Assistant</h2>
        <button id="clearBtn" class="clear-btn">Clear</button>
        <div id="responses"></div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                const responsesDiv = document.getElementById('responses');
                const statusDiv = document.getElementById('status');
                const modelIndicator = document.getElementById('modelIndicator');
                const clearBtn = document.getElementById('clearBtn');

                clearBtn.addEventListener('click', () => {
                    responsesDiv.innerHTML = '';
                });

                function setModelIndicator(model) {
                    modelIndicator.textContent = 'Model: ' + (model === 'openai' ? 'OpenAI (Cloud)' : 'RealTutor AI');
                }

                function processMessage(message) {
                    if (message.type === 'response') {
                        const responseDiv = document.createElement('div');
                        responseDiv.className = 'response';
                        if (message.data && message.data.message) {
                            const content = message.data.message;
                            const sections = content.split('\\n\\n');
                            sections.forEach(section => {
                                if (section.trim()) {
                                    const p = document.createElement('p');
                                    p.textContent = section;
                                    responseDiv.appendChild(p);
                                }
                            });
                            responsesDiv.insertBefore(responseDiv, responsesDiv.firstChild);
                        } else {
                            const errorP = document.createElement('p');
                            errorP.textContent = 'Error: Invalid response from server';
                            errorP.style.color = 'red';
                            responseDiv.appendChild(errorP);
                            responsesDiv.insertBefore(responseDiv, responsesDiv.firstChild);
                        }
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('Webview received message:', message);
                    if (message.type === 'status') {
                        var connected = message.data.connected;
                        var error = message.data.error;
                        var model = message.data.model;
                        statusDiv.textContent = connected ? 'Connected' : 'Disconnected';
                        statusDiv.className = 'status ' + (connected ? 'connected' : 'disconnected');
                        if (model) setModelIndicator(model);
                        if (error) {
                            console.error('Connection error:', error);
                        }
                    }
                    else if (message.type === 'response') {
                        if (message.data && message.data.model) setModelIndicator(message.data.model);
                        processMessage(message);
                    }
                });
            })();
        </script>
    </body>
    </html>`;
}

export function deactivate() {}