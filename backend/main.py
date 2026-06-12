import os
import json
import time
import uuid
import datetime
import requests
import bcrypt
import random
import smtplib
from email.mime.text import MIMEText
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status, BackgroundTasks, Request
from contextvars import ContextVar
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from groq import Groq
from groq import GroqError, RateLimitError, InternalServerError, APIConnectionError
from pymongo import MongoClient, DESCENDING
from pymongo.errors import ConnectionFailure
from concurrent.futures import ThreadPoolExecutor

# Load environment variables from .env file
load_dotenv()

def log_debug(message: str):
    try:
        print(f"[DEBUG] {message}")
        log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ethrix_debug.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
    except Exception as e:
        print(f"[DEBUG ERROR] Failed to write log: {e}")

# MongoDB Connection Setup
db_client = None
users_collection = None
chat_sessions_collection = None

mongodb_url = os.getenv("MONGODB_URL")
if not mongodb_url or "<db_password>" in mongodb_url:
    log_debug("WARNING: MONGODB_URL is missing or contains placeholder '<db_password>'. Auth database will not be connected.")
else:
    try:
        db_client = MongoClient(mongodb_url, serverSelectionTimeoutMS=5000)
        # Test connection
        db_client.admin.command('ping')
        db = db_client["ethrix_db"]
        users_collection = db["users"]
        # Create unique index on email
        users_collection.create_index("email", unique=True)
        # Initialize chat sessions collection with indexes
        chat_sessions_collection = db["chat_sessions"]
        chat_sessions_collection.create_index("session_id", unique=True)
        chat_sessions_collection.create_index([("email", 1), ("updated_at", DESCENDING)])
        log_debug("Successfully connected to MongoDB and verified index.")
    except Exception as e:
        log_debug(f"Failed to connect to MongoDB: {str(e)}")
        db_client = None
# Backend Chunking Helpers for Large Files
def chunk_code_backend(code: str, chunk_size: int = 300) -> list:
    """Split code into a list of non-overlapping chunks for large file handling."""
    lines = code.splitlines(keepends=True)
    if len(lines) <= chunk_size:
        return [code]
    
    chunks = []
    for i in range(0, len(lines), chunk_size):
        chunk_lines = lines[i : i + chunk_size]
        chunks.append("".join(chunk_lines))
    return chunks

def adjust_line_number(line_val, offset: int) -> str:
    """Adjust line number string/int dynamically based on chunk offset."""
    if not line_val or offset == 0:
        return line_val
    
    # Try parsing as simple integer
    try:
        return str(int(line_val) + offset)
    except ValueError:
        pass
    
    # Try parsing range like "12-15" or "12 to 15"
    import re
    range_match = re.match(r'^(\d+)\s*(?:-|to)\s*(\d+)$', str(line_val).strip())
    if range_match:
        try:
            start = int(range_match.group(1)) + offset
            end = int(range_match.group(2)) + offset
            return f"{start}-{end}"
        except ValueError:
            pass
            
    # Fallback: just return original
    return line_val

# Password Hashing Helpers
def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password.encode('utf-8')
    hashed_bytes = hashed_password.encode('utf-8')
    try:
        return bcrypt.checkpw(pwd_bytes, hashed_bytes)
    except Exception:
        return False

# SMTP Email Verification Helper
def send_email_sync(to_email: str, subject: str, body_html: str):
    sender = os.getenv("SMTP_SENDER_EMAIL")
    password = os.getenv("SMTP_SENDER_PASSWORD")
    
    if not sender or not password or "your-gmail" in sender:
        log_debug("WARNING: SMTP credentials not configured. Verification email was skipped.")
        return
        
    msg = MIMEText(body_html, 'html')
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email
    
    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(sender, password)
            server.sendmail(sender, to_email, msg.as_string())
        log_debug(f"Verification email sent successfully to {to_email}")
    except Exception as e:
        log_debug(f"SMTP error sending email to {to_email}: {str(e)}")

def query_ollama(messages, model: str, json_mode: bool = False):
    url = "http://127.0.0.1:11434/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False
    }
    if json_mode:
        payload["format"] = "json"
        
    try:
        response = requests.post(url, json=payload, timeout=300.0)  # 5 min — local models can be slow
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama API Error (Status {response.status_code}): {response.text}"
            )
        data = response.json()
        return data["message"]["content"]
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not connect to local Ollama service. Please make sure Ollama is installed and running locally on http://127.0.0.1:11434."
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred while querying Ollama: {str(e)}"
        )

groq_api_key_var: ContextVar[Optional[str]] = ContextVar("groq_api_key", default=None)

def get_groq_client() -> Groq:
    api_key = groq_api_key_var.get() or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GROQ_API_KEY is not set. Please set your Groq API Key in the Integrations settings."
        )
    return Groq(api_key=api_key)

def query_groq_with_retry(messages, model: str = "llama-3.3-70b-versatile", response_format=None, retries: int = 2, delay: float = 1.0):
    client = get_groq_client()
    
    # Define fallback models for standard chat queries
    fallback_models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct"]
    if model not in fallback_models:
        fallback_models = [model] + fallback_models
    else:
        fallback_models.remove(model)
        fallback_models.insert(0, model)
        
    last_error = None
    for current_model in fallback_models:
        log_debug(f"Attempting query with Groq model: {current_model}")
        for attempt in range(retries):
            try:
                completion = client.chat.completions.create(
                    messages=messages,
                    model=current_model,
                    response_format=response_format,
                    max_tokens=4096,
                )
                log_debug(f"Successfully queried with Groq model: {current_model}")
                return completion.choices[0].message.content
            except (RateLimitError, APIConnectionError) as e:
                last_error = e
                log_debug(f"RateLimit/Connection error on model {current_model}: {str(e)}. Switching to fallback...")
                break # Switch to next model immediately
            except InternalServerError as e:
                last_error = e
                sleep_time = delay * (2.0 ** attempt)
                time.sleep(sleep_time)
                continue
            except GroqError as e:
                last_error = e
                error_msg = str(e)
                if "rate_limit" in error_msg.lower() or "429" in error_msg or "limit reached" in error_msg.lower():
                    log_debug(f"GroqError (rate limit) on model {current_model}: {error_msg}. Switching to fallback...")
                    break # Switch to next model immediately
                else:
                    log_debug(f"GroqError on model {current_model}: {error_msg}. Attempting fallback...")
                    break
                    
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"All Groq fallback models failed (due to rate limits: {str(last_error)}). Please switch to Offline Mode (local LLM via Ollama) using the '/mode' or '/config' command to run without rate limits!"
    )


