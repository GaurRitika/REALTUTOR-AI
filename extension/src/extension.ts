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
async function getProjectFilesWithContents(): Promise<{ filename: string, content: string }[]> {
    const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py,java,cpp,c,h,cs,go,rb,php,html,css,scss,md,json}', '**/node_modules/**', 20);
    let totalSize = 0;
    const result: { filename: string, content: string }[] = [];
    for (const file of files) {
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const content = doc.getText();
            totalSize += content.length;
            if (totalSize > 100000) break; // 100KB limit
            result.push({ filename: vscode.workspace.asRelativePath(file), content });
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
            }
        });
    }

    // Use HTTP instead of WebSocket with caching
    async function sendAnalysisRequest(data: any, retryCount = 0): Promise<boolean> {
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
                // Generate a unique messageId for feedback
                const messageId = Date.now() + Math.random().toString(36).substring(2, 8);
                tutorPanel.webview.postMessage({ ...result, messageId });
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
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RealTutor AI</title>
        <style>
            body {
                font-family: 'Segoe UI', 'Roboto', Arial, sans-serif;
                margin: 0;
                padding: 0;
                background: linear-gradient(135deg, #232526 0%, #414345 100%);
                color: var(--vscode-editor-foreground);
                height: 100vh;
            }
            .toolbar {
                display: flex;
                gap: 12px;
                padding: 16px 24px 0 24px;
                align-items: center;
            }
            .toolbar button {
                padding: 6px 14px;
                border-radius: 4px;
                border: none;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                cursor: pointer;
                font-weight: 500;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                transition: background 0.2s;
            }
            .toolbar button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .chat-container {
                display: flex;
                flex-direction: column;
                height: 90vh;
                margin: 0 24px 24px 24px;
                border-radius: 16px;
                background: rgba(30, 30, 30, 0.95);
                box-shadow: 0 4px 32px rgba(0,0,0,0.18);
                overflow: hidden;
            }
            .status-bar {
                padding: 12px 24px;
                background: rgba(60, 60, 60, 0.85);
                color: #bdbdbd;
                font-size: 13px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .messages {
                flex: 1;
                overflow-y: auto;
                padding: 24px;
                display: flex;
                flex-direction: column;
                gap: 18px;
                background: transparent;
                scroll-behavior: smooth;
            }
            .message-row {
                display: flex;
                align-items: flex-end;
                gap: 10px;
            }
            .avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: #3a3a3a;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                color: #fff;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(0,0,0,0.10);
            }
            .ai-avatar {
                background: #4e8cff;
            }
            .user-avatar {
                background: #00b894;
            }
            .bubble {
                max-width: 70%;
                padding: 16px 20px;
                border-radius: 18px;
                font-size: 15px;
                line-height: 1.6;
                box-shadow: 0 2px 8px rgba(0,0,0,0.10);
                position: relative;
                word-break: break-word;
                background: #232526;
                color: #fff;
                transition: background 0.2s;
            }
            .ai-bubble {
                background: #2d3a4a;
                border-bottom-left-radius: 4px;
            }
            .user-bubble {
                background: #00b894;
                color: #fff;
                border-bottom-right-radius: 4px;
                align-self: flex-end;
            }
            .timestamp {
                font-size: 11px;
                color: #bdbdbd;
                margin-top: 4px;
                margin-left: 46px;
            }
            .input-container {
                display: flex;
                gap: 8px;
                padding: 18px 24px;
                background: rgba(30, 30, 30, 0.98);
                border-top: 1px solid #333;
            }
            #messageInput {
                flex: 1;
                padding: 10px 14px;
                border: 1px solid #444;
                border-radius: 6px;
                background: #232526;
                color: #fff;
                font-size: 15px;
            }
            #sendButton {
                padding: 10px 22px;
                background: #4e8cff;
                color: #fff;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                font-size: 15px;
                transition: background 0.2s;
            }
            #sendButton:hover {
                background: #2563eb;
            }
            .code-block {
                background: #181c20;
                border: 1px solid #333;
                border-radius: 6px;
                padding: 12px;
                margin: 10px 0 0 0;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 14px;
                color: #e3e3e3;
                white-space: pre-wrap;
                overflow-x: auto;
            }
            .typing-indicator {
                display: none;
                align-self: flex-start;
                padding: 12px 16px;
                background: #2d3a4a;
                border-radius: 8px;
            }
            .typing-indicator span {
                display: inline-block;
                width: 8px;
                height: 8px;
                background: #fff;
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
        <div class="toolbar">
            <button id="clearCacheBtn">Clear Cache</button>
            <button id="analyzeProjectBtn">Analyze Project</button>
            <button id="refreshContextBtn">Refresh Code Context</button>
        </div>
        <div class="chat-container">
            <div class="status-bar">
                <span id="connectionStatus">Connected</span>
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

            function formatTime(date) {
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            function addMessage(content, isUser = false, messageId = undefined) {
                const row = document.createElement('div');
                row.className = 'message-row';
                const avatar = document.createElement('div');
                avatar.className = 'avatar ' + (isUser ? 'user-avatar' : 'ai-avatar');
                avatar.textContent = isUser ? 'You' : 'AI';
                const bubble = document.createElement('div');
                bubble.className = 'bubble ' + (isUser ? 'user-bubble' : 'ai-bubble');
                // Code block support
                if (content.includes('\`\`\`')) {
                    const parts = content.split('\`\`\`');
                    parts.forEach((part, index) => {
                        if (index % 2 === 0) {
                            bubble.appendChild(document.createTextNode(part));
                        } else {
                            const codeBlock = document.createElement('pre');
                            codeBlock.className = 'code-block';
                            codeBlock.textContent = part;
                            bubble.appendChild(codeBlock);
                        }
                    });
                } else {
                    bubble.textContent = content;
                }
                row.appendChild(isUser ? bubble : avatar);
                row.appendChild(isUser ? avatar : bubble);

                // Timestamp
                const timestamp = document.createElement('div');
                timestamp.className = 'timestamp';
                timestamp.textContent = formatTime(new Date());
                row.appendChild(timestamp);

                // Feedback and insert buttons for AI
                if (!isUser) {
                    const feedbackDiv = document.createElement('div');
                    feedbackDiv.style.marginTop = '8px';
                    feedbackDiv.style.display = 'flex';
                    feedbackDiv.style.gap = '8px';
                    const thumbsUp = document.createElement('button');
                    thumbsUp.textContent = '👍';
                    thumbsUp.title = 'Helpful';
                    thumbsUp.style.cursor = 'pointer';
                    thumbsUp.onclick = () => {
                        vscode.postMessage({ type: 'feedback', data: { messageId, feedback: 'up' } });
                        thumbsUp.disabled = true;
                        thumbsDown.disabled = true;
                    };
                    const thumbsDown = document.createElement('button');
                    thumbsDown.textContent = '👎';
                    thumbsDown.title = 'Not Helpful';
                    thumbsDown.style.cursor = 'pointer';
                    thumbsDown.onclick = () => {
                        vscode.postMessage({ type: 'feedback', data: { messageId, feedback: 'down' } });
                        thumbsUp.disabled = true;
                        thumbsDown.disabled = true;
                    };
                    feedbackDiv.appendChild(thumbsUp);
                    feedbackDiv.appendChild(thumbsDown);
                    bubble.appendChild(feedbackDiv);
                }

                messagesContainer.appendChild(row);
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

            // Toolbar button handlers
            document.getElementById('clearCacheBtn').onclick = () => vscode.postMessage({ type: 'clearCache' });
            document.getElementById('analyzeProjectBtn').onclick = () => vscode.postMessage({ type: 'analyzeProject' });
            document.getElementById('refreshContextBtn').onclick = () => vscode.postMessage({ type: 'refreshContext' });
        </script>
    </body>
    </html>`;

}

export function deactivate() {}