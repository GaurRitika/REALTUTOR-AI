from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
import re
import os
from typing import Dict, List, Optional

class RealTutorAI:
    def __init__(self):
        # Use a more powerful model configuration
        self.model = ChatGroq(
            model="deepseek-r1-distill-llama-70b",
            temperature=0.3,  # Lower temperature for more focused responses
            max_tokens=2000,  # Increased token limit for more detailed responses
            top_p=0.95,      # Added top_p for better response quality
            api_key=os.getenv("GROQ_API_KEY")
        )
        
        # Enhanced prompts with better context handling
        self.error_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, an expert coding assistant that provides clear, detailed explanations and solutions.
                Your responses should be:
                1. Clear and concise
                2. Include practical examples
                3. Explain the root cause
                4. Provide step-by-step solutions
                5. Include best practices to prevent similar issues
                
                Current context:
                - Code: {code_context}
                - Error: {error_message}
                - Language: {language}
                - File: {file_name}
                
                Format your response as:
                1. Error Analysis: [Brief explanation of the error]
                2. Root Cause: [Why this error occurs]
                3. Solution: [Step-by-step fix]
                4. Prevention: [How to avoid this error]
                5. Example: [Working code example]"""
            ),
            ('human', 'Please help me understand and fix this error.')
        ])
        
        self.inactivity_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, an expert coding assistant that provides proactive guidance.
                Analyze the user's code and provide helpful suggestions based on:
                1. Code quality and best practices
                2. Potential improvements or optimizations
                3. Common pitfalls to avoid
                4. Learning opportunities
                
                Current context:
                - Code: {code_context}
                - File: {current_file}
                - Recent edits: {recent_edits}
                - Language: {language}
                
                Format your response as:
                1. Code Analysis: [Brief overview]
                2. Suggestions: [Specific improvements]
                3. Best Practices: [Relevant guidelines]
                4. Learning Points: [Key concepts to understand]"""
            ),
            ('human', 'I notice you might need some guidance. Here are some suggestions:')
        ])
        
        self.question_prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                """You are RealTutor AI, an expert coding assistant that provides comprehensive, accurate solutions.
                Your responses should be:
                1. Precise and technically accurate
                2. Include practical examples
                3. Follow best practices
                4. Consider performance and security
                
                Current context:
                - Code: {code_context}
                - File: {current_file}
                - Language: {language}
                - Question: {user_question}
                
                When providing code:
                1. Use proper syntax highlighting
                2. Include necessary imports
                3. Add helpful comments
                4. Consider edge cases
                5. Follow language-specific best practices
                
                Format your response as:
                1. Answer: [Direct response to the question]
                2. Explanation: [Detailed explanation]
                3. Code Example: [Working code with comments]
                4. Best Practices: [Relevant guidelines]
                5. Additional Tips: [Helpful suggestions]"""
            ),
            ('human', '{user_question}')
        ])
        
        # Create chains with better error handling
        self.error_chain = self.error_prompt | self.model
        self.inactivity_chain = self.inactivity_prompt | self.model
        self.question_chain = self.question_prompt | self.model
    
    def explain_error(self, code_context: str, error_message: str, language: str = "", file_name: str = "") -> str:
        """Explains an error with enhanced context"""
        try:
            response = self.error_chain.invoke({
                "code_context": code_context,
                "error_message": error_message,
                "language": language,
                "file_name": file_name
            })
            return self._clean_response(response.content)
        except Exception as e:
            return f"Error analyzing code: {str(e)}"
    
    def suggest_on_inactivity(self, code_context: str, current_file: str, recent_edits: str, language: str = "") -> str:
        """Provides enhanced help when user is inactive"""
        try:
            response = self.inactivity_chain.invoke({
                "code_context": code_context,
                "current_file": current_file,
                "recent_edits": recent_edits,
                "language": language
            })
            return self._clean_response(response.content)
        except Exception as e:
            return f"Error providing suggestions: {str(e)}"
    
    def answer_question(self, code_context: str, current_file: str, user_question: str, language: str = "") -> str:
        """Answers questions with enhanced context"""
        try:
            response = self.question_chain.invoke({
                "code_context": code_context,
                "current_file": current_file,
                "user_question": user_question,
                "language": language
            })
            return self._clean_response(response.content)
        except Exception as e:
            return f"Error answering question: {str(e)}"
    
    def _clean_response(self, response: str) -> str:
        """Enhanced response cleaning"""
        # Remove any XML-like tags
        response = re.sub(r'<[^>]+>', '', response)
        
        # Remove any markdown code block markers if they're not properly formatted
        response = re.sub(r'```(?!\w+\n)', '', response)
        
        # Ensure proper spacing
        response = re.sub(r'\n{3,}', '\n\n', response)
        
        # Remove any remaining think tags
        if "</think>" in response:
            response = re.sub(r'.*</think>', '', response, flags=re.DOTALL)
        
        return response.strip()

# Create a singleton instance
tutor = RealTutorAI()

# Export functions with enhanced type hints
def explain_coding_error(code_context: str, error_message: str, language: str = "", file_name: str = "") -> str:
    return tutor.explain_error(code_context, error_message, language, file_name)

def provide_help_on_inactivity(code_context: str, current_file: str, recent_edits: str, language: str = "") -> str:
    return tutor.suggest_on_inactivity(code_context, current_file, recent_edits, language)

def answer_coding_question(code_context: str, current_file: str, user_question: str, language: str = "") -> str:
    return tutor.answer_question(code_context, current_file, user_question, language)