def parse_json_robust(content: str) -> dict:
    """Robustly extract a JSON object from model output.
    
    Local models (qwen2.5-coder, granite, llama) often wrap JSON in:
    - ```json ... ``` fences
    - Explanation text before/after
    - Single-quotes instead of double-quotes
    
    Tries in order:
    1. Direct parse
    2. Strip markdown fences, retry
    3. Regex-extract first {...} block, retry
    4. Raise ValueError with detail
    """
    if not content or not content.strip():
        raise ValueError("Empty response from model.")

    # 1. Direct parse
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # 2. Strip ```json ... ``` or ``` ... ``` fences
    stripped = content.strip()
    if stripped.startswith("```"):
        # Remove first line (``` or ```json) and last ``` line
        lines = stripped.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # 3. Safe O(n) scan: find first '{' ... last '}' — NO regex to avoid stack overflow
    first_brace = content.find("{")
    last_brace  = content.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidate = content[first_brace: last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # 4. Give up
    log_debug(f"parse_json_robust failed. Raw content (first 500 chars): {content[:500]}")
    raise ValueError(
        f"Model returned invalid/non-JSON output. First 300 chars: {content[:300]}"
    )



def local_read_file(path: str) -> str:
    if not path:
        return "Error: 'path' parameter is required. Please specify a valid file path."
    
    target_path = path
    if not os.path.exists(target_path) or not os.path.isfile(target_path):
        # Fuzzy fallback search: walk directory recursively to find the filename
        file_name = os.path.basename(path)
        if "." in file_name:
            ignore_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", "build", "dist", ".gemini"}
            found_path = None
            for root, dirs, files in os.walk("."):
                dirs[:] = [d for d in dirs if d not in ignore_dirs]
                if file_name in files:
                    found_path = os.path.join(root, file_name)
                    break
            if found_path:
                target_path = found_path

    try:
        with open(target_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file '{path}': {str(e)}"

def local_write_file(path: str, content: str) -> str:
    if not path:
        return "Error: 'path' parameter is required. Please specify a valid target file path."
    if content is None:
        return "Error: 'content' parameter is required. Please specify the text content to write."
        
    target_path = path
    if not os.path.exists(target_path) or not os.path.isfile(target_path):
        file_name = os.path.basename(path)
        if "." in file_name:
            ignore_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", "build", "dist", ".gemini"}
            found_path = None
            for root, dirs, files in os.walk("."):
                dirs[:] = [d for d in dirs if d not in ignore_dirs]
                if file_name in files:
                    found_path = os.path.join(root, file_name)
                    break
            if found_path:
                target_path = found_path

    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Success: Wrote content to file '{target_path}' successfully."
    except Exception as e:
        return f"Error writing to file '{path}': {str(e)}"

def local_list_directory(path: str = ".") -> str:
    try:
        items = os.listdir(path)
        result = []
        for item in items:
            is_dir = "Dir" if os.path.isdir(os.path.join(path, item)) else "File"
            size = ""
            if is_dir == "File":
                try:
                    size = f" ({os.path.getsize(os.path.join(path, item))} bytes)"
                except Exception:
                    pass
            result.append(f"- {item} [{is_dir}]{size}")
        return "\n".join(result) if result else "Directory is empty."
    except Exception as e:
        return f"Error listing directory '{path}': {str(e)}"

def local_grep_search(query: str, path: str = ".") -> str:
    try:
        results = []
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__pycache__"]
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for idx, line in enumerate(f, start=1):
                            if query.lower() in line.lower():
                                results.append(f"{file_path}:{idx}: {line.strip()}")
                except Exception:
                    pass
                if len(results) >= 50:
                    break
            if len(results) >= 50:
                break
        return "\n".join(results) if results else f"No matches found for '{query}'."
    except Exception as e:
        return f"Error performing grep search: {str(e)}"

FILESYSTEM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a local file in the workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to the file to read (relative to workspace)."
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or overwrite the contents of a local file in the workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to the file to write (relative to workspace)."
                    },
                    "content": {
                        "type": "string",
                        "description": "The complete text content to write into the file."
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List all files and folders in a specific directory path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to list (default is '.')."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "grep_search",
            "description": "Search for a specific text pattern inside all files recursively.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The text pattern/string to search for."
                    },
                    "path": {
                        "type": "string",
                        "description": "The directory path to start the search from (default is '.')."
                    }
                },
                "required": ["query"]
            }
        }
    }
]

def query_groq_with_tools(messages, model: str = "llama-3.3-70b-versatile"):
    client = get_groq_client()
    executed_tools = []
    
    # Models that support tool calling on Groq
    tool_models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    if model not in tool_models:
        tool_models = [model] + tool_models
    else:
        tool_models.remove(model)
        tool_models.insert(0, model)
        
    log_debug(f"Querying Groq with tools. Available models: {tool_models}. Message count: {len(messages)}")
    
    model_idx = 0
    active_model = tool_models[model_idx]
    
    for attempt in range(5):
        completion = None
        while model_idx < len(tool_models):
            active_model = tool_models[model_idx]
            try:
                completion = client.chat.completions.create(
                    messages=messages,
                    model=active_model,
                    tools=FILESYSTEM_TOOLS,
                    tool_choice="auto",
                    max_tokens=4096,
                )
                break
            except Exception as e:
                error_msg = str(e)
                log_debug(f"Exception on model {active_model} during tool loop: {error_msg}. Switching to next tool model...")
                model_idx += 1
                
        if completion is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="All Groq tool models failed due to rate limits or API errors. Please switch to Offline Mode (local LLM via Ollama) using the '/mode' or '/config' command to run without rate limits!"
            )
            
        response_message = completion.choices[0].message
        
        # Log LLM output
        log_debug(f"Attempt {attempt} response (model: {active_model}). content: {response_message.content[:100] if response_message.content else 'None'}, tool_calls: {len(response_message.tool_calls) if response_message.tool_calls else 0}")
        
        if not response_message.tool_calls:
            return response_message.content or ""
            
        msg_dict = {
            "role": "assistant",
            "content": response_message.content,
        }
        msg_dict["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments
                }
            } for tc in response_message.tool_calls
        ]
        messages.append(msg_dict)
        
        for tool_call in response_message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            executed_tools.append(f"{function_name}({json.dumps(function_args)})")
            
            log_debug(f"Executing local tool {function_name} with args {function_args}")
            
            if function_name == "read_file":
                result = local_read_file(function_args.get("path"))
            elif function_name == "write_file":
                result = local_write_file(function_args.get("path"), function_args.get("content"))
            elif function_name == "list_directory":
                result = local_list_directory(function_args.get("path", "."))
            elif function_name == "grep_search":
                result = local_grep_search(function_args.get("query"), function_args.get("path", "."))
            else:
                result = f"Error: Tool '{function_name}' not found."
                
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "name": function_name,
                "content": result,
            })
            
    if executed_tools:
        return "I have executed the following actions locally:\n" + "\n".join([f"- [x] Call `{t}`" for t in executed_tools])
        
    return ""

