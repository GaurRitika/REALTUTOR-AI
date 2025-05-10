// import * as vscode from 'vscode';
// import WebSocket from 'ws';

// export function activate(context: vscode.ExtensionContext) {
//     let tutorPanel: vscode.WebviewPanel | undefined;
//     let ws: WebSocket | undefined;
//     let lastActivityTime = Date.now();
//     const INACTIVITY_THRESHOLD = 5000; // 5 seconds
//     let reconnectAttempts = 0;
//     const MAX_RECONNECT_ATTEMPTS = 5;

//     // Create and show the tutor panel
//     function createTutorPanel() {
//         tutorPanel = vscode.window.createWebviewPanel(
//             'realtutor-ai.tutorView',
//             'AI Tutor',
//             vscode.ViewColumn.Two,
//             {
//                 enableScripts: true,
//                 retainContextWhenHidden: true
//             }
//         );

//         tutorPanel.webview.html = getWebviewContent();

//         tutorPanel.onDidDispose(() => {
//             tutorPanel = undefined;
//             if (ws) {
//                 ws.close();
//                 ws = undefined;
//             }
//         });
//     }

//     // Initialize WebSocket connection with retry logic
//     function initializeWebSocket() {
//         try {
//             if (ws) {
//                 ws.close();
//             }

//             ws = new WebSocket('ws://localhost:3000');

//             ws.on('open', () => {
//                 reconnectAttempts = 0;
//                 vscode.window.showInformationMessage('Connected to RealTutor AI server');
//                 if (tutorPanel) {
//                     tutorPanel.webview.postMessage({ type: 'status', data: { connected: true } });
//                 }
//             });

//             ws.on('message', (data: Buffer) => {
//                 if (tutorPanel) {
//                     try {
//                         const message = JSON.parse(data.toString());
//                         tutorPanel.webview.postMessage({ type: 'response', data: message });
//                     } catch (error) {
//                         console.error('Error parsing message:', error);
//                     }
//                 }
//             });

//             ws.on('error', (error: Error) => {
//                 console.error('WebSocket error:', error);
//                 vscode.window.showErrorMessage(`WebSocket error: ${error.message}`);
//                 if (tutorPanel) {
//                     tutorPanel.webview.postMessage({ type: 'status', data: { connected: false, error: error.message } });
//                 }
//             });

//             ws.on('close', () => {
//                 console.log('WebSocket connection closed');
//                 if (tutorPanel) {
//                     tutorPanel.webview.postMessage({ type: 'status', data: { connected: false } });
//                 }

//                 // Attempt to reconnect
//                 if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
//                     reconnectAttempts++;
//                     setTimeout(() => {
//                         vscode.window.showInformationMessage(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
//                         initializeWebSocket();
//                     }, 5000); // Wait 5 seconds before reconnecting
//                 } else {
//                     vscode.window.showErrorMessage('Failed to connect to RealTutor AI server after multiple attempts');
//                 }
//             });
//         } catch (error) {
//             vscode.window.showErrorMessage('Failed to initialize WebSocket connection');
//             console.error('WebSocket initialization error:', error);
//         }
//     }

//     // Monitor editor activity
//     // function monitorEditorActivity() {
//     //     const disposables: vscode.Disposable[] = [];

//     //     // Monitor text changes
//     //     disposables.push(
//     //         vscode.workspace.onDidChangeTextDocument(() => {
//     //             lastActivityTime = Date.now();
//     //         })
//     //     );

//     //     // Monitor cursor position changes
//     //     disposables.push(
//     //         vscode.window.onDidChangeTextEditorSelection(() => {
//     //             lastActivityTime = Date.now();
//     //         })
//     //     );

