# Project Blueprint: Ethrix-Forge (AI-Based Code Review Assistant)
**Team Name:** Team Titans 4
**Hackathon Round:** CodeVortex Hackathon Round 3 (Finals)
**Core Goal:** Build a lightweight, blazing-fast AI Code Reviewer with a single Python FastAPI backend serving three interfaces: CLI, VS Code Extension UI Wrapper, and a simple Web Dashboard.

---

## 1. System Architecture & Strategy (Keep it Simple)
Instead of creating three separate backend systems, we will build **ONE Central FastAPI Server**. 
* The **CLI** will just be a Python script making `requests.post()` to this server.
* The **VS Code Extension** will be a lightweight TypeScript/JS wrapper that sends selected code via `fetch()` to this server.
* The **Web App** will be a clean frontend (HTML/JS or React) that communicates with the same server.

This prevents codebase fragmentation and ensures a weak-tech team can manage it easily.

---

## 2. Technology Stack (The No-Nonsense Stack)
We avoid heavy databases (Docker, Redis, PostgreSQL) to ensure 100% uptime on free hosting tiers and easy local debugging.

| Layer | Technology | Why We Chosen It |
| :--- | :--- | :--- |
| **Backend** | Python (FastAPI) | Asynchronous, extremely fast, native Python support for AI. |
| **AI Layer** | Google Gemini API (`google-genai` SDK) | Generous free tier, fast response times, strict JSON output capability. |
| **Web Dashboard** | HTML5, Tailwind CSS, JavaScript (Vanilla or simple React) | Easy for front-end development without heavy state managers. |
| **CLI Tool** | Python (`sys` + `requests` library) | Zero boilerplate, standard library execution. |
| **VS Code Wrapper** | TypeScript (VS Code Extension API Boilerplate) | Simple sidebar WebView displaying Markdown results. |
| **Database** | None (In-Memory Session / Local Storage) | Not needed for a 5-minute hackathon live-demo. |
| **Hosting** | Render.com (Backend) + Vercel (Frontend) | 100% Free, auto-deploy from GitHub. |

---

## 3. Step-by-Step Implementation Guide for Antigravity

### Step 1: Core AI Server (FastAPI)
Create a single file `main.py`. This server needs three main POST routes:
1. `/analyze`: Takes code string, runs a system prompt via Gemini API to detect logical bugs and security issues, and returns a clean markdown/JSON response.
2. `/fix`: Takes a buggy code string and returns the perfectly refactored code with explanations.
3. `/docgen`: Takes a code block and automatically generates inline comments and documentation.

**Crucial Antigravity Instruction:** Force Gemini to return a structured response using `response_format={"type": "json_object"}` if needed, or structured Markdown text that can be directly displayed in the UI.

### Step 2: The Command-Line Interface (CLI)
Create a file named `ethrix.py`. 
* It uses Python's standard `sys.argv` to read a local file path.
* Reads the file content using standard `open(file_path, 'r').read()`.
* Sends a payload to `http://localhost:8000/analyze`.
* Prints the output directly onto the terminal with simple formatting.

### Step 3: Web Dashboard (Khushboo's Side)
* A simple dashboard themed with dark mode and cyan neon accents.
* Left side: A textarea or a basic Monaco Editor container to paste code.
* Action buttons: "Find Bugs", "Optimize & Fix", "Generate Docs".
* Right side: An output panel that renders the Markdown response returned from the FastAPI server.

### Step 4: VS Code Extension UI (The "Wow" Factor Hack)
* Do not code complex configurations. Generate a basic VS Code Extension boilerplate using `yo code`.
* Register a single editor command: `EthrixForge.analyzeCode`.
* When triggered, it grabs the active selection: `vscode.window.activeTextEditor.document.getText(selection)`.
* It performs a simple API fetch request to the hosted FastAPI production URL.
* Displays the results in a standard `vscode.window.showInformationMessage` or a lightweight `WebviewPanel` sidebar.

---

## 4. Exact Features & Prompts Engineering

### A. Bug & Error Finder (`/analyze`)
* **System Prompt Strategy:** "You are an elite automated code reviewer. Analyze the provided code snippet for syntax errors, logic flaws, memory leaks, or unhandled edge cases. Keep your explanations highly professional, bulleted, and precise."

### B. Security Vulnerability Detection
* **System Prompt Strategy:** "Scan the following code for security risks (e.g., Hardcoded API keys, SQL Injections, XSS, insecure dependencies). Highlight the risk level (Low, Medium, High) clearly."

### C. Auto-Commit & Documentation Generator (`/docgen`)
* **System Prompt Strategy:** "Generate clean, industrial-standard docstrings (Google or Sphinx format) for the provided functions. Additionally, write a concise, clear Git commit message explaining the change."

---

## 5. Live Demo Workflow for the Judges
To ensure the judges think the system is completely robust, follow this strict 3-step demonstration sequence during the pitch:

1. **The CLI Flex (Takes 10 seconds):** Open the terminal. Run `python ethrix.py buggy_code.py`. Boom! The terminal displays the bugs instantly. This proves utility for backend-heavy developers.
2. **The Extension Flex (Takes 20 seconds):** Open VS Code. Highlight a messy function, right-click, and select "Ethrix: Optimize". The sidebar populates with clean code. This proves developer integration.
3. **The Web Dashboard (Takes 30 seconds):** Open the browser. Show the full dashboard UI. Paste a complete script, press "Generate Documentation", and display the structured report. This shows product scalability.

---

## 6. Verification and Performance Guardrails
* **Asynchronous Calls:** Ensure all API handlers in FastAPI utilize `async def` and standard `httpx` or Google GenAI async methods to avoid thread blocking during the live demo.
* **Timeout Fallbacks:** If the Gemini API experiences a temporary latency spike during evaluation, ensure the UI shows a beautiful, glowing skeleton loading screen rather than throwing a crash error.