def query_ollama_with_tools(messages, model: str):
    url = "http://127.0.0.1:11434/api/chat"
    executed_tools = []
    
    log_debug(f"Querying Ollama (model: {model}) with tools. Message count: {len(messages)}")
    
    for attempt in range(5):
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "tools": FILESYSTEM_TOOLS
        }
        try:
            response = requests.post(url, json=payload, timeout=300.0)  # 5 min for large local models
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Ollama API Error (Status {response.status_code}): {response.text}"
                )
            data = response.json()
            response_msg = data["message"]
            
            # Log LLM output
            log_debug(f"Ollama Attempt {attempt} response. content: {response_msg.get('content')[:100] if response_msg.get('content') else 'None'}, tool_calls: {len(response_msg.get('tool_calls')) if response_msg.get('tool_calls') else 0}")
            
            tool_calls = response_msg.get("tool_calls")
            content = response_msg.get("content", "") or ""

            # ── Hallucinated tool call detection ─────────────────────────────
            # Some smaller models (e.g. qwen2.5-coder) output JSON tool calls
            # as plain text instead of using the structured tool_calls field.
            # Detect and execute them so the user never sees raw JSON.
            if not tool_calls and content:
                import re as _re
                # Match patterns like {"name": "list_directory", "arguments": {...}}
                json_tool_match = _re.search(
                    r'\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"arguments"\s*:\s*(\{[^{}]*\})[^{}]*\}',
                    content, _re.DOTALL
                )
                if json_tool_match:
                    try:
                        fn_name = json_tool_match.group(1)
                        fn_args = json.loads(json_tool_match.group(2))
                        log_debug(f"Detected hallucinated tool call in text: {fn_name}({fn_args})")
                        if fn_name == "read_file":
                            result = local_read_file(fn_args.get("path"))
                        elif fn_name == "write_file":
                            result = local_write_file(fn_args.get("path"), fn_args.get("content"))
                        elif fn_name == "list_directory":
                            result = local_list_directory(fn_args.get("path", "."))
                        elif fn_name == "grep_search":
                            result = local_grep_search(fn_args.get("query"), fn_args.get("path", "."))
                        else:
                            result = None
                        if result:
                            executed_tools.append(f"{fn_name}({json.dumps(fn_args)})")
                            # Inject result back and re-query
                            messages.append(response_msg)
                            messages.append({"role": "tool", "content": result})
                            continue  # re-loop so model can respond with result
                    except (json.JSONDecodeError, AttributeError):
                        pass  # Not a parseable tool call, fall through normally

            if not tool_calls:
                return content

                
            messages.append(response_msg)
            
            for tool_call in tool_calls:
                function_name = tool_call["function"]["name"]
                function_args = tool_call["function"]["arguments"]
                executed_tools.append(f"{function_name}({json.dumps(function_args)})")
                
                log_debug(f"Executing local Ollama tool {function_name} with args {function_args}")
                
                if function_name == "read_file":
                    result = local_read_file(function_args.get("path"))
                elif function_name == "write_file":
                    result = local_write_file(function_args.get("path"), function_args.get("content"))
                elif function_name == "list_directory":
                    result = local_list_directory(function_args.get("path", "."))
                elif function_name == "grep_search":
                    result = local_grep_search(function_args.get("query"), function_args.get("path", "."))
                else:
                    result = f"Error: Tool '{function_name}' not found."
                    
                messages.append({
                    "role": "tool",
                    "content": result,
                })
        except requests.exceptions.ConnectionError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not connect to local Ollama service. Please make sure Ollama is installed and running locally on http://127.0.0.1:11434."
            )
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred while querying Ollama: {str(e)}"
            )
            
    if executed_tools:
        return "I have executed the following actions locally:\n" + "\n".join([f"- [x] Call `{t}`" for t in executed_tools])
        
    return ""




app = FastAPI(
    title="Ethrix-Forge Core AI Server",
    description="Backend API for AI-based code review, refactoring, and documentation generation.",
    version="1.0.0",
)

# Enable CORS for frontend integrations (web dashboard, VS Code extension, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def extract_groq_api_key(request: Request, call_next):
    # Retrieve the custom header
    api_key = request.headers.get("X-Groq-API-Key")
    # Set the ContextVar
    token = groq_api_key_var.set(api_key if api_key else None)
    try:
        response = await call_next(request)
        return response
    finally:
        groq_api_key_var.reset(token)

# Auth Payloads
class SignupPayload(BaseModel):
    name: str
    email: str
    password: str

class VerifyPayload(BaseModel):
    email: str
    code: str

class LoginPayload(BaseModel):
    email: str
    password: str

class ResendPayload(BaseModel):
    email: str

# Chat History Models
class ChatHistoryMessage(BaseModel):
    role: str = Field(description="'user' or 'model'")
    text: str = Field(description="Message content")
    ts: Optional[str] = Field(None, description="ISO timestamp of the message")

class ChatSavePayload(BaseModel):
    email: str = Field(description="User email — used as the key")
    session_id: str = Field(description="UUID identifying this chat session")
    title: Optional[str] = Field(None, description="Short session title (first user message, truncated)")
    messages: List[ChatHistoryMessage] = Field(description="Full ordered list of messages in the session")

# Request Payloads
class CodePayload(BaseModel):
    code: str
    language: Optional[str] = Field(None, description="Programming language of the code snippet")
    provider: Optional[str] = Field("online", description="Model provider: 'online' or 'offline'")
    model: Optional[str] = Field(None, description="Model identifier to use")

# Response Schemas for Structured JSON outputs
class BugDetail(BaseModel):
    line_number: Optional[str] = Field(None, description="The line number or line range where the bug occurs")
    severity: str = Field(description="Severity of the bug: Low, Medium, or High")
    description: str = Field(description="Detailed description of the logical bug or error")
    suggestion: str = Field(description="Explanation on how to resolve the bug")

