# RealTutor AI

A VS Code extension that provides real-time AI-powered coding assistance and tutoring.

## Features

- Real-time code monitoring
- Automatic assistance when you pause or encounter errors
- AI-powered explanations and suggestions
- Clean, integrated UI within VS Code

## Project Structure

```
realtutor-ai/
├── extension/           # VS Code extension
│   ├── src/
│   │   └── extension.ts # Main extension code
│   └── package.json     # Extension dependencies
└── backend/            # WebSocket server
    ├── src/
    │   └── server.js   # Backend server code
    └── package.json    # Backend dependencies
```

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the backend directory with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. Start the backend server:
   ```bash
   npm run dev
   ```

### Extension Setup

1. Navigate to the extension directory:
   ```bash
   cd extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Press F5 in VS Code to start debugging the extension

## Usage

1. Start the backend server first
2. Install and activate the VS Code extension
3. Open the Command Palette (Ctrl+Shift+P)
4. Type "Start RealTutor AI" and press Enter
5. The AI tutor panel will appear on the right side of VS Code
6. Start coding - the AI will automatically provide assistance when you pause or encounter issues

## Development

- The extension uses TypeScript and the VS Code Extension API
- The backend uses Node.js with WebSocket for real-time communication
- OpenAI's GPT-4 is used for generating responses

## Requirements

- VS Code 1.60.0 or higher
- Node.js 14.x or higher
- OpenAI API key

## License

MIT 

author - devritika.gaur@gmail.com
2changes in files 1 in server.js and extension.ts
