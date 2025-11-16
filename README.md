# RealTutor AI - VS Code Extension (14 installs ❤️ way to more...)

<img width="1917" height="1009" alt="image" src="https://github.com/user-attachments/assets/2fe87a35-eacf-4007-838f-b81cb6b199ce" />

![image](https://github.com/user-attachments/assets/c3da398c-f055-4768-b432-2f715d38cc40)

![image](https://github.com/user-attachments/assets/ea14417b-420b-4ba6-978f-66e89421e376)




## Overview

RealTutor AI is an intelligent coding assistant that provides real-time help and guidance as you code. Unlike static code assistants, RealTutor AI actively monitors your coding activity and provides contextual assistance when you need it most.

## Features

- **Live, Context-Aware AI Assistant**: Watches your real-time coding activity and detects when you're stuck or paused
- **Human-Like Explanations**: Uses advanced AI models to explain errors in simple, beginner-friendly language
- **Smart Triggering**: Automatically responds when needed - on long pauses or error detection
- **Seamless Integration**: Runs inside VS Code with a dedicated panel for AI responses
- **Full Stack Architecture**: Real-time communication between extension and backend via HTTP API
- **Perfect for Learners**: Ideal for students, self-taught developers, or coders working without a mentor

## Installation

### Prerequisites

- Visual Studio Code (version 1.60.0 or higher)
- Python 3.8+ with pip
- Node.js and npm

### Backend Setup

1. Clone the repository:
```bash
git clone https://github.com/GaurRitika/REALTUTOR-AI
cd realtutor-ai/backend
```

2. Create and activate a virtual environment:

For Windows:
```bash
python -m venv venv
venv\Scripts\activate
```

For macOS/Linux:
```bash
python -m venv venv
source venv/bin/activate
```

3. Install the required Python packages:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file in the backend/models directory with your Groq API key:
```
GROQ_API_KEY=your_api_key_here
```

5. Start the backend server:
```bash
cd models
venv\scripts\activate
python model_api.py
```

### Extension Setup

1. Navigate to the extension directory:
```bash
cd ../extension
```

2. Install the required npm packages:
```bash
npm install
```

3. Compile the extension:
```bash
npm run compile
```

4. Launch the extension in development mode:
   - Press F5 in VS Code with the extension folder open
   - Or select "Run Extension" from the Debug menu

## Usage

1. Once the extension is running, you'll see the RealTutor AI icon in the Activity Bar
2. Click on the icon to open the RealTutor AI panel
3. The panel will automatically connect to the backend server
4. Start coding, and RealTutor AI will provide assistance in these scenarios:
   - When you pause for more than 5 seconds on a piece of code
   - When syntax or compilation errors are detected
   - When you manually select code and choose "RealTutor AI: Analyze Code"

## Commands

- **Start RealTutor AI**: Activates the RealTutor AI panel
- **RealTutor AI: Analyze Code**: Manually analyze selected code or the current file

## Project Structure

```
realtutor-ai/
├── backend/
│   ├── models/
│   │   ├── model_api.py         # Main server file with Flask and WebSocket
│   │   ├── realtutor_ai_model.py # AI model integration
│   │   └── .env                 # Environment variables (API keys)
│   └── requirements.txt         # Python dependencies
└── extension/
    ├── src/
    │   └── extension.ts         # Main extension code
    ├── package.json             # Extension metadata and dependencies
    └── tsconfig.json            # TypeScript configuration
```

## Technical Details

### Backend
- Flask: HTTP server for API endpoints
- WebSockets: For real-time communication (optional)
- Groq API: Powers the AI model responses
- LangChain: Framework for working with language models

### Extension
- TypeScript: Main programming language for the extension
- VS Code API: Integration with editor features
- Webview API: For displaying the AI assistant panel

## Customization

You can customize the behavior of RealTutor AI by modifying:
1. The prompts in `realtutor_ai_model.py` to adjust the AI's responses
2. The inactivity threshold in `extension.ts` (default: 5000ms)
3. The model used in `realtutor_ai_model.py` (default: deepseek-r1-distill-llama-70b)

## Troubleshooting

1. **Extension not connecting to server**: Ensure the backend server is running on port 3001
2. **No AI responses**: Check if your API key is valid and properly set in the .env file
3. **Errors in console**: Check the Output panel in VS Code for detailed error messages

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. It will really mean a lot ❤️❤️

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

For questions or support, please contact:
- **Ritika Gaur**: devritika.gaur@gmail.com

---

Happy coding with your new AI assistant! 🚀

![image](https://github.com/user-attachments/assets/c9267495-91d1-47e2-b74e-b58cbc776a1a)

![image](https://github.com/user-attachments/assets/2dbee9df-2caf-40e3-a989-0a66dad80ee5)

![image](https://github.com/user-attachments/assets/62355be4-8019-474b-849d-4148e68b2b17)