class SecurityRiskDetail(BaseModel):
    line_number: Optional[str] = Field(None, description="The line number or line range where the security risk is located")
    severity: str = Field(description="Severity of the security risk: Low, Medium, or High")
    description: str = Field(description="Detailed description of the security vulnerability")
    remediation: str = Field(description="Remediation steps or secure code snippet")

class AnalysisResponse(BaseModel):
    bugs: List[BugDetail] = Field(default=[], description="List of logical bugs and errors found in the code")
    security_risks: List[SecurityRiskDetail] = Field(default=[], description="List of security vulnerabilities and risks found in the code")
    raw_markdown_report: str = Field(description="A beautifully formatted markdown report summarizing the review findings")

class FixResponse(BaseModel):
    refactored_code: str = Field(description="The fully corrected and optimized version of the input code")
    explanation: str = Field(description="Detailed step-by-step explanation of the optimizations and corrections made")

class DocGenResponse(BaseModel):
    architecture_overview: str = Field(description="High-level architectural overview or Mermaid flow diagram")
    api_reference: str = Field(description="Markdown table of functions/classes, parameters, and descriptions")
    usage_examples: str = Field(description="Code examples showing how to import and use the code")
    documented_code: str = Field(description="The input code modified to include high-quality inline comments and Google/Sphinx style docstrings")
    commit_message: str = Field(description="A concise, conventional git commit message summarizing the changes")


@app.head("/")
@app.get("/")
async def health_check():
    api_key_status = "configured" if (groq_api_key_var.get() or os.getenv("GROQ_API_KEY")) else "missing"
    return {
        "status": "healthy",
        "groq_api_key": api_key_status,
        "message": "Ethrix Core server (Groq Backend) is running!"
    }


@app.get("/ping")
async def ping_endpoint():
    return "ok"


# ─── Chat History Endpoints ─────────────────────────────────────────────────

@app.post("/chat/save")
async def save_chat_session(payload: ChatSavePayload):
    """Upsert a chat session for a user. Creates or fully replaces the session's messages."""
    if chat_sessions_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MongoDB is not configured. Chat history is unavailable."
        )
    email = payload.email.strip().lower()
    now = datetime.datetime.utcnow()

    # Build the message list with timestamps
    messages_to_save = []
    for m in payload.messages:
        messages_to_save.append({
            "role": m.role,
            "text": m.text,
            "ts": m.ts or now.isoformat()
        })

    # Auto-generate title from first user message if not provided
    title = payload.title
    if not title:
        for m in messages_to_save:
            if m["role"] == "user":
                title = m["text"][:60].strip()
                if len(m["text"]) > 60:
                    title += "…"
                break
    title = title or "Untitled Session"

    result = chat_sessions_collection.update_one(
        {"session_id": payload.session_id},
        {
            "$set": {
                "email": email,
                "session_id": payload.session_id,
                "title": title,
                "updated_at": now,
                "messages": messages_to_save,
            },
            "$setOnInsert": {
                "created_at": now
            }
        },
        upsert=True
    )
    return {"status": "ok", "session_id": payload.session_id, "title": title}


@app.get("/chat/history")
async def get_chat_history(email: str):
    """Return all chat sessions for a user, sorted by most recent first."""
    if chat_sessions_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MongoDB is not configured. Chat history is unavailable."
        )
    email = email.strip().lower()
    sessions = list(
        chat_sessions_collection.find(
            {"email": email},
            {"_id": 0, "email": 0}
        ).sort("updated_at", DESCENDING).limit(100)
    )
    return {"sessions": sessions}


@app.delete("/chat/history/{session_id}")
async def delete_chat_session(session_id: str, email: str):
    """Delete a specific chat session (verified by email)."""
    if chat_sessions_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MongoDB is not configured. Chat history is unavailable."
        )
    email = email.strip().lower()
    result = chat_sessions_collection.delete_one({"session_id": session_id, "email": email})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    return {"status": "deleted", "session_id": session_id}


# Helper to check database connectivity
def check_db_ready():
    if users_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MongoDB Connection is not configured or failed to initialize. Please configure a valid MONGODB_URL in backend/.env."
        )

@app.post("/auth/signup")
async def auth_signup(payload: SignupPayload, background_tasks: BackgroundTasks):
    check_db_ready()
    
    email = payload.email.strip().lower()
    name = payload.name.strip()
    password = payload.password
    
    if not name or not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name, email, and password are required."
        )
        
    # Check if user already exists
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        if existing_user.get("verified", False):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email address is already registered."
            )
        # If exists but unverified, we can update password/name, generate new code, and resend
        hashed = hash_password(password)
        code = f"{random.randint(100000, 999999)}"
        expires_at = time.time() + 600.0 # 10 mins
        
        users_collection.update_one(
            {"email": email},
            {"$set": {
                "name": name,
                "password_hash": hashed,
                "verification_code": code,
                "verification_expires_at": expires_at
            }}
        )
    else:
        # Create new unverified user
        hashed = hash_password(password)
        code = f"{random.randint(100000, 999999)}"
        expires_at = time.time() + 600.0 # 10 mins
        
        try:
            users_collection.insert_one({
                "name": name,
                "email": email,
                "password_hash": hashed,
                "verified": False,
                "verification_code": code,
                "verification_expires_at": expires_at
            })
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error during registration: {str(e)}"
            )
            
    # Send verification email in background
    email_html = f"""
    <div style="background-color: #0b0f19; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; text-align: center; color: #f8fafc; border-radius: 16px;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #111827; border: 1px solid rgba(124, 58, 237, 0.25); border-radius: 16px; padding: 32px; text-align: left; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.4);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="font-size: 26px; font-weight: 800; margin: 0; color: #ffffff; letter-spacing: -0.02em;">
            Ethrix<span style="color: #8b5cf6;">Forge</span>
          </h2>
          <p style="font-size: 10px; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; margin-top: 4px; margin-bottom: 0;">AI-Powered Code Reviewer</p>
        </div>
        
        <h3 style="font-size: 18px; font-weight: 700; color: #ffffff; margin-top: 0; margin-bottom: 12px; text-align: center;">Welcome to Ethrix Forge!</h3>
        
        <p style="font-size: 13.5px; line-height: 1.6; color: #cbd5e1; margin-top: 0; margin-bottom: 20px;">
          Hi {name},<br><br>
          Thank you for creating an account with Ethrix Forge! To complete your sign-up and start analyzing, optimizing, and refactoring your codebase with AI, please verify your email using this 6-digit code:
        </p>
        
        <div style="background: linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(59, 130, 246, 0.12)); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 30px; font-weight: 800; letter-spacing: 6px; color: #a78bfa; font-family: 'Courier New', Courier, monospace; display: block; padding-left: 6px;">{code}</span>
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 24px; text-align: center;">
          This verification code is valid for 10 minutes.
        </p>
        
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="https://ethrix-forge.vercel.app" target="_blank" style="background-color: #7c3aed; color: #ffffff; padding: 12px 24px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(124, 58, 237, 0.2);">
            Launch Ethrix Studio
          </a>
        </div>
        
        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 24px 0;" />
        
        <div style="text-align: center;">
          <p style="font-size: 12px; margin: 0; color: #94a3b8; font-weight: 500;">
            Built by <span style="color: #ffffff; font-weight: bold;">Team Titans 4</span>
          </p>
          <p style="font-size: 10px; margin: 4px 0 0 0; color: #475569; font-family: monospace;">
            &copy; 2026 Ethrix Forge. All rights reserved.
          </p>
        </div>
      </div>
    </div>
    """
    background_tasks.add_task(
        send_email_sync,
        to_email=email,
        subject="Verify your Ethrix Forge Account",
        body_html=email_html
    )
    
    return {"status": "verification_required", "message": "Verification code sent to your email."}

