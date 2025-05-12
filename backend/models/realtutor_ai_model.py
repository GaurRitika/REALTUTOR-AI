from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
import re
import os
import json
from typing import Dict, List, Optional, Tuple, Any

class RealTutorAI:
    def __init__(self):
        # Use cutting-edge model configuration
        self.model = ChatGroq(
            model="deepseek-r1-distill-llama-70b",  # Using the most powerful available model
            temperature=0.05,  # Ultra-precise responses
            max_tokens=6000,  # Extended context for comprehensive solutions
            top_p=0.92,  # Tightly focused on most probable tokens
           
            api_key=os.getenv("GROQ_API_KEY")
        )
        
        # Professional developer-oriented system prompt
        self.system_prompt = """You are an elite AI coding assistant providing expert-level responses like the most advanced versions of Cursor AI and Highlight. Your outputs are indistinguishable from those of a senior developer.

RESPONSE PROTOCOL:
- Output raw solutions with zero preamble
- Never use phrases like "here's the code" or "this should work"
- No explanatory text unless explicitly requested
- For code solutions, use properly formatted markdown with language tags
- Include complete imports and robust error handling
- Optimize for readability, performance, and modern best practices
- When applicable, use TypeScript over JavaScript, f-strings in Python, async/await patterns
- For complex solutions, structure code with clear component separation
- Keep responses laser-focused on the exact query

Context:
- Code: {code_context}
- File: {current_file}
- Language: {language}
- Query: {user_question}
"""

        # Ultra-specialized prompts for different scenarios
        self.error_prompt = ChatPromptTemplate.from_messages([
            ("system", self.system_prompt + "\n- Error: {error_message}\n- Priority: Fix with minimal changes"),
            ('human', 'Fix this error. Return only the corrected code.')
        ])
        
        self.inactivity_prompt = ChatPromptTemplate.from_messages([
            ("system", self.system_prompt + "\n- Priority: Optimize and modernize"),
            ('human', 'Refactor this code to professional standards. Return only the improved code.')
        ])
        
        self.question_prompt = ChatPromptTemplate.from_messages([
            ("system", self.system_prompt + "\n- Priority: Direct, implementable solution"),
            ('human', '{user_question}')
        ])
        
        self.project_prompt = ChatPromptTemplate.from_messages([
            ("system", self.system_prompt + "\n- Priority: Holistic understanding and architectural improvements"),
            ('human', 'Analyze this project and provide key improvements. Focus on architecture, patterns, and performance.')
        ])
        
        # Create optimized chains
        self.error_chain = self.error_prompt | self.model
        self.inactivity_chain = self.inactivity_prompt | self.model
        self.question_chain = self.question_prompt | self.model
        self.project_chain = self.project_prompt | self.model
        
        # Response cache for performance
        self._cache = {}
        self._cache_limit = 50
    
    def explain_error(self, code_context: str, error_message: str, language: str = "", file_name: str = "") -> str:
        """Provides professional-grade error fixes"""
        cache_key = f"error_{hash(code_context)}_{hash(error_message)}_{language}"
        if cache_key in self._cache:
            return self._cache[cache_key]
            
        try:
            response = self.error_chain.invoke({
                "code_context": self._prepare_context(code_context),
                "error_message": error_message,
                "language": self._detect_language(language, file_name, code_context),
                "current_file": file_name,
                "user_question": f"Fix: {error_message}"
            })
            result = self._process_code_response(response.content, language)
            self._update_cache(cache_key, result)
            return result
        except Exception as e:
            return f"```\n{str(e)}\n```"
    
    def suggest_on_inactivity(self, code_context: str, current_file: str, recent_edits: str, language: str = "") -> str:
        """Provides senior-level code improvements"""
        cache_key = f"improve_{hash(code_context)}_{language}"
        if cache_key in self._cache:
            return self._cache[cache_key]
            
        try:
            detected_lang = self._detect_language(language, current_file, code_context)
            response = self.inactivity_chain.invoke({
                "code_context": self._prepare_context(code_context),
                "current_file": current_file,
                "language": detected_lang,
                "user_question": f"Optimize this {detected_lang} code for production."
            })
            result = self._process_code_response(response.content, detected_lang)
            self._update_cache(cache_key, result)
            return result
        except Exception as e:
            return f"```\n{str(e)}\n```"
    
    def answer_question(self, code_context: str, current_file: str, user_question: str, language: str = "") -> str:
        """Provides expert answers to coding questions"""
        cache_key = f"question_{hash(user_question)}_{hash(code_context[:300])}_{language}"
        if cache_key in self._cache:
            return self._cache[cache_key]
            
        try:
            detected_lang = self._detect_language(language, current_file, code_context)
            response = self.question_chain.invoke({
                "code_context": self._prepare_context(code_context),
                "current_file": current_file,
                "user_question": user_question,
                "language": detected_lang
            })
            result = self._process_response(response.content, user_question)
            self._update_cache(cache_key, result)
            return result
        except Exception as e:
            return f"```\n{str(e)}\n```"
    
    def analyze_project(self, files_data: List[Dict[str, str]]) -> str:
        """Provides professional project-level analysis"""
        try:
            # Prepare project context
            project_summary = []
            for file in files_data[:15]:  # Limit to 15 files for context window
                filename = file.get('filename', 'unknown')
                content = file.get('content', '')[:2000]  # Limit each file content
                lang = self._detect_language('', filename, content)
                project_summary.append(f"File: {filename} ({lang})\n{content}\n---\n")
            
            project_context = "\n".join(project_summary)
            
            response = self.project_chain.invoke({
                "code_context": project_context[:8000],  # Limit total context
                "current_file": "project_overview",
                "language": "multiple",
                "user_question": "Analyze this project and suggest architectural improvements."
            })
            
            return self._process_response(response.content, "project analysis")
        except Exception as e:
            return f"```\n{str(e)}\n```"
    
    def _detect_language(self, language: str, file_name: str, code_snippet: str) -> str:
        """Advanced language detection"""
        if language and language.strip():
            return language.lower()
            
        if file_name:
            ext = file_name.lower().split('.')[-1]
            lang_map = {
                'py': 'python', 'js': 'javascript', 'ts': 'typescript',
                'jsx': 'jsx', 'tsx': 'tsx', 'html': 'html', 'css': 'css',
                'java': 'java', 'cpp': 'cpp', 'c': 'c', 'cs': 'csharp',
                'go': 'go', 'rb': 'ruby', 'php': 'php', 'swift': 'swift',
                'kt': 'kotlin', 'rs': 'rust', 'scala': 'scala'
            }
            if ext in lang_map:
                return lang_map[ext]
        
        # Fallback detection based on code patterns
        if 'def ' in code_snippet and ':' in code_snippet:
            return 'python'
        elif 'function' in code_snippet and '{' in code_snippet:
            if 'import React' in code_snippet or 'jsx' in code_snippet:
                return 'jsx'
            return 'javascript'
        elif 'interface ' in code_snippet or 'type ' in code_snippet:
            return 'typescript'
        elif '<html' in code_snippet.lower():
            return 'html'
        elif '@media' in code_snippet or '{' in code_snippet and ':' in code_snippet:
            return 'css'
        
        return 'text'
    
    def _prepare_context(self, code_context: str) -> str:
        """Optimizes code context for model processing"""
        if not code_context or len(code_context) < 10:
            return code_context
            
        # Truncate if too long but preserve important parts
        if len(code_context) > 8000:
            # Keep first and last parts which often contain important context
            first_part = code_context[:4000]
            last_part = code_context[-3000:]
            return f"{first_part}\n...[truncated]...\n{last_part}"
            
        return code_context
    
    def _process_code_response(self, response: str, language: str) -> str:
        """Process and enhance code responses"""
        # Remove any preamble text
        response = self._clean_response(response)
        
        # Ensure code blocks have language specified
        if "```" in response and not f"```{language}" in response:
            response = response.replace("```", f"```{language}", 1)
            
        # If response doesn't have code blocks but looks like code, add them
        if "```" not in response and any(x in response for x in [';', '()', '{}', 'def ', 'function']):
            response = f"```{language}\n{response}\n```"
            
        return response
    
    def _process_response(self, response: str, query: str) -> str:
        """Process general responses"""
        response = self._clean_response(response)
        
        # If it's a direct question that expects a simple answer, ensure no markdown
        if any(x in query.lower() for x in ['what is', 'how does', 'explain', 'define']):
            if "```" in response and len(response) < 300:
                # This might be a simple explanation wrapped in code block by mistake
                response = response.replace("```", "").replace("python", "").replace("javascript", "")
        
        return response
    
    def _clean_response(self, response: str) -> str:
        """Remove preambles and postambles for direct responses"""
        # Remove common preambles
        response = re.sub(r'^(Here\'s|Here is|I\'ll|I will|Let me|Sure|Certainly|Absolutely|Ok|Okay).*?\n', '', response, flags=re.IGNORECASE|re.DOTALL)
        
        # Remove any concluding text
        response = re.sub(r'\n(This|Hope|Is there|Let me know|Feel free|Do you|Would you|If you|Hope this helps|Does this|That should|This should).*?\$', '', response, flags=re.IGNORECASE|re.DOTALL)
        
        # Remove unnecessary explanations before code blocks
        if "```" in response:
            parts = response.split("```", 1)
            if len(parts) > 1 and len(parts[0].strip()) < 100:
                response = "```" + parts[1]
        
        return response.strip()
    
    def _update_cache(self, key: str, value: str) -> None:
        """Update the response cache with LRU behavior"""
        self._cache[key] = value
        if len(self._cache) > self._cache_limit:
            # Remove oldest item
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

# Create a high-performance singleton instance
tutor = RealTutorAI()

# Export professional-grade functions with clean interfaces
def explain_coding_error(code_context: str, error_message: str, language: str = "", file_name: str = "") -> str:
    return tutor.explain_error(code_context, error_message, language, file_name)

def provide_help_on_inactivity(code_context: str, current_file: str, recent_edits: str, language: str = "") -> str:
    return tutor.suggest_on_inactivity(code_context, current_file, recent_edits, language)

def answer_coding_question(code_context: str, current_file: str, user_question: str, language: str = "") -> str:
    return tutor.answer_question(code_context, current_file, user_question, language)