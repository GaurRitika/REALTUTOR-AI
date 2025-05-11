import * as vscode from 'vscode';
import * as crypto from 'crypto';

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
                        const editor = vscode.window.activeTextEditor;
                        const context = editor ? {
                            codeContext: editor.document.getText(),
                            language: editor.document.languageId,
                            fileName: editor.document.fileName
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
            }
        });
    }

    // Use HTTP instead of WebSocket with caching
    async function sendAnalysisRequest(data: any) {
        try {
            // Generate cache key
            const cacheKey = generateCacheKey(data);
            
            // Check cache first
            const cachedEntry = responseCache.get(cacheKey);
            if (cachedEntry) {
                console.log("Cache hit for request");
                if (tutorPanel) {
                    tutorPanel.webview.postMessage(cachedEntry.response);
                }
                return true;
            }

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
            
            // Cache the response
            responseCache.set(cacheKey, {
                response: result,
                timestamp: Date.now(),
                hash: cacheKey
            });
            
            // Clean old cache entries
            cleanCache();
            
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

    context.subscriptions.push(
        disposable, 
        analyzeCommand, 
        chatCommandDisposable,
        clearCacheCommand,
        cacheStatus,
        { dispose: () => {
            clearInterval(statusInterval);
            clearInterval(cacheStatusInterval);
        }}
    );
}

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RealTutor AI</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                margin: 0;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .chat-container {
                display: flex;
                flex-direction: column;
                height: calc(100vh - 40px);
            }
            .messages {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .message {
                max-width: 80%;
                padding: 12px 16px;
                border-radius: 8px;
                line-height: 1.5;
            }
            .user-message {
                align-self: flex-end;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .ai-message {
                align-self: flex-start;
                background: var(--vscode-editor-inactiveSelectionBackground);
            }
            .input-container {
                display: flex;
                gap: 8px;
                padding: 16px;
                background: var(--vscode-editor-background);
                border-top: 1px solid var(--vscode-panel-border);
            }
            #messageInput {
                flex: 1;
                padding: 8px 12px;
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-size: 14px;
            }
            #sendButton {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            #sendButton:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .status-bar {
                padding: 8px 16px;
                background: var(--vscode-statusBar-background);
                color: var(--vscode-statusBar-foreground);
                font-size: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .code-block {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 12px;
                margin: 8px 0;
                font-family: 'Consolas', 'Monaco', monospace;
                white-space: pre-wrap;
            }
            .typing-indicator {
                display: none;
                align-self: flex-start;
                padding: 12px 16px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border-radius: 8px;
            }
            .typing-indicator span {
                display: inline-block;
                width: 8px;
                height: 8px;
                background: var(--vscode-editor-foreground);
                border-radius: 50%;
                margin: 0 2px;
                animation: typing 1s infinite;
            }
            .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
            .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes typing {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-4px); }
            }
        </style>
    </head>
    <body>
        <div class="chat-container">
            <div class="status-bar">
                <span id="connectionStatus">Connecting...</span>
                <span id="modelInfo">Model: RealTutor AI</span>
            </div>
            <div class="messages" id="messages"></div>
            <div class="typing-indicator" id="typingIndicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <div class="input-container">
                <input type="text" id="messageInput" placeholder="Type your message..." />
                <button id="sendButton">Send</button>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const messagesContainer = document.getElementById('messages');
            const messageInput = document.getElementById('messageInput');
            const sendButton = document.getElementById('sendButton');
            const connectionStatus = document.getElementById('connectionStatus');
            const modelInfo = document.getElementById('modelInfo');
            const typingIndicator = document.getElementById('typingIndicator');
            
            let messageHistory = [];
            
            function addMessage(content, isUser = false) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${isUser ? 'user-message' : 'ai-message'}\`;
                
                // Check if content contains code blocks
                if (content.includes('\`\`\`')) {
                    const parts = content.split('\`\`\`');
                    parts.forEach((part, index) => {
                        if (index % 2 === 0) {
                            // Regular text
                            messageDiv.appendChild(document.createTextNode(part));
                        } else {
                            // Code block
                            const codeBlock = document.createElement('pre');
                            codeBlock.className = 'code-block';
                            codeBlock.textContent = part;
                            messageDiv.appendChild(codeBlock);
                        }
                    });
                } else {
                    messageDiv.textContent = content;
                }
                
                messagesContainer.appendChild(messageDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                messageHistory.push({ content, isUser });
            }
            
            function showTypingIndicator() {
                typingIndicator.style.display = 'block';
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            
            function hideTypingIndicator() {
                typingIndicator.style.display = 'none';
            }
            
            function sendMessage() {
                const message = messageInput.value.trim();
                if (message) {
                    addMessage(message, true);
                    messageInput.value = '';
                    showTypingIndicator();
                    vscode.postMessage({
                        type: 'userMessage',
                        data: { message }
                    });
                }
            }
            
            sendButton.addEventListener('click', sendMessage);
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
            
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.type) {
                    case 'status':
                        connectionStatus.textContent = message.data.connected ? 'Connected' : 'Disconnected';
                        connectionStatus.style.color = message.data.connected ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)';
                        if (message.data.model) {
                            modelInfo.textContent = \`Model: \${message.data.model}\`;
                        }
                        break;
                        
                    case 'response':
                        hideTypingIndicator();
                        addMessage(message.data.message);
                        break;
                        
                    case 'error':
                        hideTypingIndicator();
                        addMessage(\`Error: \${message.data.message}\`);
                        break;
                }
            });
            
            // Request initial status
            vscode.postMessage({ type: 'getStatus' });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}