@app.post("/auth/verify")
async def auth_verify(payload: VerifyPayload):
    check_db_ready()
    
    email = payload.email.strip().lower()
    code = payload.code.strip()
    
    user = users_collection.find_one({"email": email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
        
    if user.get("verified", False):
        return {"status": "success", "message": "Email is already verified.", "name": user["name"], "email": user["email"]}
        
    expires_at = user.get("verification_expires_at", 0)
    if time.time() > expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please request a new one."
        )
        
    if user.get("verification_code") != code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code."
        )
        
    # Mark user as verified
    users_collection.update_one(
        {"email": email},
        {"$set": {"verified": True}, "$unset": {"verification_code": "", "verification_expires_at": ""}}
    )
    
    return {"status": "success", "message": "Email verified successfully!", "name": user["name"], "email": user["email"]}

@app.post("/auth/login")
async def auth_login(payload: LoginPayload):
    check_db_ready()
    
    email = payload.email.strip().lower()
    password = payload.password
    
    user = users_collection.find_one({"email": email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or password."
        )
        
    if not verify_password(password, user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or password."
        )
        
    if not user.get("verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="unverified"
        )
        
    return {
        "status": "success",
        "message": "Login successful!",
        "name": user["name"],
        "email": user["email"]
    }

@app.post("/auth/resend")
async def auth_resend(payload: ResendPayload, background_tasks: BackgroundTasks):
    check_db_ready()
    
    email = payload.email.strip().lower()
    
    user = users_collection.find_one({"email": email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
        
    if user.get("verified", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is already verified."
        )
        
    code = f"{random.randint(100000, 999999)}"
    expires_at = time.time() + 600.0 # 10 mins
    
    users_collection.update_one(
        {"email": email},
        {"$set": {"verification_code": code, "verification_expires_at": expires_at}}
    )
    
    # Send email in background
    email_html = f"""
    <div style="background-color: #0b0f19; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; text-align: center; color: #f8fafc; border-radius: 16px;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #111827; border: 1px solid rgba(124, 58, 237, 0.25); border-radius: 16px; padding: 32px; text-align: left; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.4);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="font-size: 26px; font-weight: 800; margin: 0; color: #ffffff; letter-spacing: -0.02em;">
            Ethrix<span style="color: #8b5cf6;">Forge</span>
          </h2>
          <p style="font-size: 10px; color: #8b5cf6; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; margin-top: 4px; margin-bottom: 0;">AI-Powered Code Reviewer</p>
        </div>
        
        <h3 style="font-size: 18px; font-weight: 700; color: #ffffff; margin-top: 0; margin-bottom: 12px; text-align: center;">New Verification Code</h3>
        
        <p style="font-size: 13.5px; line-height: 1.6; color: #cbd5e1; margin-top: 0; margin-bottom: 20px;">
          Hi {user['name']},<br><br>
          You requested a new verification code. To verify your email and activate your Ethrix Forge account, please enter the following 6-digit code:
        </p>
        
        <div style="background: linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(59, 130, 246, 0.12)); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 30px; font-weight: 800; letter-spacing: 6px; color: #a78bfa; font-family: 'Courier New', Courier, monospace; display: block; padding-left: 6px;">{code}</span>
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 24px; text-align: center;">
          This verification code is valid for 10 minutes.
        </p>
        
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="https://ethrix-forge.vercel.app" target="_blank" style="background-color: #7c3aed; color: #ffffff; padding: 12px 24px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(124, 58, 237, 0.2);">
            Launch Ethrix Studio
          </a>
        </div>
        
        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 24px 0;" />
        
        <div style="text-align: center;">
          <p style="font-size: 12px; margin: 0; color: #94a3b8; font-weight: 500;">
            Built by <span style="color: #ffffff; font-weight: bold;">Team Titans 4</span>
          </p>
          <p style="font-size: 10px; margin: 4px 0 0 0; color: #475569; font-family: monospace;">
            &copy; 2026 Ethrix Forge. All rights reserved.
          </p>
        </div>
      </div>
    </div>
    """
    background_tasks.add_task(
        send_email_sync,
        to_email=email,
        subject="New Verification Code - Ethrix Forge",
        body_html=email_html
    )
    
    return {"status": "success", "message": "New verification code sent."}


@app.post("/shutdown")
async def shutdown(background_tasks: BackgroundTasks):
    import signal
    def terminate():
        time.sleep(0.5)
        log_debug("Shutting down backend server process...")
        os.kill(os.getpid(), signal.SIGTERM)
    background_tasks.add_task(terminate)
    return {"message": "Shutting down server..."}


def process_analyze_chunk(idx: int, chunk: str, payload: CodePayload, system_instruction: str, lang_info: str, total_lines: int, api_key: Optional[str]):
    # Propagate ContextVar to the worker thread
    groq_api_key_var.set(api_key)
    offset = idx * 300
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": f"Analyze the following code snippet{lang_info}:\n\n```\n{chunk}\n```"}
    ]
    try:
        log_debug(f"[analyze] chunk {idx+1} provider={payload.provider} model={payload.model} code_len={len(chunk)}")
        if payload.provider == "offline":
            content = query_ollama(
                messages=messages,
                model=payload.model or "llama3",
                json_mode=True
            )
        else:
            content = query_groq_with_retry(
                messages=messages,
                response_format={"type": "json_object"}
            )
        
        data = parse_json_robust(content)
        
        # Adjust line numbers for bugs and security risks
        chunk_bugs = data.get("bugs", [])
        for bug in chunk_bugs:
            if "line_number" in bug:
                bug["line_number"] = adjust_line_number(bug["line_number"], offset)
        
        chunk_risks = data.get("security_risks", [])
        for risk in chunk_risks:
            if "line_number" in risk:
                risk["line_number"] = adjust_line_number(risk["line_number"], offset)
        
        chunk_md = data.get("raw_markdown_report") or data.get("report") or data.get("markdown_report") or data.get("markdown") or data.get("markdown_text") or ""
        start_line = offset + 1
        end_line = min(offset + 300, total_lines)
        report_text = f"### Section: Lines {start_line} to {end_line}\n\n{chunk_md}" if chunk_md else ""
        
        return chunk_bugs, chunk_risks, report_text, None
    except Exception as e:
        import traceback
        log_debug(f"[analyze] chunk {idx+1} EXCEPTION: {type(e).__name__}: {str(e)}\n{traceback.format_exc()[:600]}")
        start_line = offset + 1
        end_line = min(offset + 300, total_lines)
        err_report = f"### Section: Lines {start_line} to {end_line}\n\n⚠️ Failed to analyze this section: {str(e)}"
        return [], [], err_report, e


@app.post("/analyze", response_model=AnalysisResponse)
def analyze_code(payload: CodePayload):
    lang_info = f" in {payload.language}" if payload.language else ""
    
    system_instruction = (
        "You are an elite automated code reviewer. Analyze the provided code snippet for syntax errors, logic flaws, memory leaks, unhandled edge cases, and performance bottlenecks. "
        "Also, scan the code for security risks (e.g., hardcoded credentials, SQL injection, XSS, command injection, insecure dependencies). "
        "You MUST return your response strictly as a JSON object matching the following structure:\n"
        "{\n"
        '  "bugs": [\n'
        '    {"line_number": "optional line number/range string", "severity": "Low/Medium/High", "description": "issue description", "suggestion": "remediation suggestion"}\n'
        "  ],\n"
        '  "security_risks": [\n'
        '    {"line_number": "optional line number/range string", "severity": "Low/Medium/High", "description": "risk description", "remediation": "remediation steps"}\n'
        "  ],\n"
        '  "raw_markdown_report": "A beautifully formatted markdown report summarizing the review findings in detail using headings, tables, bold text, and syntax-highlighted code blocks."\n'
        "}\n\n"
        "CRITICAL JSON ESCAPING RULE:\n"
        "All double quotes (\") inside any JSON string values (including code snippets and descriptions) MUST be escaped with a single backslash (e.g., \\\").\n"
        "DO NOT use double-escaped backslashes (like \\\\\") or quadruple backslashes (like \\\\\\\"). Ensure that the generated response is standard, valid JSON."
    )

    chunks = chunk_code_backend(payload.code, chunk_size=300)
    total_lines = len(payload.code.splitlines())
    api_key = groq_api_key_var.get()
    
    # Run chunks concurrently in ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(len(chunks), 8)) as executor:
        futures = [
            executor.submit(
                process_analyze_chunk,
                idx, chunk, payload, system_instruction, lang_info, total_lines, api_key
            )
            for idx, chunk in enumerate(chunks)
        ]
        results = [f.result() for f in futures]
        
    all_bugs = []
    all_security_risks = []
    markdown_reports = []
    
    for idx, (bugs, risks, report_text, err) in enumerate(results):
        if err and len(chunks) == 1:
            if isinstance(err, HTTPException):
                raise err
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred during analysis: {str(err)}"
            )
        all_bugs.extend(bugs)
        all_security_risks.extend(risks)
        if report_text:
            markdown_reports.append(report_text)
            
    if markdown_reports:
        combined_md = "\n\n---\n\n".join(markdown_reports)
    else:
        # Fallback report generation if no raw_markdown_report was returned by the LLM
        if all_bugs or all_security_risks:
            report_lines = ["# Code Analysis Report\n"]
            report_lines.append("Analysis completed. The following issues were identified in the codebase:\n")
            if all_bugs:
                report_lines.append("## 🐛 Identified Bugs & Logical Issues")
                report_lines.append("| Severity | Line Number | Description | Suggestion |")
                report_lines.append("|---|---|---|---|")
                for bug in all_bugs:
                    severity = bug.get("severity", "Medium")
                    line_num = bug.get("line_number", "N/A")
                    desc = bug.get("description", "No description provided.")
                    sug = bug.get("suggestion", "No suggestion provided.")
                    report_lines.append(f"| **{severity}** | {line_num} | {desc} | {sug} |")
                report_lines.append("")
            if all_security_risks:
                report_lines.append("## 🛡️ Security Vulnerabilities")
                report_lines.append("| Severity | Line Number | Risk Description | Remediation |")
                report_lines.append("|---|---|---|---|")
                for risk in all_security_risks:
                    severity = risk.get("severity", "Medium")
                    line_num = risk.get("line_number", "N/A")
                    desc = risk.get("description", "No description provided.")
                    rem = risk.get("remediation", "No remediation steps provided.")
                    report_lines.append(f"| **{severity}** | {line_num} | {desc} | {rem} |")
                report_lines.append("")
            combined_md = "\n".join(report_lines)
        else:
            combined_md = (
                "# Code Analysis Report\n\n"
                "## ✨ Analysis Summary\n"
                "No bugs or security risks were identified in the analyzed code. Your code appears to be clean, healthy, and secure!"
            )

    return {
        "bugs": all_bugs,
        "security_risks": all_security_risks,
        "raw_markdown_report": combined_md
    }



def process_fix_chunk(idx: int, chunk: str, payload: CodePayload, system_instruction: str, lang_info: str, total_lines: int, api_key: Optional[str]):
    groq_api_key_var.set(api_key)
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": f"Review and fix the following code snippet{lang_info}. Remember the rules: if there are no bugs/errors, return empty string for refactored_code. If code is large/chunk, only return the updated function/class/block that was changed:\n\n```\n{chunk}\n```"}
    ]
    try:
        log_debug(f"[fix] chunk {idx+1} provider={payload.provider} model={payload.model} code_len={len(chunk)}")
        if payload.provider == "offline":
            content = query_ollama(
                messages=messages,
                model=payload.model or "llama3",
                json_mode=True
            )
        else:
            content = query_groq_with_retry(
                messages=messages,
                response_format={"type": "json_object"}
            )
        
        data = parse_json_robust(content)
        refactored = data.get("refactored_code", "")
        expl = data.get("explanation", "")
        
        # If refactored is exactly same or empty, treat as unmodified
        if refactored == chunk or not refactored.strip():
            refactored = ""
            
        start_line = idx * 300 + 1
        end_line = min((idx + 1) * 300, total_lines)
        explanation_text = f"### Section: Lines {start_line} to {end_line}\n\n{expl}" if (expl and refactored) else ""
        
        return refactored, explanation_text, None
    except Exception as e:
        log_debug(f"[fix] chunk {idx+1} EXCEPTION: {type(e).__name__}: {str(e)}")
        start_line = idx * 300 + 1
        end_line = min((idx + 1) * 300, total_lines)
        err_explanation = f"### Section: Lines {start_line} to {end_line}\n\n⚠️ Failed to refactor this section: {str(e)}"
        return chunk, err_explanation, e


