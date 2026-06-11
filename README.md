# Ethrix-Forge 🚀
### Elite, Lightweight, and Blazing-Fast AI Code Reviewer CLI

Ethrix-Forge is an automated code review assistant designed to scan code snippets for logical bugs, analyze security vulnerabilities, refactor code for performance, and automatically generate inline documentation, docstrings, and Git commit messages.

---

## 🌍 Global Installation (Run Anywhere!)

You can install Ethrix-Forge globally on your system to run it from any directory using the simple `ethrix` command.

### 💻 Windows (PowerShell)
Open PowerShell and run the following command to download, install dependencies, and register `ethrix` to your environment `PATH`:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/Shantanu-Pathak-1/Ethrix-Forge/master/install.ps1'))
```

### 🍎/🐧 macOS & Linux (Bash)
Open your terminal and run the following command:

```bash
curl -fsSL https://raw.githubusercontent.com/Shantanu-Pathak-1/Ethrix-Forge/master/install.sh | bash
```

> [!NOTE]
> **Post-Installation**: Restart your terminal session to reload your environment variables.

---

## 📁 CLI Features & Commands

Once installed, you can run `ethrix` globally against any file or folder.

### 1. Start Interactive AI Chat (Recommended)
Chat with the AI, ask coding questions, or load files automatically:
```bash
ethrix chat
# Pre-load files into chat context:
ethrix chat samples/buggy_code.py
```

### 2. Analyze Code for Bugs & Security
Scan for logical flaws and security risks (e.g., SQL injections, hardcoded keys):
```bash
ethrix analyze <file_or_directory_path>
# Example:
ethrix analyze samples/buggy_code.py
```

### 3. Optimize & Refactor Code
Review a generated unified diff and choose to apply optimized code directly:
```bash
ethrix fix <file_or_directory_path>
```

### 4. Generate Inline Documentation
Generate docstrings (Sphinx/Google format) and get a suggested Git commit message:
```bash
ethrix docgen <file_or_directory_path>
```

### 5. Run Full Review Pipeline
Run analysis, optimization, and docgen sequentially:
```bash
ethrix all <file_or_directory_path>
```

---

## ⚙️ Configuration Setup

Configure your AI model providers (Online Cloud APIs vs. Local Offline LLMs using Ollama):
```bash
ethrix config
```
- **Online Mode**: Uses ultra-fast API endpoints (e.g. Groq/Gemini).
- **Offline Mode**: Uses local LLMs (e.g. `llama3`) running locally via Ollama. The CLI will automatically serve Ollama in the background if it isn't already running.

---

## 📁 Project Structure (CLI Core)

* **`cli/`**: Contains the main CLI source files.
  * [ethrix.py](file:///d:/Ethrix-Forge/cli/ethrix.py): Main Python CLI client application.
  * `.ethrix_config.json`: Local model settings (automatically created).
* **`backend/`**: Contains the FastAPI server files.
  * [main.py](file:///d:/Ethrix-Forge/backend/main.py): Exposes code analysis and refactoring endpoints.
* **`samples/`**: Contains buggy code files (`buggy_code.py`, `test.cpp`) to test diagnostics.
* **Launchers**:
  * [ethrix](file:///d:/Ethrix-Forge/ethrix): Unix executable wrapper.
  * [ethrix.bat](file:///d:/Ethrix-Forge/ethrix.bat) / [ethrix.ps1](file:///d:/Ethrix-Forge/ethrix.ps1): Windows launcher scripts.

---

## ☁️ Backend Server Deployment (Optional)

To host your own central API backend:
1. Push this repository to GitHub.
2. Link the repository to **Render.com** as a **Web Service**.
3. Configure the following parameters:
   - **Runtime**: `Python`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. Set the `GROQ_API_KEY` (or `GEMINI_API_KEY`) environment variable.
5. In your local CLI configuration, you can point to this hosted server by running commands with the `--url` flag:
   ```bash
   ethrix --url https://your-render-url.onrender.com chat
   ```

---

*Powered by Team Titans 4 - CodeVortex Hackathon Round 3 (Finals)*