// const WebSocket = require('ws');
// const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

// process.env.OPENROUTER_API_KEY = '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';
// console.log('Loaded OpenRouter API Key:', process.env.OPENROUTER_API_KEY);

// // Rate limiting
// const RATE_LIMIT = {
//     windowMs: 60000, // 1 minute
//     maxRequests: 30  // 30 requests per minute
// };

// const requestCounts = new Map();

// // Create WebSocket server
// const wss = new WebSocket.Server({ port: 3000 });

// console.log('RealTutor AI server running on port 3000');

// // Check rate limit
// function checkRateLimit(clientId) {
//     const now = Date.now();
//     const clientRequests = requestCounts.get(clientId) || [];
//     // Remove old requests
//     const recentRequests = clientRequests.filter(time => now - time < RATE_LIMIT.windowMs);
//     if (recentRequests.length >= RATE_LIMIT.maxRequests) {
//         return false;
//     }
//     recentRequests.push(now);
//     requestCounts.set(clientId, recentRequests);
//     return true;
// }

// // Generate a unique client ID
// function generateClientId(ws) {
//     return `${ws._socket.remoteAddress}-${Date.now()}`;
// }

// wss.on('connection', (ws) => {
//     const clientId = generateClientId(ws);
//     console.log(`New client connected: ${clientId}`);

//     ws.on('message', async (message) => {
//         try {
//             console.log(`Received message from ${clientId}:`, message.toString().substring(0, 100));
//             const data = JSON.parse(message);
//             if (data.type === 'inactivity') {
//                 // Check rate limit
//                 if (!checkRateLimit(clientId)) {
//                     ws.send(JSON.stringify({
//                         type: 'error',
//                         data: {
//                             message: 'Rate limit exceeded. Please wait a moment before trying again.'
//                         }
//                     }));
//                     return;
//                 }

//                 const { text, language, position, fileName } = data.data;
//                 // Prepare prompt for OpenRouter
//                 const prompt = `As a coding tutor, help me understand and improve this code:\nFile: ${fileName}\nLanguage: ${language}\nCode: ${text}\n\nPlease provide:\n1. A clear explanation of what the code does\n2. Any potential issues or bugs\n3. Suggestions for improvement\n4. Explanation of important concepts used\n\nKeep the explanation clear and beginner-friendly.`;

//                 const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
//                     method: 'POST',
//                     headers: {
//                         'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
//                         'Content-Type': 'application/json'
//                     },
//                     body: JSON.stringify({
//                         model: "openai/gpt-3.5-turbo",
//                         messages: [
//                             {
//                                 role: "system",
//                                 content: "You are a helpful coding tutor who explains concepts clearly and provides practical suggestions. Focus on teaching and helping the user understand the code better."
//                             },
//                             {
//                                 role: "user",
//                                 content: prompt
//                             }
//                         ],
//                         temperature: 0.7,
//                         max_tokens: 500
//                     })
//                 });
//                 const result = await response.json();
//                 console.log('OpenRouter result:', result);
//                 if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
//                     const responseObj = {
//                         type: 'response',
//                         data: {
//                             message: result.choices[0].message.content
//                         }
//                     };
//                     ws.send(JSON.stringify(responseObj));
//                     console.log('Sent response to client:', responseObj);
//                 } else {
//                     ws.send(JSON.stringify({
//                         type: 'error',
//                         data: {
//                             message: 'No response from AI model.'
//                         }
//                     }));
//                     console.log('Sent error to client: No response from AI model.');
//                 }
//             }
//         } catch (error) {
//             console.error('Error processing message:', error);
//             let errorMessage = 'An error occurred while processing your request.';
//             if (error.response?.status === 429) {
//                 errorMessage = 'API rate limit exceeded. Please try again in a few moments.';
//             } else if (error.response?.status === 401) {
//                 errorMessage = 'API key is invalid or missing.';
//             }
//             ws.send(JSON.stringify({
//                 type: 'error',
//                 data: {
//                     message: errorMessage
//                 }
//             }));
//         }
//     });

//     ws.on('close', () => {
//         console.log(`Client disconnected: ${clientId}`);
//         requestCounts.delete(clientId);
//     });

//     ws.on('error', (error) => {
//         console.error(`WebSocket error for client ${clientId}:`, error);
//     });
// });


const WebSocket = require('ws');

// Mock AI response function
function getMockResponse(text, language, fileName) {
    return {
        choices: [
            {
                message: {
                    content: `
# Code Analysis for ${fileName || 'unnamed file'}

## What this code does
This appears to be ${language} code: \`${text.substring(0, 50)}${text.length > 50 ? '...' : ''}\`

## Potential issues
- Make sure variable names are descriptive
- Check for proper syntax in your ${language} code
- Ensure proper error handling

## Suggestions for improvement
- Add comments to explain complex logic
- Consider breaking down complex functions into smaller ones
- Use consistent naming conventions

## Concepts
${language} is a programming language that's commonly used in web development.
                    `
                }
            }
        ]
    };
}

// Rate limiting
const RATE_LIMIT = {
    windowMs: 60000, // 1 minute
    maxRequests: 30  // 30 requests per minute
};

const requestCounts = new Map();

// Create WebSocket server
const wss = new WebSocket.Server({ port: 3000 });

console.log('RealTutor AI server running on port 3000');

// Check rate limit
function checkRateLimit(clientId) {
    const now = Date.now();
    const clientRequests = requestCounts.get(clientId) || [];
    // Remove old requests
    const recentRequests = clientRequests.filter(time => now - time < RATE_LIMIT.windowMs);
    if (recentRequests.length >= RATE_LIMIT.maxRequests) {
        return false;
    }
    recentRequests.push(now);
    requestCounts.set(clientId, recentRequests);
    return true;
}

// Generate a unique client ID
function generateClientId(ws) {
    return `${ws._socket.remoteAddress}-${Date.now()}`;
}

wss.on('connection', (ws) => {
    const clientId = generateClientId(ws);
    console.log(`New client connected: ${clientId}`);

    ws.on('message', async (message) => {
        try {
            console.log(`Received message from ${clientId}:`, message.toString().substring(0, 100));
            const data = JSON.parse(message);
            if (data.type === 'inactivity') {
                // Check rate limit
                if (!checkRateLimit(clientId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: {
                            message: 'Rate limit exceeded. Please wait a moment before trying again.'
                        }
                    }));
                    return;
                }

                const { text, language, position, fileName } = data.data;
                
                // Use mock response instead of API call
                const result = getMockResponse(text, language, fileName);
                console.log('Generated mock response');
                
                if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                    const responseObj = {
                        type: 'response',
                        data: {
                            message: result.choices[0].message.content
                        }
                    };
                    console.log('Sending response to client:', JSON.stringify(responseObj).substring(0, 100) + '...');
                    ws.send(JSON.stringify(responseObj));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: {
                            message: 'No response from AI model.'
                        }
                    }));
                    console.log('Sent error to client: No response from AI model.');
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            let errorMessage = 'An error occurred while processing your request.';
            ws.send(JSON.stringify({
                type: 'error',
                data: {
                    message: errorMessage
                }
            }));
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        requestCounts.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
    });
});