@app.post("/fix", response_model=FixResponse)
def fix_code(payload: CodePayload):
    lang_info = f" in {payload.language}" if payload.language else ""
    
    system_instruction = (
        "You are an elite software engineer. Your task is to FIX bugs, syntax errors, logical issues, or security risks in the provided code.\n"
        "You MUST return your response strictly as a JSON object matching the following structure:\n"
        "{\n"
        '  "refactored_code": "The corrected/optimized function, class, code block, or empty string if no bugs are found",\n'
        '  "explanation": "A very brief explanation of the fix, or healthy message if no bugs are found"\n'
        "}\n\n"
        "Rules:\n"
        "1. MINIMAL TEXT: Give a very brief, minimal text explanation. Focus almost entirely on the code.\n"
        "2. IF NO BUGS: If the code has no bugs, security risks, or logical errors, set `refactored_code` strictly to \"\" (empty string), and set `explanation` to 'Your code is completely healthy and bug-free!'\n"
        "3. IF BUGS FOUND: Fix all bugs. Return the corrected code in `refactored_code` and a very brief explanation of the fix in `explanation`.\n"
        "4. LARGE CODE HANDLING: If the input code is large (or a large chunk), do NOT reproduce the entire unchanged file. "
        "Instead, return ONLY the specific updated function, class, or code block that was modified, so the user can easily see what to replace.\n"
        "5. Standard JSON compliance: Make sure the output is valid JSON, and all double quotes inside string values are escaped."
    )

    chunks = chunk_code_backend(payload.code, chunk_size=300)
    total_lines = len(payload.code.splitlines())
    api_key = groq_api_key_var.get()
    
    with ThreadPoolExecutor(max_workers=min(len(chunks), 8)) as executor:
        futures = [
            executor.submit(
                process_fix_chunk,
                idx, chunk, payload, system_instruction, lang_info, total_lines, api_key
            )
            for idx, chunk in enumerate(chunks)
        ]
        results = [f.result() for f in futures]
        
    refactored_parts = []
    explanations = []
    
    modified_any = False
    for idx, (refactored, explanation_text, err) in enumerate(results):
        if err and len(chunks) == 1:
            if isinstance(err, HTTPException):
                raise err
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred during code fixing: {str(err)}"
            )
        
        if refactored and refactored.strip():
            refactored_parts.append(refactored)
            modified_any = True
            
        if explanation_text and "healthy and bug-free" not in explanation_text.lower():
            explanations.append(explanation_text)
            
    if modified_any:
        combined_code = ""
        for idx, part in enumerate(refactored_parts):
            if idx > 0 and not combined_code.endswith("\n") and not part.startswith("\n"):
                combined_code += "\n"
            combined_code += part
        combined_explanation = "\n\n---\n\n".join(explanations) if explanations else "Bugs fixed."
    else:
        combined_code = ""
        combined_explanation = "Your code is completely healthy, correct, and bug-free!"
    
    return {
        "refactored_code": combined_code,
        "explanation": combined_explanation
    }