//     //     // Check for inactivity
//     //     const interval = setInterval(() => {
//     //         console.log('Sending to backend:');
//     //         if (Date.now() - lastActivityTime > INACTIVITY_THRESHOLD) {
//     //             const editor = vscode.window.activeTextEditor;
//     //             if (editor && ws && ws.readyState === WebSocket.OPEN) {
//     //                 const document = editor.document;
//     //                 const selection = editor.selection;
//     //                 const text = document.getText(selection);
                    
//     //                 if (text.trim()) {
//     //                     ws.send(JSON.stringify({
//     //                         type: 'inactivity',
//     //                         data: {
//     //                             text,
//     //                             language: document.languageId,
//     //                             position: selection.active,
//     //                             fileName: document.fileName
//     //                         }
//     //                     }));
//     //                 }
//     //             }
//     //         }
//     //     }, 1000);

//     //     context.subscriptions.push(...disposables, { dispose: () => clearInterval(interval) });
//     // }
//     function monitorEditorActivity() {
//         const disposables: vscode.Disposable[] = [];
//         let hasTriggeredInactivity = false; // Add this flag
    
//         // Monitor text changes
//         disposables.push(
//             vscode.workspace.onDidChangeTextDocument(() => {
//                 lastActivityTime = Date.now();
//                 hasTriggeredInactivity = false; // Reset flag
//             })
//         );
    
//         // Monitor cursor position changes
//         disposables.push(
//             vscode.window.onDidChangeTextEditorSelection(() => {
//                 lastActivityTime = Date.now();
//                 hasTriggeredInactivity = false; // Reset flag
//             })
//         );
    
//         // Check for inactivity
//         const interval = setInterval(() => {
//             // Remove or comment out this console.log to reduce noise
//             // console.log('Sending to backend:');
            
//             if (Date.now() - lastActivityTime > INACTIVITY_THRESHOLD && !hasTriggeredInactivity) {
//                 const editor = vscode.window.activeTextEditor;
//                 if (editor && ws && ws.readyState === WebSocket.OPEN) {
//                     const document = editor.document;
//                     const selection = editor.selection;
//                     const text = document.getText(selection);
                    
//                     if (text.trim()) {
//                         hasTriggeredInactivity = true; // Set flag to prevent repeated requests
//                         ws.send(JSON.stringify({
//                             type: 'inactivity',
//                             data: {
//                                 text,
//                                 language: document.languageId,
//                                 position: selection.active,
//                                 fileName: document.fileName
//                             }
//                         }));
//                     }
//                 }
//             }
//         }, 1000);
    
//         context.subscriptions.push(...disposables, { dispose: () => clearInterval(interval) });
//     }

//     // Register command to start tutoring
//     let disposable = vscode.commands.registerCommand('realtutor-ai.startTutoring', () => {
//         if (!tutorPanel) {
//             createTutorPanel();
//             initializeWebSocket();
//             monitorEditorActivity();
//         }
//     });

//     context.subscriptions.push(disposable);
// }

// function getWebviewContent() {
//     return `<!DOCTYPE html>
//     <html lang="en">
//     <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>RealTutor AI</title>
//         <style>
//             body {
//                 padding: 20px;
//                 font-family: var(--vscode-font-family);
//                 color: var(--vscode-editor-foreground);
//                 background-color: var(--vscode-editor-background);
//             }
//             .response {
//                 margin: 10px 0;
//                 padding: 15px;
//                 border-radius: 5px;
//                 background-color: var(--vscode-editor-inactiveSelectionBackground);
//                 border: 1px solid var(--vscode-editor-lineHighlightBorder);
//             }
//             .response h3 {
//                 margin-top: 0;
//                 color: var(--vscode-editor-foreground);
//             }
//             .response p {
//                 margin: 5px 0;
//                 line-height: 1.5;
//             }
//             .loading {
//                 text-align: center;
//                 padding: 20px;
//                 color: var(--vscode-descriptionForeground);
//             }
//             .status {
//                 position: fixed;
//                 top: 10px;
//                 right: 10px;
//                 padding: 5px 10px;
//                 border-radius: 3px;
//                 font-size: 12px;
//             }
//             .status.connected {
//                 background-color: var(--vscode-testing-iconPassed);
//                 color: white;
//             }
//             .status.disconnected {
//                 background-color: var(--vscode-testing-iconFailed);
//                 color: white;
//             }
//         </style>
//     </head>
//     <body>
//         <div id="status" class="status disconnected">Disconnected</div>
//         <h2>RealTutor AI Assistant</h2>
//         <div id="responses"></div>
//         <script>
//             (function() {
//                 const vscode = acquireVsCodeApi();
//                 const responsesDiv = document.getElementById('responses');
//                 const statusDiv = document.getElementById('status');

