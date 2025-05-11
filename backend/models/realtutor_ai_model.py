from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
import re
import os

class RealTutorAI:
    def __init__(self):
        # Use a single powerful model for better consistency
        # DeepSeek-R1 is good for code explanations and reasoning
        self.model = ChatGroq(
            model="deepseek-r1-distill-llama-70b",
            temperature=0.7,
            max_tokens=500,
            api_key=os.getenv("GROQ_API_KEY")
        )
        
        # Create different prompts for different scenarios
        self.error_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, a helpful coding assistant that explains errors in simple, 
                beginner-friendly language. You not only provide fixes but explain why things work 
                the way they do. Be concise but thorough.
                
                User's code context: {code_context}
                Error message: {error_message}"""
            ),
            ('human', 'Please explain this error in simple terms and suggest how to fix it.')
        ])
        
        self.inactivity_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, a helpful coding assistant. The user has been inactive or 
                stuck on this code for a while. Provide helpful guidance without being intrusive.
                
                User's code context: {code_context}
                Current file: {current_file}
                Recent edits: {recent_edits}"""
            ),
            ('human', 'I notice you might be stuck. Can I help with anything?')
        ])
        
        self.question_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, a helpful coding assistant. \
When the user asks for code, always return the code in a single, clean code block using triple backticks and the correct language (e.g., ```python).\
Do not include extra explanation or comments inside the code block unless they are part of the code.\
If you provide an explanation, put it outside the code block.\
Make sure the code is ready to copy/paste or insert.\n\nUser's code context (from file: {current_file}):\n-----------------\n{code_context}\n-----------------\n\nUser's question: {user_question}\n"""
            ),
            ('human', '{user_question}')
        ])
        
        # Create chains
        self.error_chain = self.error_prompt | self.model
        self.inactivity_chain = self.inactivity_prompt | self.model
        self.question_chain = self.question_prompt | self.model
    
    def explain_error(self, code_context, error_message):
        """Explains an error in simple terms"""
        response = self.error_chain.invoke({
            "code_context": code_context,
            "error_message": error_message
        })
        return self._clean_response(response.content)
    
    def suggest_on_inactivity(self, code_context, current_file, recent_edits):
        """Provides help when user is inactive"""
        response = self.inactivity_chain.invoke({
            "code_context": code_context,
            "current_file": current_file,
            "recent_edits": recent_edits
        })
        return self._clean_response(response.content)
    
    def answer_question(self, code_context, current_file, user_question):
        """Answers a specific user question"""
        response = self.question_chain.invoke({
            "code_context": code_context,
            "current_file": current_file,
            "user_question": user_question
        })
        return self._clean_response(response.content)
    
    def _clean_response(self, response):
        """Cleans up the model response if needed"""
        if "</think>" in response:
            return re.sub(r".*</think>", "", response, flags=re.DOTALL).strip()
        return response

# Create a singleton instance
tutor = RealTutorAI()

# Export functions to be used by the extension
def explain_coding_error(code_context, error_message):
    return tutor.explain_error(code_context, error_message)

def provide_help_on_inactivity(code_context, current_file, recent_edits):
    return tutor.suggest_on_inactivity(code_context, current_file, recent_edits)

def answer_coding_question(code_context, current_file, user_question):
    return tutor.answer_question(code_context, current_file, user_question)