def safe_to_markdown_string(val) -> str:
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        if len(val) > 0 and isinstance(val[0], dict):
            keys = list(val[0].keys())
            headers = " | ".join(keys)
            separator = " | ".join(["---"] * len(keys))
            rows = []
            for item in val:
                row = " | ".join(str(item.get(k, "")) for k in keys)
                rows.append(row)
            return f"| {headers} |\n| {separator} |\n" + "\n".join(f"| {r} |" for r in rows)
        return "\n".join(f"- {str(item)}" for item in val)
    if isinstance(val, dict):
        return "\n".join(f"- **{k}**: {str(v)}" for k, v in val.items())
    return str(val)


def process_docgen_chunk(idx: int, chunk: str, payload: CodePayload, system_instruction: str, lang_info: str, api_key: Optional[str]):
    groq_api_key_var.set(api_key)
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": f"Analyze the following code snippet and generate documentation suite including architecture, API tables, usage recipes, and inline docstrings/comments{lang_info}:\n\n```\n{chunk}\n```"}
    ]
    try:
        log_debug(f"[docgen] chunk {idx+1} provider={payload.provider} model={payload.model} code_len={len(chunk)}")
        if payload.provider == "offline":
            content = query_ollama(
                messages=messages,
                model=payload.model or "llama3",
                json_mode=True
            )
        else:
            content = query_groq_with_retry(
                messages=messages,
                response_format={"type": "json_object"}
            )
        
        data = parse_json_robust(content)
        documented = data.get("documented_code", chunk)
        commit_msg = data.get("commit_message", "")
        arch = data.get("architecture_overview", "No architecture overview generated.")
        api_ref = data.get("api_reference", "No API reference generated.")
        usage = data.get("usage_examples", "No usage examples generated.")
        
        return documented, commit_msg, arch, api_ref, usage, None
    except Exception as e:
        log_debug(f"[docgen] chunk {idx+1} EXCEPTION: {type(e).__name__}: {str(e)}")
        return chunk, "", "Error generating overview.", "Error generating API reference.", "Error generating usage examples.", e