//                 window.addEventListener('message', event => {
//                     const message = event.data;
                    
//                     if (message.type === 'status') {
//                         const { connected, error } = message.data;
//                         statusDiv.textContent = connected ? 'Connected' : 'Disconnected';
//                         statusDiv.className = \`status \${connected ? 'connected' : 'disconnected'}\`;
//                         if (error) {
//                             console.error('Connection error:', error);
//                         }
//                     }
//                     else if (message.type === 'response') {
//                         const responseDiv = document.createElement('div');
//                         responseDiv.className = 'response';
                        
//                         // Format the response with sections
//                         const content = message.data.message;
//                         const sections = content.split('\\n\\n');
                        
//                         sections.forEach(section => {
//                             if (section.trim()) {
//                                 const p = document.createElement('p');
//                                 p.textContent = section;
//                                 responseDiv.appendChild(p);
//                             }
//                         });
                        
//                         responsesDiv.insertBefore(responseDiv, responsesDiv.firstChild);
//                     }
//                 });
//             })();
//         </script>
//     </body>
//     </html>`;
// }

// export function deactivate() {} 

import * as vscode from 'vscode';
import WebSocket from 'ws';

export function activate(context: vscode.ExtensionContext) {
    let tutorPanel: vscode.WebviewPanel | undefined;
    let ws: WebSocket | undefined;
    let lastActivityTime = Date.now();
    const INACTIVITY_THRESHOLD = 5000; // 5 seconds
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let hasTriggeredInactivity = false; // Add this flag

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
            if (ws) {
                ws.close();
                ws = undefined;
            }
        });
    }

    // Initialize WebSocket connection with retry logic
    function initializeWebSocket() {
        try {
            if (ws) {
                ws.close();
            }

            ws = new WebSocket('ws://localhost:3000');

            ws.on('open', () => {
                reconnectAttempts = 0;
                hasTriggeredInactivity = false; // Reset flag when connection is established
                vscode.window.showInformationMessage('Connected to RealTutor AI server');
                if (tutorPanel) {
                    tutorPanel.webview.postMessage({ type: 'status', data: { connected: true } });
                }
            });

            ws.on('message', (data: Buffer) => {
                if (tutorPanel) {
                    try {
                        const messageStr = data.toString();
                        console.log('Received from server:', messageStr.substring(0, 100) + '...');
                        const message = JSON.parse(messageStr);
                        console.log('Parsed message type:', message.type);
                        
                        // Make sure we're passing the message correctly
                        tutorPanel.webview.postMessage({ 
                            type: message.type,
                            data: message.data
                        });
                        
                        // Reset the flag after receiving a response
                        hasTriggeredInactivity = false;
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                } else {
                    console.log('Received message but tutorPanel is undefined');
                }
            });

            ws.on('error', (error: Error) => {
                console.error('WebSocket error:', error);
                vscode.window.showErrorMessage(`WebSocket error: ${error.message}`);
                if (tutorPanel) {
                    tutorPanel.webview.postMessage({ type: 'status', data: { connected: false, error: error.message } });
                }
            });

            ws.on('close', () => {
                console.log('WebSocket connection closed');
                if (tutorPanel) {
                    tutorPanel.webview.postMessage({ type: 'status', data: { connected: false } });
                }

                // Attempt to reconnect
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    setTimeout(() => {
                        vscode.window.showInformationMessage(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                        initializeWebSocket();
                    }, 5000); // Wait 5 seconds before reconnecting
                } else {
                    vscode.window.showErrorMessage('Failed to connect to RealTutor AI server after multiple attempts');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to initialize WebSocket connection');
            console.error('WebSocket initialization error:', error);
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
                if (editor && ws && ws.readyState === WebSocket.OPEN) {
                    const document = editor.document;
                    const selection = editor.selection;
                    const text = document.getText(selection);
                    
                    if (text.trim()) {
                        hasTriggeredInactivity = true; // Set flag to prevent repeated requests
                        ws.send(JSON.stringify({
                            type: 'inactivity',
                            data: {
                                text,
                                language: document.languageId,
                                position: selection.active,
                                fileName: document.fileName
                            }
                        }));
                    }
                }
            }
        }, 1000);

        context.subscriptions.push(...disposables, { dispose: () => clearInterval(interval) });
    }

    // Add a manual analyze command
    let analyzeCommand = vscode.commands.registerCommand('realtutor-ai.analyzeCode', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && ws && ws.readyState === WebSocket.OPEN) {
            const document = editor.document;
            const selection = editor.selection;
            const text = selection.isEmpty ? 
                document.getText() : // If no selection, use entire document
                document.getText(selection); // Otherwise use selection
            
            if (text.trim()) {
                ws.send(JSON.stringify({
                    type: 'inactivity',
                    data: {
                        text,
                        language: document.languageId,
                        position: selection.active,
                        fileName: document.fileName
                    }
                }));
            } else {
                vscode.window.showInformationMessage('No code selected to analyze.');
            }
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
            vscode.window.showErrorMessage('Not connected to RealTutor AI server.');
        }
    });

    // Register command to start tutoring
    let disposable = vscode.commands.registerCommand('realtutor-ai.startTutoring', () => {
        if (!tutorPanel) {
            createTutorPanel();
            initializeWebSocket();
            monitorEditorActivity();
        }
    });

    context.subscriptions.push(disposable, analyzeCommand);
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
            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 14px;
                border-radius: 2px;
                cursor: pointer;
                margin-bottom: 15px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="status" class="status disconnected">Disconnected</div>
        <h2>RealTutor AI Assistant</h2>
        <button id="testBtn">Test Response</button>
        <div id="responses"></div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                const responsesDiv = document.getElementById('responses');
                const statusDiv = document.getElementById('status');
                const testBtn = document.getElementById('testBtn');
                
                testBtn.addEventListener('click', () => {
                    // Create a test response
                    const testResponse = {
                        type: 'response',
                        data: {
                            message: "# Test Response\\n\\nThis is a test response to verify that the webview can display responses correctly.\\n\\n## Section 2\\n\\nAnother section of the test response."
                        }
                    };
                    
                    // Process it as if it came from the extension
                    processMessage(testResponse);
                });
                
                function processMessage(message) {
                    if (message.type === 'response') {
                        console.log('Processing response:', message.data);
                        
                        const responseDiv = document.createElement('div');
                        responseDiv.className = 'response';
                        
                        if (message.data && message.data.message) {
                            // Format the response with sections
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
                            console.error('Invalid response format:', message.data);
                            
                            // Display error in the UI
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
                        const { connected, error } = message.data;
                        statusDiv.textContent = connected ? 'Connected' : 'Disconnected';
                        statusDiv.className = \`status \${connected ? 'connected' : 'disconnected'}\`;
                        if (error) {
                            console.error('Connection error:', error);
                        }
                    }
                    else if (message.type === 'response') {
                        processMessage(message);
                    } else {
                        console.log('Unknown message type:', message.type);
                    }
                });
            })();
        </script>
    </body>
    </html>`;
}

export function deactivate() {}