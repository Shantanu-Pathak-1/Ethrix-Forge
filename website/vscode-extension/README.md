# Ethrix Forge VS Code Extension

Ethrix Forge is an AI-powered code review and refactoring assistant. This extension provides sidebar chat capability and automatically generates/updates a permanent report file directly in your workspace.

## Features

1. **Sidebar Chat Panel**:
   - Access the AI chatbot directly from the sidebar.
   - Run quick actions: "Analyze Active Selection", "Optimize & Fix Code", and "Generate Documentation".
   - Support for both Online Cloud (Groq API) and Offline Local (Ollama) providers.

2. **Workspace Report Integration**:
   - Every time code analysis, fixing, or documentation generation is run, the extension creates/overwrites the `ethrix_report.md` file at the root of the active workspace.
   - The report is automatically opened in VS Code next to the active editor with a live Markdown preview!
   - If the file is deleted or if you change workspaces, Ethrix will automatically recreate it.

3. **Backend Server Auto-Start**:
   - If the local FastAPI server (`http://localhost:8000`) is not running, the extension offers to spin it up automatically in the background, matching the CLI behavior.

## Installation

1. Open this project in VS Code.
2. Press `F5` to start a new Extension Development Host window.
3. Open a project folder in the host window to test the workspace report.

## Extension Settings

Exposes the following settings under the `ethrix` namespace:
- `ethrix.backendUrl`: URL of the FastAPI server (defaults to `http://127.0.0.1:8000`).
- `ethrix.provider`: Model provider ("online" or "offline").
- `ethrix.model`: Model name (defaults to `llama-3.3-70b-versatile` or `llama3`).
- `ethrix.groqApiKey`: Custom override API key for Groq API.
- `ethrix.reportFileName`: Name of the report file (defaults to `ethrix_report.md`).