@app.post("/docgen", response_model=DocGenResponse)
def docgen_code(payload: CodePayload):
    lang_info = f" in {payload.language}" if payload.language else ""
    
    system_instruction = (
        "You are an expert technical writer and software architect. "
        "Analyze the provided code and generate a comprehensive documentation suite.\n"
        "You MUST return your response strictly as a JSON object matching the following structure:\n"
        "{\n"
        '  "architecture_overview": "A clear description of the module architecture, design patterns, and optionally a Mermaid.js flowchart mapping the code execution flow (quote node labels containing special characters, e.g. id[\\\"Label\\\"])",\n'
        '  "api_reference": "A markdown table listing all classes, methods, and functions with their signature, parameters, return value, and descriptions",\n'
        '  "usage_examples": "Clear, copy-pasteable usage examples showing how to import, instantiate, and execute the code",\n'
        '  "documented_code": "The complete input code modified to include high-quality inline comments and Google/Sphinx style docstrings (never truncated or omitted)",\n'
        '  "commit_message": "A conventional git commit message (e.g. docs: document user authentication system)"\n'
        "}\n\n"
        "CRITICAL JSON ESCAPING RULE:\n"
        "All double quotes (\") inside any JSON string values (including code snippets and documentation) MUST be escaped with a single backslash (e.g., \\\").\n"
        "DO NOT use double-escaped backslashes (like \\\\\") or quadruple backslashes (like \\\\\\\"). Ensure that the generated response is standard, valid JSON."
    )

    chunks = chunk_code_backend(payload.code, chunk_size=300)
    api_key = groq_api_key_var.get()
    
    with ThreadPoolExecutor(max_workers=min(len(chunks), 8)) as executor:
        futures = [
            executor.submit(
                process_docgen_chunk,
                idx, chunk, payload, system_instruction, lang_info, api_key
            )
            for idx, chunk in enumerate(chunks)
        ]
        results = [f.result() for f in futures]
        
    documented_parts = []
    commit_messages = []
    architecture_parts = []
    api_reference_parts = []
    usage_examples_parts = []
    
    for idx, (documented, commit_msg, arch, api_ref, usage, err) in enumerate(results):
        if err and len(chunks) == 1:
            if isinstance(err, HTTPException):
                raise err
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred during documentation generation: {str(err)}"
            )
        documented_parts.append(documented)
        if commit_msg:
            commit_messages.append(commit_msg)
        if arch:
            architecture_parts.append(arch)
        if api_ref:
            api_reference_parts.append(api_ref)
        if usage:
            usage_examples_parts.append(usage)
            
    combined_code = ""
    for idx, part in enumerate(documented_parts):
        if idx > 0 and not combined_code.endswith("\n") and not part.startswith("\n"):
            combined_code += "\n"
        combined_code += part
        
    final_commit = commit_messages[0] if commit_messages else "docs: add inline documentation"
    final_arch = "\n\n---\n\n".join(safe_to_markdown_string(x) for x in architecture_parts) if architecture_parts else "No architecture overview generated."
    final_api_ref = "\n\n---\n\n".join(safe_to_markdown_string(x) for x in api_reference_parts) if api_reference_parts else "No API reference generated."
    final_usage = "\n\n---\n\n".join(safe_to_markdown_string(x) for x in usage_examples_parts) if usage_examples_parts else "No usage examples generated."
    
    return {
        "architecture_overview": final_arch,
        "api_reference": final_api_ref,
        "usage_examples": final_usage,
        "documented_code": combined_code,
        "commit_message": final_commit
    }



# Chat Schema Definition
class ChatMessage(BaseModel):
    role: str = Field(description="Role of the message author: 'user' or 'model'")
    text: str = Field(description="Text content of the message")

class ChatPayload(BaseModel):
    message: str = Field(description="The user's input message")
    history: List[ChatMessage] = Field(default=[], description="The conversation history")
    provider: Optional[str] = Field("online", description="Model provider: 'online' or 'offline'")
    model: Optional[str] = Field(None, description="Model identifier to use")

class ChatResponse(BaseModel):
    reply: str = Field(description="The model's reply")


@app.post("/chat", response_model=ChatResponse)
def chat_interaction(payload: ChatPayload):
    system_prompt = (
        "You are Ethrix, a sharp and intelligent AI code reviewer with a personality — concise, technical, and slightly witty. "
        "Your goal is to assist the developer with explaining, refactoring, documenting, and debugging code. "
        "Follow these rules strictly:\n"
        "1. NO FLUFF: Avoid long introductions or generic filler. Get straight to the point.\n"
        "2. NATURAL GREETINGS: If the user greets you (hello, hi, hey etc.), respond warmly but briefly in your own words. "
        "Do NOT use the same canned response every time. Vary it naturally — be concise and invite them to share a file or ask a question.\n"
        "3. POINT-WISE STRUCTURE: When explaining code or logic, use concise bullet points and bold headings. Make it structured and easy to scan.\n"
        "4. Keep explanations short, precise, and highly technical.\n"
        "5. TOOL CALL PARAMETERS: When calling workspace tools like 'read_file' or 'write_file', you MUST always explicitly supply all required parameters (such as 'path' and 'content'). Never leave them empty or assume they are implied.\n"
        "6. FORMATTING — CRITICAL: NEVER use LaTeX notation. NEVER use \\boxed{}, \\text{}, \\frac{}, or any math/LaTeX syntax. "
        "ALWAYS respond in plain text or standard Markdown (using **, *, -, >, ``` etc.). "
        "Your output will be rendered as Markdown — format accordingly."
    )
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    
    for msg in payload.history:
        # Map Google GenAI role "model" to OpenAI/Groq role "assistant"
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.text})
        
    messages.append({"role": "user", "content": payload.message})
    
    try:
        if payload.provider == "offline":
            # Call Ollama tool loop
            reply = query_ollama_with_tools(
                messages=messages,
                model=payload.model or "llama3"
            )
            # Fallback if reply is empty
            if not reply or not reply.strip():
                log_debug("Ollama tool reply was empty. Falling back to standard query...")
                reply = query_ollama(messages, payload.model or "llama3")
        else:
            # Call Groq tool loop
            try:
                reply = query_groq_with_tools(
                    messages=messages,
                    model=payload.model or "llama-3.3-70b-versatile"
                )
            except Exception as e:
                log_debug(f"Groq tool call failed: {str(e)}. Falling back to standard Groq chat completions...")
                reply = query_groq_with_retry(messages, payload.model or "llama-3.3-70b-versatile")
                
            # Fallback if reply is empty
            if not reply or not reply.strip():
                log_debug("Groq tool reply was empty. Falling back to standard query...")
                reply = query_groq_with_retry(messages, payload.model or "llama-3.3-70b-versatile")
                
        # Final fail-safe to guarantee a response
        if not reply or not reply.strip():
            reply = "I have successfully processed your request and checked the workspace. Please let me know what specific questions or changes you would like to make next!"
            
        return ChatResponse(reply=reply)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"An error occurred during chat: {str(e)}"
        )

