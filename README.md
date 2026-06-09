# Ethrix-Forge (AI-Based Code Review Assistant)

Ethrix-Forge is an elite, lightweight, and blazing-fast AI Code Reviewer designed for developers. It scans code snippets for logical bugs, analyzes security vulnerabilities, refactors code for optimizations, and automatically generates inline comments and sphinx/google-format docstrings.

---

## 📁 Project Structure

The project has been structured into clean, self-contained directories to separate components and make hosting simple:

*   **`backend/`**: FastAPI backend server code.
    *   `main.py`: ASGI server exposing code analysis, fixing, and docgen endpoints.
    *   `requirements.txt`: Python package dependencies list.
    *   `.env`: Local environment configurations (for GROQ_API_KEY/GEMINI_API_KEY).
*   **`cli/`**: Command-line interface client.
    *   `ethrix.py`: The CLI client script.
    *   `.ethrix_config.json`: Model and provider configurations (Online Cloud/Offline Local).
*   **`website/`**: Frontend interfaces.
    *   `index.html`: Product landing page and inline sandbox editor.
    *   `dashboard/index.html`: Fully featured developer dashboard and AI chat terminal.
    *   `css/`, `js/`, `webfonts/`: Client-side stylesheets, scripts, and font assets.
*   **`samples/`**: Code snippets and artifacts for testing logical, security, and styling diagnostics.
    *   `buggy_code.py`, `test.cpp`: Input examples containing intentional bugs, SQL injection flaws, and memory leaks.
*   **Root Directory Launchers**:
    *   `ethrix.bat`: Windows Command Prompt CLI launcher.
    *   `ethrix.ps1`: Windows PowerShell CLI launcher.

---

## 🚀 Local Setup & Execution

### 1. Backend Server Setup
Navigate to the `backend/` folder, install dependencies, and start the FastAPI server:
```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
*Make sure to insert your `GROQ_API_KEY` into `backend/.env` for online API access.*

### 2. Command-Line Interface (CLI)
You can run the CLI tool from the root directory against any file:
*   **PowerShell**:
    ```powershell
    .\ethrix.ps1 samples/buggy_code.py
    ```
*   **Command Prompt (CMD)**:
    ```cmd
    ethrix.bat samples/buggy_code.py
    ```

### 3. Website & Dashboard
Open `website/index.html` in your browser.
*   The **Landing Page** includes an Interactive Studio for fast analysis.
*   Click **Open Developer Dashboard** (or log in) to access the advanced review studio and AI chat console.
*   Go to **Model & API Settings** in the dashboard to set your custom Groq API Key or change your backend API server endpoint.

---

## ☁️ Hosting & Deployment (Host-Ready)

This project is fully ready for deployment:

### Backend Deployment (e.g. Render.com)
1. Push this repository to GitHub.
2. Link your repository to **Render.com** as a **Web Service**.
3. Set the following build options:
   *   **Runtime**: Python
   *   **Build Command**: `pip install -r backend/requirements.txt`
   *   **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. Define your environment variables in Render (e.g. `GROQ_API_KEY`).

### Frontend Deployment (e.g. Vercel or Netlify)
1. Deploy the `/website` directory as a static website to **Vercel** or **Netlify**.
2. Once the frontend is live, open the dashboard settings in your browser and set the **Backend API URL** to your hosted Render URL (e.g., `https://ethrix-backend.onrender.com`).
3. Your web app will now communicate directly with your cloud-hosted backend server!




mongodb connection string : mongodb+srv://dammytoon1_db_user:shan1234@ai-tech-sphere.frzq1nc.mongodb.net/?appName=ai-tech-sphere

pinecone:  pcsk_6nwF82_9CAKBYZT2uW83wNc7xkVdasT77v26JTgRqK5uEXDrQgNzidXei4
vagLBp3JuFKp