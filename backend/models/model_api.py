from dotenv import load_dotenv
from flask import Flask, request, jsonify
import asyncio
import websockets
import json
import os
import logging
import threading
from flask_cors import CORS  # Add this import


app = Flask(__name__)
CORS(app)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()
from realtutor_ai_model import explain_coding_error, provide_help_on_inactivity, answer_coding_question

# Load API key from environment
api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    logger.error("GROQ_API_KEY not found in environment variables!")

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Use different ports for WebSocket and HTTP
WS_PORT = 3000
HTTP_PORT = 3001

# Root endpoint handler
@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'status': 'RealTutor AI Backend is running',
        'endpoints': {
            'status': 'GET /status',
            'generate': 'POST /generate',
            'analyze': 'POST /analyze',
            'websocket': f'ws://localhost:{WS_PORT}'
        }
    })

# Add a new endpoint for HTTP-based analysis
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    logger.info(f"Received analysis request: {data}")
    try:
        user_message = data.get("userMessage", "")
        code_context = data.get("codeContext", "")
        language = data.get("language", "")
        file_name = data.get("fileName", "unknown")
        project_files = data.get("projectFilesDetailed", [])

        if project_files:
            # Join all file contents for the model (truncate each file to 2000 chars for safety)
            files_summary = "\n\n".join(
                f"File: {f['filename']}\n{f['content'][:2000]}" for f in project_files if 'filename' in f and 'content' in f
            )
            response = answer_coding_question(
                files_summary, "PROJECT", user_message or "Analyze the project and suggest improvements or issues."
            )
        else:
            response = answer_coding_question(code_context, file_name, user_message)

        result = {
            "type": "response",
            "data": {
                "message": response,
                "model": "realtutor-ai"
            }
        }
        logger.info("Successfully generated context-aware response")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error processing analysis: {e}")
        return jsonify({
            "type": "response",
            "data": {
                "message": f"Error analyzing code: {str(e)}",
                "model": "realtutor-ai"
            }
        })

async def process_code_analysis(data):
    code = data.get("text", "")
    language = data.get("language", "")
    error = data.get("error", None)
    file_name = data.get("fileName", "unknown")
    
    try:
        if error:
            # Use your model's error explanation
            response = explain_coding_error(code, error)
        else:
            # Use inactivity suggestion
            response = provide_help_on_inactivity(code, file_name, recent_edits="")
        
        return {
            "type": "response",
            "data": {
                "message": response,
                "model": "realtutor-ai"
            }
        }
    except Exception as e:
        logger.error(f"Error processing analysis: {e}")
        return {
            "type": "response",
            "data": {
                "message": f"Error analyzing code: {str(e)}",
                "model": "realtutor-ai"
            }
        }

async def handle_connection(websocket):
    try:
        logger.info("New client connected")
        await websocket.send(json.dumps({
            "type": "status",
            "data": {
                "connected": True,
                "model": "realtutor-ai"
            }
        }))
        
        async for message in websocket:
            try:
                data = json.loads(message)
                logger.info(f"Received message: {data['type']}")
                
                if data["type"] == "inactivity":
                    response = await process_code_analysis(data["data"])
                    await websocket.send(json.dumps(response))
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse message: {e}")
                await websocket.send(json.dumps({
                    "type": "response",
                    "data": {
                        "message": f"Error: Invalid JSON message",
                        "model": "realtutor-ai"
                    }
                }))
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                await websocket.send(json.dumps({
                    "type": "response",
                    "data": {
                        "message": f"Error: {str(e)}",
                        "model": "realtutor-ai"
                    }
                }))
    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Unexpected error in connection handler: {e}")

async def start_websocket_server():
    logger.info(f"Starting RealTutor AI WebSocket server on ws://localhost:{WS_PORT} ...")
    async with websockets.serve(
        handle_connection,
        "localhost",
        WS_PORT,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=10
    ):
        await asyncio.Future()

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        'status': 'running', 
        'websocket_port': WS_PORT,
        'model': 'realtutor-ai'
    })

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    prompt = data.get('prompt', '')
    
    try:
        # Use your model to generate a response
        response = answer_coding_question(prompt, "", "")
        return jsonify({'response': response})
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        return jsonify({'error': str(e)}), 500

def run_flask_app():
    app.run(host='localhost', port=HTTP_PORT, debug=False)

if __name__ == "__main__":
    # Start Flask in a separate thread
    flask_thread = threading.Thread(target=run_flask_app)
    flask_thread.daemon = True
    flask_thread.start()
    
    # Start WebSocket server in the main thread
    logger.info(f"Starting Flask server on http://localhost:{HTTP_PORT}")
    asyncio.run(start_websocket_server())