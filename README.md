RealTutor AI - VS Code Extension

![Uploading Screenshot 2025-05-11 165747.png…]()

Overview

RealTutor AI is an intelligent coding assistant that provides real-time help and guidance as you code. Unlike static code assistants, RealTutor AI actively monitors your coding activity and provides contextual assistance when you need it most.

Developed by: Ritika Gaur

Features

1.Live, Context-Aware AI Assistant: Watches your real-time coding activity and detects when you're stuck or paused

2.Human-Like Explanations: Uses advanced AI models to explain errors in simple, beginner-friendly language

3.Smart Triggering: Automatically responds when needed - on long pauses or error detection

4.Seamless Integration: Runs inside VS Code with a dedicated panel for AI responses

5.Full Stack Architecture: Real-time communication between extension and backend via HTTP API

6.Perfect for Learners: Ideal for students, self-taught developers, or coders working without a 
 mentor

 
Installation

Prerequisites

1.Visual Studio Code (version 1.60.0 or higher)

2.Python 3.8+ with pip

3.Node.js and npm

Backend Setup

.Clone the repository:

git clone https://github.com/GaurRitika/REALTUTOR-AI/edit/main/README.md

cd realtutor-ai/backend


Create and activate a virtual environment:

# Windows

python -m venv venv

venv\Scripts\activate


# macOS/Linux

python -m venv venv

source venv/bin/activate


Install the required Python packages:

pip install -r requirements.txt


Create a .env file in the backend/models directory with your Groq API key:

GROQ_API_KEY=your_api_key_here


Start the backend server:

cd models

venv\scripts\activate

python model_api.py



Extension Setup

Navigate to the extension directory:

cd ../extension


Install the required npm packages:

npm install


Compile the extension:

npm run compile


Launch the extension in development mode:

1.Press F5 in VS Code with the extension folder open

2.Or select "Run Extension" from the Debug menu


Usage
1.Once the extension is running, you'll see the RealTutor AI icon in the Activity Bar.

2.Click on the icon to open the RealTutor AI panel.

3.The panel will automatically connect to the backend server.

4.Start coding, and RealTutor AI will provide assistance in these scenarios:

   1.When you pause for more than 5 seconds on a piece of code
   
   2.When syntax or compilation errors are detected
   
   3.When you manually select code and choose "RealTutor AI: Analyze Code"
   
   
Commands

1.Start RealTutor AI: Activates the RealTutor AI panel

2.RealTutor AI: Analyze Code: Manually analyze selected code or the current file


Project Structure

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

    
Technical Details


Backend

1.Flask: HTTP server for API endpoints

2.WebSockets: For real-time communication (optional)

3.Groq API: Powers the AI model responses

4.LangChain: Framework for working with language models


Extension

1.TypeScript: Main programming language for the extension

2.VS Code API: Integration with editor features

3.Webview API: For displaying the AI assistant panel


Customization

You can customize the behavior of RealTutor AI by modifying:

1.The prompts in realtutor_ai_model.py to adjust the AI's responses

2.The inactivity threshold in extension.ts (default: 5000ms)

3.The model used in realtutor_ai_model.py (default: deepseek-r1-distill-llama-70b)



Troubleshooting

1.Extension not connecting to server: Ensure the backend server is running on port 3001

2.No AI responses: Check if your API key is valid and properly set in the .env file

3.Errors in console: Check the Output panel in VS Code for detailed error messages


Contributing

Contributions are welcome! Please feel free to submit a Pull Request.It will really means a lot❤️❤️


License

This project is licensed under the MIT License - see the LICENSE file for details.

Contact
For questions or support, please contact:

Ritika Gaur: devritika.gaur@gmail.com
Happy coding with your new AI assistant!
