import os
import sys
import argparse
import json
import requests
import subprocess
import time
import tempfile
import webbrowser
from typing import Optional, List
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.markdown import Markdown
from rich.syntax import Syntax
from rich.text import Text

console = Console()

# ── Scalability Constants ────────────────────────────────────────────────────
# Max lines to send in one API call. Larger files are auto-chunked.
CHUNK_LINE_LIMIT = 300
# Groq free-tier: ~6000 tokens/min. 300 lines ≈ ~1500 tokens safely.
# Local Ollama: no rate limit, but RAM-bound — 300 lines keeps responses fast.
# Increase to 500-600 if you have a paid Groq key or a powerful local GPU.
MAX_CONTEXT_LINES = 300

def _wait_for_port_free(port: int, timeout: float = 6.0) -> bool:
    """Wait until port is no longer in use (old process died). Returns True if free."""
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return True  # port is free
        time.sleep(0.3)
    return False  # timed out


def ensure_server_running(url: str):
    # Only try to auto-start if it is localhost/127.0.0.1
    if "localhost" not in url and "127.0.0.1" not in url:
        return

    # Determine port
    port = 8000
    if ":" in url:
        parts = url.split(":")
        if len(parts) == 3:
            try:
                port = int(parts[2].split("/")[0])
            except ValueError:
                pass

    try:
        response = requests.get(url, timeout=1.0)
        if response.status_code == 200:
            console.print("[yellow][*] Restarting backend server to load the latest codebase...[/]")
            # Ask server to shut down gracefully
            try:
                requests.post(f"{url}/shutdown", timeout=1.0)
            except Exception:
                pass
            # Wait for port to be truly free (up to 6 seconds)
            if not _wait_for_port_free(port, timeout=6.0):
                # Force-kill any python process still holding the port (Windows)
                if os.name == "nt":
                    try:
                        subprocess.run(
                            f'for /f "tokens=5" %a in (\'netstat -aon ^| find ":{port}"\') do taskkill /F /PID %a',
                            shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                        )
                        time.sleep(1.0)
                    except Exception:
                        pass
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        pass  # Server not running — start fresh

    console.print("[yellow]FastAPI backend is not running. Spinning it up automatically in the background...[/]")

    try:
        # Determine the backend working directory
        cli_dir = os.path.dirname(os.path.abspath(__file__))
        backend_dir = os.path.abspath(os.path.join(cli_dir, "..", "backend"))
        if not os.path.exists(os.path.join(backend_dir, "main.py")):
            # Fallback to current script directory or workspace root
            backend_dir = cli_dir

        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--port", str(port), "--host", "127.0.0.1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=backend_dir,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        )

        # Poll until server responds (up to 15 seconds)
        for _ in range(30):
            time.sleep(0.5)
            try:
                r = requests.get(url, timeout=0.5)
                if r.status_code == 200:
                    console.print("[green][+] Backend server is up and running![/]")
                    return
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                continue

        console.print("[bold red]Error:[/] Backend server failed to start within 15 seconds.")
        sys.exit(1)
    except Exception as e:
        console.print(f"[bold red]Error:[/] Failed to start backend server: {e}")
        sys.exit(1)


CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".ethrix_config.json")

def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_config(config: dict):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        console.print(f"[yellow]Warning: Could not save configuration: {e}[/]")

def ensure_ollama_running() -> bool:
    url = "http://127.0.0.1:11434/api/tags"
    try:
        response = requests.get(url, timeout=1.0)
        if response.status_code == 200:
            return True
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        pass
        
    console.print("[yellow]Local Ollama service is not running. Attempting to start it in the background...[/]")
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        
        # Poll for Ollama to respond
        for _ in range(30):  # Wait up to 15 seconds
            time.sleep(0.5)
            try:
                response = requests.get(url, timeout=0.5)
                if response.status_code == 200:
                    console.print("[green][+] Ollama service is up and running![/]")
                    return True
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                continue
                
        console.print("[bold red]Warning:[/] Ollama service failed to respond within 15 seconds.")
        return False
    except FileNotFoundError:
        console.print("[bold red]Error:[/] 'ollama' command not found in your system PATH.")
        console.print("[yellow]Please download and install Ollama from https://ollama.com.[/]")
        return False
    except Exception as e:
        console.print(f"[bold red]Error:[/] Failed to start Ollama automatically: {e}")
        return False

def prompt_configuration(force=False) -> dict:
    config = load_config()
    if config and not force:
        return config
        
    console.print(Panel(
        Markdown("# Ethrix Configuration Setup\nConfigure your model provider (Online Cloud || Offline Local)."),
        title="Configuration Setup",
        border_style="cyan",
        expand=False
    ))
    
    console.print("\n[bold]Select Model Provider:[/]")
    console.print("  [bold cyan]1[/]. Online Mode (Cloud API)")
    console.print("  [bold cyan]2[/]. Offline Mode (Local LLM Models via Ollama)")
    
    provider_choice = ""
    while provider_choice not in ["1", "2"]:
        provider_choice = console.input("\nEnter choice (1 or 2) : ").strip()
        if not provider_choice:
            provider_choice = "1"
            
    if provider_choice == "1":
        config["provider"] = "online"
        config["model"] = "llama-3.3-70b-versatile"
        console.print("[green][+] Configured to Online Mode (Groq API).[/]")
    else:
        config["provider"] = "offline"
        ensure_ollama_running()
        console.print("[yellow][*] Querying local Ollama service for installed models...[/]")
        try:
            response = requests.get("http://127.0.0.1:11434/api/tags", timeout=5.0)
            if response.status_code == 200:
                models_data = response.json()
                models = [m["name"] for m in models_data.get("models", [])]
                if not models:
                    console.print("[bold red]No local models found in Ollama![/] Please run 'ollama pull <model_name>' first.")
                    model_name = console.input("Enter the model name you wish to use (e.g. llama3): ").strip()
                    config["model"] = model_name or "llama3"
                else:
                    console.print("\n[bold]Select installed Ollama model:[/]")
                    for idx, model in enumerate(models, start=1):
                        console.print(f"  [bold cyan]{idx}[/]. {model}")
                    
                    model_choice = 0
                    while model_choice < 1 or model_choice > len(models):
                        try:
                            choice_str = console.input(f"\nEnter choice (1-{len(models)}): ").strip()
                            model_choice = int(choice_str)
                        except ValueError:
                            pass
                    config["model"] = models[model_choice - 1]
            else:
                console.print("[bold red]Ollama returned an error status![/]")
                model_name = console.input("Enter the model name you wish to use (e.g. llama3): ").strip()
                config["model"] = model_name or "llama3"
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            console.print("[bold red]Could not connect to Ollama at http://127.0.0.1:11434![/]")
            console.print("[yellow]Please ensure Ollama is installed and running locally.[/]")
            model_name = console.input("Enter the model name to use when Ollama starts (e.g. llama3): ").strip()
            config["model"] = model_name or "llama3"
            
        console.print(f"[green][+] Configured to Offline Mode using Ollama model '{config['model']}'.[/]")
            
    save_config(config)
    return config

EXTENSION_TO_LANG = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".html": "html",
    ".css": "css",
    ".cpp": "cpp",
    ".c": "c",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".sh": "bash",
    ".json": "json",
    ".md": "markdown"
}

def detect_language(file_path: str) -> Optional[str]:
    _, ext = os.path.splitext(file_path)
    return EXTENSION_TO_LANG.get(ext.lower())

def clean_newlines(text: str) -> str:
    return text.replace("\\n", "\n")


def export_to_temp_html_and_open(title: str, markdown_content: str):
    escaped_markdown = markdown_content.replace("</script>", "<\\/script>")
    
    html_template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>__TITLE__</title>
    <!-- Tailwind CSS for styling -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Marked JS for markdown parsing -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <!-- Prism CSS & JS for code syntax highlighting -->
    <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
    <style>
        body {
            background-color: #0f172a;
            color: #e2e8f0;
        }
        .prose pre {
            background-color: #1e293b !important;
            border: 1px solid #334155;
            border-radius: 0.5rem;
        }
        .prose code {
            color: #f472b6;
            background-color: #1e293b;
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
        }
        .prose a {
            color: #38bdf8;
        }
        .prose {
            font-size: 1.1rem;
            line-height: 1.75;
        }
        .prose h1, .prose h2, .prose h3, .prose h4 {
            color: #22d3ee;
            font-weight: 700;
        }
        .prose h1 { font-size: 2.25rem; margin-top: 2rem; margin-bottom: 1rem; }
        .prose h2 { font-size: 1.875rem; margin-top: 1.75rem; margin-bottom: 0.75rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
        .prose h3 { font-size: 1.5rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
        .prose ul { list-style-type: disc; padding-left: 1.625rem; margin-bottom: 1rem; }
        .prose ol { list-style-type: decimal; padding-left: 1.625rem; margin-bottom: 1rem; }
        .prose li { margin-top: 0.25rem; margin-bottom: 0.25rem; }
        .prose p { margin-bottom: 1.25rem; }
    </style>
</head>
<body class="p-8 font-sans max-w-4xl mx-auto">
    <div class="mb-6 flex justify-between items-center border-b border-slate-700 pb-4">
        <h1 class="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            __TITLE__
        </h1>
        <span class="text-sm bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700">Ethrix CLI Report</span>
    </div>
    
    <div id="content" class="prose prose-invert max-w-none">
        <!-- Content will be rendered here -->
    </div>

    <!-- Hidden element holding raw markdown -->
    <script type="text/markdown" id="raw-markdown">__MARKDOWN_CONTENT__</script>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
    <script>
        const markdown = document.getElementById('raw-markdown').textContent;
        // Parse markdown and set as innerHTML
        document.getElementById('content').innerHTML = marked.parse(markdown);
        // Trigger Prism syntax highlighting
        setTimeout(() => {
            Prism.highlightAll();
        }, 100);
    </script>
</body>
</html>"""

    html_content = html_template.replace("__TITLE__", title).replace("__MARKDOWN_CONTENT__", escaped_markdown)
    
    try:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".html", mode="w", encoding="utf-8")
        temp_file.write(html_content)
        temp_file.close()
        
        webbrowser.open(f"file://{os.path.abspath(temp_file.name)}")
        console.print(f"[dim green][+] Detailed report opened in browser: file://{os.path.abspath(temp_file.name)}[/]")
    except Exception as e:
        console.print(f"[bold red]Warning:[/] Could not open browser report: {e}")

def typewriter_print(text: str):
    from rich.live import Live
    current = ""
    delay = 0.002
    try:
        with Live(Markdown(""), auto_refresh=False) as live:
            for char in text:
                current += char
                live.update(Markdown(current))
                live.refresh()
                time.sleep(delay)
    except KeyboardInterrupt:
        console.print(Markdown(text))

def display_reply(reply: str):
    lines = reply.splitlines()
    if len(lines) > 20 or len(reply) > 1000:
        console.print("[yellow][*] Response is long. Displaying summary and opening full report in browser...[/]")
        summary = "\n".join(lines[:10]) + "\n\n... [Remaining content opened in browser] ..."
        typewriter_print(summary)
        export_to_temp_html_and_open("Ethrix Chat Response", reply)
    else:
        typewriter_print(reply)


def read_file(file_path: str, exit_on_error: bool = True) -> Optional[str]:
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        console.print(f"[bold red]Error:[/] Could not read file '{file_path}': {e}")
        if exit_on_error:
            sys.exit(1)
        return None

def handle_analyze(file_path: str, url: str, exit_on_error: bool = True):
    config = load_config()
    provider = config.get("provider", "online")
    model = config.get("model", "llama-3.3-70b-versatile")
    
    code = read_file(file_path, exit_on_error=exit_on_error)
    if code is None:
        return
    lang = detect_language(file_path)
    
    console.print(f"\n[bold cyan]Analyzing:[/] {file_path} (Detected Language: {lang or 'text'}) [dim]({provider}/{model})[/]...")
    
    lines = code.splitlines()
    total_lines = len(lines)
    chunk_size = MAX_CONTEXT_LINES  # 300 lines per chunk
    chunks = []
    for i in range(0, total_lines, chunk_size):
        chunks.append("\n".join(lines[i : i + chunk_size]))

    num_chunks = len(chunks)
    chunk_label = f"{num_chunks} chunk(s)" if num_chunks > 1 else "single chunk"
    console.print(f"\n[bold cyan]Analyzing:[/] {file_path} (Detected Language: {lang or 'text'}) "
                  f"[dim]({provider}/{model})[/] [{chunk_label}]...")

    all_bugs: list = []
    all_risks: list = []
    all_markdown: list = []
    has_issues = False
    
    for idx, chunk in enumerate(chunks, 1):
        if num_chunks > 1:
            console.rule(f"[dim cyan]{os.path.basename(file_path)} (chunk {idx}/{num_chunks})[/]")
        
        payload = {"code": chunk, "language": lang, "provider": provider, "model": model}
        try:
            response = requests.post(f"{url}/analyze", json=payload, timeout=300)
            if response.status_code != 200:
                console.print(f"[bold red]API Error (Status {response.status_code}):[/] {response.text}")
                if num_chunks == 1:
                    if exit_on_error:
                        sys.exit(1)
                    return
                continue  # skip this chunk, continue with others

            data = response.json()
            chunk_bugs  = data.get("bugs", [])
            chunk_risks = data.get("security_risks", [])
            chunk_md    = data.get("raw_markdown_report", "")
            all_bugs.extend(chunk_bugs)
            all_risks.extend(chunk_risks)
            if chunk_md:
                all_markdown.append(f"## Chunk {idx}/{num_chunks}\n\n{chunk_md}")
            if chunk_bugs or chunk_risks:
                has_issues = True

            # Print per-chunk table
            table = Table(
                title=f"{os.path.basename(file_path)} (chunk {idx}/{num_chunks})" if num_chunks > 1 else "Ethrix-Forge Analysis Summary",
                title_style="bold cyan"
            )
            table.add_column("Type", style="bold")
            table.add_column("Severity", style="bold")
            table.add_column("Line(s)", justify="center")
            table.add_column("Description")

            for bug in chunk_bugs:
                sev = bug.get("severity", "Medium")
                sev_color = "yellow" if sev.lower() == "medium" else ("red" if sev.lower() == "high" else "blue")
                table.add_row("Bug", f"[{sev_color}]{sev}[/]", str(bug.get("line_number") or "N/A"), bug.get("description", ""))
            for risk in chunk_risks:
                sev = risk.get("severity", "Medium")
                sev_color = "red" if sev.lower() == "high" else ("yellow" if sev.lower() == "medium" else "blue")
                table.add_row("Security", f"[bold {sev_color}]{sev}[/]", str(risk.get("line_number") or "N/A"), risk.get("description", ""))
            if not chunk_bugs and not chunk_risks:
                table.add_row("Clean", "[green]OK[/]", "-", "No issues found in this chunk")
            console.print(table)

        except requests.exceptions.Timeout:
            console.print(f"[bold red]Timeout[/] on chunk {idx}/{num_chunks} — skipping.")
            continue
        except requests.exceptions.ConnectionError:
            console.print("[bold red]Connection Error:[/] Lost connection to backend.")
            if exit_on_error:
                sys.exit(1)
            return

    # ── Open combined report in browser ───────────────────────────────
    combined_md = "\n\n---\n\n".join(all_markdown)
    if combined_md:
        console.print("\n[yellow][*] Opening full code review report in browser...[/]")
        export_to_temp_html_and_open(f"Code Analysis: {os.path.basename(file_path)}", combined_md)

    # ── Post-analysis Action Prompt ────────────────────────────────────
    if has_issues:
        console.print()
        console.print(Panel(
            "Issues found! What would you like to do next?\n\n"
            "  [bold cyan]f[/]  ->  Fix & refactor the code\n"
            "  [bold cyan]d[/]  ->  Generate inline documentation\n"
            "  [bold cyan]a[/]  ->  Run full pipeline (fix + docgen)\n"
            "  [bold cyan]n[/]  ->  Skip (just view the report)",
            title="Next Action",
            border_style="yellow",
            expand=False
        ))
        choice = console.input("[bold yellow]Choice (f/d/a/n) [n]: [/]").strip().lower()
        if choice == "f":
            handle_fix(file_path, url, exit_on_error=False)
        elif choice == "d":
            handle_docgen(file_path, url, exit_on_error=False)
        elif choice == "a":
            handle_all(file_path, url)
        else:
            console.print("[dim]Skipped. Run [bold]ethrix fix {file}[/] anytime to apply fixes.[/]")


def handle_fix(file_path: str, url: str, exit_on_error: bool = True):
    config = load_config()
    provider = config.get("provider", "online")
    model = config.get("model", "llama-3.3-70b-versatile")

    code = read_file(file_path, exit_on_error=exit_on_error)
    if code is None:
        return
    lang = detect_language(file_path) or "text"

    chunks = chunk_code(code)
    num_chunks = len(chunks)
    chunk_label = f"{num_chunks} chunk(s)" if num_chunks > 1 else "single chunk"
    console.print(f"\n[bold cyan]Optimizing & Fixing:[/] {file_path} [dim]({provider}/{model})[/] [{chunk_label}]...")

    fixed_parts: list[str] = []
    all_explanations: list[str] = []

    for idx, chunk in enumerate(chunks, 1):
        if num_chunks > 1:
            console.rule(f"[dim cyan]{os.path.basename(file_path)} fix chunk {idx}/{num_chunks}[/]")
        payload = {"code": chunk, "language": lang, "provider": provider, "model": model}
        try:
            response = requests.post(f"{url}/fix", json=payload, timeout=300)
            if response.status_code != 200:
                console.print(f"[bold red]API Error chunk {idx}:[/] {response.text}")
                fixed_parts.append(chunk)  # keep original if fix fails
                continue
            data = response.json()
            fixed_parts.append(clean_newlines(data.get("refactored_code", chunk)))
            expl = clean_newlines(data.get("explanation", ""))
            if expl:
                all_explanations.append(f"### Chunk {idx}\n\n{expl}")
        except requests.exceptions.Timeout:
            console.print(f"[bold red]Timeout[/] on fix chunk {idx} — keeping original.")
            fixed_parts.append(chunk)
            continue
        except requests.exceptions.ConnectionError:
            console.print("[bold red]Connection Error:[/] Lost connection to backend.")
            if exit_on_error:
                sys.exit(1)
            return

    refactored = "\n".join(fixed_parts)
    explanation = "\n\n".join(all_explanations)

    # Show diff
    import difflib
    diff = difflib.unified_diff(
        code.splitlines(keepends=True),
        refactored.splitlines(keepends=True),
        fromfile=f"a/{os.path.basename(file_path)}",
        tofile=f"b/{os.path.basename(file_path)}",
        lineterm=""
    )
    diff_text = "".join(diff)
    if diff_text:
        console.print(Panel(
            Syntax(diff_text, "diff", theme="monokai"),
            title="Code Changes (Diff Summary)",
            border_style="cyan"
        ))
    else:
        console.print("[green][SUCCESS] Code is already fully optimized! No diff detected.[/]")

    full_report_md = f"""## Refactored Code ({lang.upper()})

```{lang}
{refactored}
```

## Refactoring Explanation

{explanation}
"""
    console.print("[yellow][*] Opening refactored code and detailed explanation in browser...[/]")
    export_to_temp_html_and_open(f"Code Refactor: {os.path.basename(file_path)}", full_report_md)

    if diff_text:
        console.print("\n[bold]Apply these refactoring changes to the file?[/]")
        apply_choice = console.input(f"Write changes to {file_path}? (y/n) [n]: ").strip().lower()
        if apply_choice in ["y", "yes"]:
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(refactored)
                console.print(f"[green][SUCCESS] Successfully applied changes to '{file_path}'![/]")
            except Exception as e:
                console.print(f"[bold red]Error:[/] Could not write to file '{file_path}': {e}")


def handle_docgen(file_path: str, url: str, exit_on_error: bool = True):
    config = load_config()
    provider = config.get("provider", "online")
    model = config.get("model", "llama-3.3-70b-versatile")

    code = read_file(file_path, exit_on_error=exit_on_error)
    if code is None:
        return
    lang = detect_language(file_path) or "text"

    chunks = chunk_code(code)
    num_chunks = len(chunks)
    chunk_label = f"{num_chunks} chunk(s)" if num_chunks > 1 else "single chunk"
    console.print(f"\n[bold cyan]Generating Comments & Documentation:[/] {file_path} [dim]({provider}/{model})[/] [{chunk_label}]...")

    documented_parts: list[str] = []
    commit_messages: list[str] = []

    for idx, chunk in enumerate(chunks, 1):
        if num_chunks > 1:
            console.rule(f"[dim cyan]{os.path.basename(file_path)} docgen chunk {idx}/{num_chunks}[/]")
        payload = {"code": chunk, "language": lang, "provider": provider, "model": model}
        try:
            response = requests.post(f"{url}/docgen", json=payload, timeout=300)
            if response.status_code != 200:
                console.print(f"[bold red]API Error chunk {idx}:[/] {response.text}")
                documented_parts.append(chunk)  # keep original on failure
                continue
            data = response.json()
            documented_parts.append(clean_newlines(data.get("documented_code", chunk)))
            msg = clean_newlines(data.get("commit_message", ""))
            if msg:
                commit_messages.append(msg)
        except requests.exceptions.Timeout:
            console.print(f"[bold red]Timeout[/] on docgen chunk {idx} — keeping original.")
            documented_parts.append(chunk)
            continue
        except requests.exceptions.ConnectionError:
            console.print("[bold red]Connection Error:[/] Lost connection to backend.")
            if exit_on_error:
                sys.exit(1)
            return

    documented = "\n".join(documented_parts)
    commit_msg = commit_messages[0] if commit_messages else "docs: add inline documentation"

    # Show commit message
    console.print(Panel(
        Text(commit_msg, style="bold green"),
        title="Suggested Conventional Git Commit Message",
        border_style="cyan"
    ))

    # Show diff
    import difflib
    diff = difflib.unified_diff(
        code.splitlines(keepends=True),
        documented.splitlines(keepends=True),
        fromfile=f"a/{os.path.basename(file_path)}",
        tofile=f"b/{os.path.basename(file_path)}",
        lineterm=""
    )
    diff_text = "".join(diff)
    if diff_text:
        console.print(Panel(
            Syntax(diff_text, "diff", theme="monokai"),
            title="Documentation Diff Summary",
            border_style="cyan"
        ))
    else:
        console.print("[green][SUCCESS] Code is already fully documented! No diff detected.[/]")

    full_report_md = f"""## Documented Code ({lang.upper()})

```{lang}
{documented}
```

## Suggested Git Commit Message

`{commit_msg}`
"""
    console.print("[yellow][*] Opening documented code in browser...[/]")
    export_to_temp_html_and_open(f"Documentation Gen: {os.path.basename(file_path)}", full_report_md)

    if diff_text:
        console.print("\n[bold]Apply these documentation changes to the file?[/]")
        apply_choice = console.input(f"Write changes to {file_path}? (y/n) [n]: ").strip().lower()
        if apply_choice in ["y", "yes"]:
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(documented)
                console.print(f"[green][SUCCESS] Successfully applied documentation to '{file_path}'![/]")
            except Exception as e:
                console.print(f"[bold red]Error:[/] Could not write to file '{file_path}': {e}")


def chunk_code(code: str, chunk_size: int = CHUNK_LINE_LIMIT) -> list:
    """Split code into line-based chunks for large file processing.
    Each chunk overlaps by 5 lines to preserve function/class context across boundaries.
    """
    lines = code.splitlines(keepends=True)
    if len(lines) <= chunk_size:
        return [code]  # No chunking needed
    
    chunks = []
    overlap = 5  # Lines of overlap between chunks for context
    i = 0
    while i < len(lines):
        end = min(i + chunk_size, len(lines))
        chunk_lines = lines[i:end]
        chunks.append("".join(chunk_lines))
        i += chunk_size - overlap  # Slide forward with overlap
    return chunks


def handle_multi_files(
    file_paths: list,
    command: str,
    url: str,
    exit_on_error: bool = True
):
    """Orchestrate analyze/fix/docgen/all across multiple files or a directory.
    Supports:
      - List of files:  ethrix analyze file1.py file2.cpp
      - A directory:    ethrix analyze ./src/
    """
    # Expand directories
    expanded = []
    SUPPORTED_EXTENSIONS = {
        ".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".hpp",
        ".java", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".kt",
        ".sh", ".bash", ".yml", ".yaml", ".json", ".toml", ".md"
    }
    for fp in file_paths:
        if os.path.isdir(fp):
            # Directory scan — recursively find all code files
            console.print(f"\n[bold yellow][*] Directory detected:[/] Scanning '[cyan]{fp}[/]' for code files...")
            for root, dirs, files in os.walk(fp):
                # Skip hidden dirs and common noise dirs
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in (
                    '__pycache__', 'node_modules', '.git', 'venv', '.venv', 'dist', 'build'
                )]
                for fname in sorted(files):
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in SUPPORTED_EXTENSIONS:
                        expanded.append(os.path.join(root, fname))
        elif os.path.isfile(fp):
            expanded.append(fp)
        else:
            console.print(f"[bold red]Warning:[/] '{fp}' not found — skipping.")
    
    if not expanded:
        console.print("[bold red]Error:[/] No valid files found to process.")
        return
    
    total = len(expanded)
    console.print(f"\n[bold cyan]Ethrix Multi-File {command.upper()} — {total} file(s) queued[/]")
    
    # Progress tracking
    all_results = []  # (file_path, status, summary)
    
    for idx, fp in enumerate(expanded, start=1):
        console.rule(f"[bold cyan][{idx}/{total}] {os.path.basename(fp)}[/]")
        
        code = read_file(fp, exit_on_error=False)
        if not code:
            all_results.append((fp, "skipped", "Could not read file"))
            continue
        
        lines = code.splitlines()
        num_lines = len(lines)
        lang = detect_language(fp) or "text"
        
        # ── Smart Chunking ────────────────────────────────────────────────
        if num_lines > CHUNK_LINE_LIMIT:
            chunks = chunk_code(code, CHUNK_LINE_LIMIT)
            console.print(
                f"[yellow][*] Large file ({num_lines} lines) — splitting into "
                f"[bold]{len(chunks)}[/] chunks of ~{CHUNK_LINE_LIMIT} lines each...[/]"
            )
        else:
            chunks = [code]
        
        file_ok = True
        chunk_reports = []
        
        for c_idx, chunk in enumerate(chunks, start=1):
            chunk_label = f" (chunk {c_idx}/{len(chunks)})" if len(chunks) > 1 else ""
            
            if command in ("analyze", "all"):
                # ── Analyze chunk ─────────────────────────────────────────
                config = load_config()
                with console.status(f"[dim]Analyzing{chunk_label}...[/]"):
                    try:
                        r = requests.post(
                            f"{url}/analyze",
                            json={"code": chunk, "language": lang,
                                  "provider": config.get("provider", "online"),
                                  "model": config.get("model")},
                            timeout=120
                        )
                    except requests.exceptions.Timeout:
                        console.print(f"[bold red]Timeout[/] on {fp}{chunk_label}")
                        file_ok = False; break
                    except requests.exceptions.ConnectionError:
                        console.print(f"[bold red]Connection error[/] — is the backend running?")
                        return
                
                if r.status_code != 200:
                    console.print(f"[bold red]API Error ({r.status_code}):[/] {r.text}")
                    file_ok = False; break
                
                data = r.json()
                bugs = data.get("bugs", [])
                risks = data.get("security_risks", [])
                chunk_reports.append(data.get("raw_markdown_report", ""))
                
                if bugs or risks:
                    table = Table(title=f"{os.path.basename(fp)}{chunk_label}", title_style="bold cyan")
                    table.add_column("Type", style="bold")
                    table.add_column("Severity")
                    table.add_column("Line(s)", justify="center")
                    table.add_column("Description")
                    for bug in bugs:
                        sev = bug.get("severity", "Medium")
                        sc = "red" if sev.lower() == "high" else ("yellow" if sev.lower() == "medium" else "blue")
                        table.add_row("Bug", f"[{sc}]{sev}[/]", bug.get("line_number") or "N/A", bug.get("description", ""))
                    for risk in risks:
                        sev = risk.get("severity", "Medium")
                        sc = "red" if sev.lower() == "high" else ("yellow" if sev.lower() == "medium" else "blue")
                        table.add_row("Security", f"[bold {sc}]{sev}[/]", risk.get("line_number") or "N/A", risk.get("description", ""))
                    console.print(table)
                else:
                    console.print(f"[green]OK {os.path.basename(fp)}{chunk_label} — No issues found.[/]")
            
            elif command in ("fix", "docgen"):
                # ── Fix / Docgen chunk ────────────────────────────────────
                config = load_config()
                endpoint = "/fix" if command == "fix" else "/docgen"
                with console.status(f"[dim]{command.capitalize()}{chunk_label}...[/]"):
                    try:
                        r = requests.post(
                            f"{url}{endpoint}",
                            json={"code": chunk, "language": lang,
                                  "provider": config.get("provider", "online"),
                                  "model": config.get("model")},
                            timeout=120
                        )
                    except requests.exceptions.Timeout:
                        console.print(f"[bold red]Timeout[/] on {fp}{chunk_label}")
                        file_ok = False; break
                    except requests.exceptions.ConnectionError:
                        console.print(f"[bold red]Connection error[/] — is the backend running?")
                        return
                
                if r.status_code != 200:
                    console.print(f"[bold red]API Error ({r.status_code}):[/] {r.text}")
                    file_ok = False; break
                
                data = r.json()
                key = "refactored_code" if command == "fix" else "documented_code"
                result_code = clean_newlines(data.get(key, ""))
                chunk_reports.append(result_code)
                console.print(f"[green]OK {os.path.basename(fp)}{chunk_label} -> processed.[/]")
        
        # -- Per-file result -----------------------------------------------
        status = "[green]done[/]" if file_ok else "[red]error[/]"
        all_results.append((fp, status, f"{len(chunks)} chunk(s)" if len(chunks) > 1 else "single"))
        
        # Open browser report for this file if analyze
        if command in ("analyze", "all") and file_ok and chunk_reports:
            combined_report = "\n\n---\n\n".join(chunk_reports)
            export_to_temp_html_and_open(
                f"Analysis: {os.path.basename(fp)}",
                f"# Analysis: {fp}\n\n{combined_report}"
            )
    
    # -- Final Summary Table -----------------------------------------------
    console.rule("[bold green]Multi-File Summary[/]")
    summary_table = Table(title=f"Ethrix {command.upper()} -> {total} File(s)", title_style="bold green")
    summary_table.add_column("File", style="cyan")
    summary_table.add_column("Status", justify="center")
    summary_table.add_column("Chunks", justify="center")
    for fp, status, info in all_results:
        summary_table.add_row(os.path.basename(fp), status, info)
    console.print(summary_table)

    # -- Post-analysis Action Prompt ---------------------------------------
    # Only show for analyze/all command and when there were successful files
    if command == "analyze":
        done_files = [fp for fp, st, _ in all_results if "done" in st]
        if done_files:
            console.print()
            console.print(Panel(
                f"Analysis complete on [bold]{len(done_files)}[/] file(s). What next?\n\n"
                "  [bold cyan]f[/]  ->  Fix & refactor all analyzed files\n"
                "  [bold cyan]d[/]  ->  Generate inline documentation for all files\n"
                "  [bold cyan]a[/]  ->  Run full pipeline (fix + docgen) on all files\n"
                "  [bold cyan]n[/]  ->  Skip",
                title="Next Action",
                border_style="yellow",
                expand=False
            ))
            choice = console.input("[bold yellow]Choice (f/d/a/n) [n]: [/]").strip().lower()
            if choice in ("f", "d", "a"):
                cmd_map = {"f": "fix", "d": "docgen", "a": "all"}
                next_cmd = cmd_map[choice]
                console.print(f"\n[bold cyan]Running {next_cmd.upper()} on {len(done_files)} file(s)...[/]")
                handle_multi_files(done_files, next_cmd, url)
            else:
                console.print(
                    f"[dim]Skipped. Run [bold]ethrix fix <file>[/] anytime to apply fixes.[/]"
                )

def find_referenced_files(text: str) -> List[str]:
    """Detect file paths mentioned in user text. Case-insensitive on Windows."""
    import re
    words = re.findall(r'[a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+', text)
    found_normalized = set()
    found = []
    words_split = text.split()
    all_words = words + words_split

    for word in all_words:
        cleaned = word.strip(".,;:?!'\"()[]{}")
        # Direct match
        if os.path.exists(cleaned) and os.path.isfile(cleaned):
            abs_path = os.path.abspath(cleaned)
            if abs_path not in found_normalized:
                found_normalized.add(abs_path)
                found.append(os.path.normpath(cleaned))
        elif cleaned.lower() in ["makefile", "dockerfile", "license"]:
            if os.path.exists(cleaned) and os.path.isfile(cleaned):
                abs_path = os.path.abspath(cleaned)
                if abs_path not in found_normalized:
                    found_normalized.add(abs_path)
                    found.append(os.path.normpath(cleaned))
    return found


SUPPORTED_CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".cpp", ".c", ".h", ".hpp",
    ".java", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".kt",
    ".sh", ".bash", ".yml", ".yaml", ".json", ".toml", ".md"
}


def find_referenced_dirs(text: str) -> List[str]:
    """Detect directory/folder mentions in user text.
    Handles:
    - Exact paths: D:\\Ethrix-Forge, ./src, ../project
    - Single-word fuzzy: 'ethrix-forge folder'
    - Multi-word fuzzy: 'ethrix forge folder' -> tries ethrix-forge, ethrix_forge, ethrixforge
    - Case-insensitive matching on Windows
    """
    import re
    found = []
    found_abs = set()

    def _try_add(path_str: str):
        if os.path.isdir(path_str):
            abs_p = os.path.abspath(path_str)
            if abs_p not in found_abs:
                found_abs.add(abs_p)
                found.append(path_str)

    def _search_in_roots(name: str):
        """Case-insensitive search; also tries hyphen/underscore/concat for multi-word names."""
        name = name.strip(".,;:?!'\"()[]{}")
        if len(name) < 2:
            return
        # Build variants (handles 'ethrix forge' -> 'ethrix-forge' etc.)
        variants = [name]
        if " " in name:
            variants += [
                name.replace(" ", "-"),
                name.replace(" ", "_"),
                name.replace(" ", ""),
            ]
        search_roots = [
            os.getcwd(),
            os.path.dirname(os.getcwd()),
            os.path.expanduser("~"),
        ]
        for root in search_roots:
            try:
                entries = os.listdir(root)
            except PermissionError:
                continue
            for entry in entries:
                if any(entry.lower() == v.lower() for v in variants):
                    candidate = os.path.join(root, entry)
                    if os.path.isdir(candidate):
                        abs_p = os.path.abspath(candidate)
                        if abs_p not in found_abs:
                            found_abs.add(abs_p)
                            found.append(candidate)
                    break

    # 1. Exact path tokens (backslash/forward-slash paths)
    for token in re.findall(r'[a-zA-Z0-9_\-\./\\:]+', text):
        _try_add(token.strip(".,;:?!'\"()[]{}"))

    dir_kw = r'(?:folder|directory|dir|project|repo|workspace|codebase)'

    # 2. 1-3 words BEFORE a dir keyword: 'ethrix forge folder'
    for m in re.findall(
        r'([a-zA-Z0-9_\-\.]+(?:\s+[a-zA-Z0-9_\-\.]+){0,2})\s+' + dir_kw,
        text, re.IGNORECASE
    ):
        _search_in_roots(m)

    # 3. 1-3 words AFTER action verbs: 'scan ethrix forge', 'check ethrix-forge folder'
    for m in re.findall(
        r'(?:scan|check|list|analyze|analyse|review|inspect|open|show)'
        r'\s+(?:the\s+)?([a-zA-Z0-9_\-\.]+(?:\s+[a-zA-Z0-9_\-\.]+){0,2})',
        text, re.IGNORECASE
    ):
        _search_in_roots(m)

    return found


def scan_directory_for_context(dir_path: str) -> str:
    """Scan a directory and return a structured file tree as a string for AI context."""
    SKIP_DIRS = {'__pycache__', 'node_modules', '.git', 'venv', '.venv', 'dist', 'build', '.idea', '.vscode'}
    lines = [f"Directory: {os.path.abspath(dir_path)}"]
    total_files = 0
    code_files = 0
    file_list = []

    for root, dirs, files in os.walk(dir_path):
        dirs[:] = sorted([d for d in dirs if not d.startswith('.') and d not in SKIP_DIRS])
        level = root.replace(dir_path, '').count(os.sep)
        indent = '  ' * level
        rel_root = os.path.relpath(root, dir_path)
        if rel_root != '.':
            lines.append(f"{indent}📁 {os.path.basename(root)}/")
        for fname in sorted(files):
            total_files += 1
            ext = os.path.splitext(fname)[1].lower()
            sub_indent = '  ' * (level + 1)
            lines.append(f"{sub_indent}📄 {fname}")
            if ext in SUPPORTED_CODE_EXTENSIONS:
                code_files += 1
                file_list.append(os.path.join(root, fname))

    lines.append(f"\n--- Summary ---")
    lines.append(f"Total files      : {total_files}")
    lines.append(f"Code files       : {code_files}")
    lines.append(f"Supported types  : {', '.join(sorted(SUPPORTED_CODE_EXTENSIONS))}")
    return "\n".join(lines), total_files, code_files, file_list

def parse_natural_intent(text: str, files: List[str]) -> Optional[tuple[str, str]]:
    text_lower = text.lower()
    
    analyze_triggers = ["analyze", "scan", "review", "audit", "find bugs", "check bugs", "check security"]
    fix_triggers = ["fix", "refactor", "optimize", "improve", "rewrite", "correct"]
    docgen_triggers = ["document", "docgen", "comment", "docstring", "add docstring", "add comment"]
    
    for file in files:
        if any(trigger in text_lower for trigger in analyze_triggers):
            return ("analyze", file)
        if any(trigger in text_lower for trigger in fix_triggers):
            return ("fix", file)
        if any(trigger in text_lower for trigger in docgen_triggers):
            return ("docgen", file)
            
    return None

def _model_badge(config: dict) -> str:
    """Return a short colored badge string showing current provider + model."""
    provider = config.get("provider", "online")
    model = config.get("model", "unknown")
    if provider == "online":
        return f"[bold green]Online[/] [dim]|[/] [cyan]{model}[/]"
    else:
        return f"[bold yellow]Offline[/] [dim]|[/] [cyan]{model}[/]"


def handle_chat(url: str, initial_files: Optional[List[str]] = None):
    config = load_config()
    provider = config.get("provider", "online")
    model = config.get("model", "unknown")
    mode_label = "Online (Cloud)" if provider == "online" else f"Offline (Local Ollama)"

    console.print(Panel(
        Markdown(
            "# Ethrix Interactive AI Chat CLI\n"
            "Talk directly to the AI reviewer. You can type commands in natural language "
            "(e.g. `analyze test.cpp` or `explain main.py`).\n\n"
            "**Tip**: Simply mention a file name or folder in your message, and it will be loaded automatically!"
        ),
        title=f"Interactive Chat Mode  ·  {mode_label}  ·  Model: {model}",
        border_style="purple",
        expand=False
    ))
    console.print(f"  Active: {_model_badge(config)}  [dim](type /mode to switch, /status to check)[/]\n")
    
    history = []
    
    # Pre-load initial files
    if initial_files:
        for file_path in initial_files:
            if not os.path.exists(file_path):
                console.print(f"[bold red]Error:[/] File '{file_path}' does not exist. Skipping.")
                continue
            
            code = read_file(file_path, exit_on_error=False)
            if not code:
                continue
            lang = detect_language(file_path) or "text"
            num_lines = len(code.splitlines())
            
            # Add to history
            history.append({
                "role": "user",
                "text": f"Here is the content of the file '{file_path}':\n\n```{lang}\n{code}\n```"
            })
            history.append({
                "role": "model",
                "text": f"Loaded file '{file_path}' into context. How can I help you with this file?"
            })
            console.print(f"[green][+] Pre-loaded '{file_path}' into chat context ({num_lines} lines, language: {lang}).[/]")
            
    # Session memory: remember the last scanned directory + its code files
    # so follow-up questions like "check karo" work without re-specifying the dir
    last_scanned_dir = None
    last_scanned_files = []  # List of code file paths from last dir scan

    while True:
        try:
            model_short = config.get("model", "?").split(":")[0]  # e.g. 'granite4.1' from 'granite4.1:8b'
            user_input = console.input(f"\n[bold cyan]You[/] [dim]({model_short})[/][bold cyan] > [/]").strip()
            if not user_input:
                continue
                
            # Check for exit commands
            if user_input.lower() in ["exit", "quit"]:
                console.print("[bold yellow]Exiting chat session. Goodbye![/]")
                break
                
            # Check for slash commands (retained for convenience)
            if user_input.startswith("/"):
                parts = user_input.split(maxsplit=1)
                cmd = parts[0].lower()
                arg = parts[1].strip() if len(parts) > 1 else ""
                
                if cmd in ["/exit", "/quit"]:
                    console.print("[bold yellow]Exiting chat session. Goodbye![/]")
                    break
                    
                elif cmd == "/clear":
                    history = []
                    os.system("cls" if os.name == "nt" else "clear")
                    console.print(Panel(
                        Markdown("# Ethrix Interactive AI Chat CLI\nSession reset. Start a new conversation."),
                        title="Interactive Chat Mode",
                        border_style="purple",
                        expand=False
                    ))
                    continue
                    
                elif cmd == "/help":
                    help_md = (
                        "### Ethrix Chat Commands\n"
                        "- `/add <file_path>`: Load a local file's content into the chat context.\n"
                        "- `/analyze <file_path>`: Run bugs & security analysis inline.\n"
                        "- `/fix <file_path>`: Generate refactored code and explanation inline.\n"
                        "- `/docgen <file_path>`: Generate comments and conventional git commit message inline.\n"
                        "- `/config` or `/mode`: Run configuration setup to switch between Online and Offline modes.\n"
                        "- `/status`: Show currently active model and provider.\n"
                        "- `/clear`: Reset the chat history.\n"
                        "- `exit` or `quit`: End the interactive chat session."
                    )
                    console.print(Panel(Markdown(help_md), title="Commands Help", border_style="blue", expand=False))
                    continue

                elif cmd == "/status":
                    console.print(Panel(
                        f"  Active Model : {_model_badge(config)}\n"
                        f"  Provider     : [cyan]{config.get('provider', 'unknown')}[/]\n"
                        f"  Model Name   : [cyan]{config.get('model', 'unknown')}[/]\n"
                        f"  Backend URL  : [cyan]{url}[/]",
                        title="Ethrix Status",
                        border_style="green",
                        expand=False
                    ))
                    continue
                    
                elif cmd in ["/config", "/mode"]:
                    config = prompt_configuration(force=True)
                    provider = config.get("provider", "online")
                    model = config.get("model", "unknown")
                    console.print(f"[green][+] Chat updated -> {_model_badge(config)}[/]")
                    continue
                    
                elif cmd in ["/add", "/load"]:
                    if not arg:
                        console.print("[bold red]Usage:[/] /add <file_path>")
                        continue
                    if not os.path.exists(arg):
                        console.print(f"[bold red]Error:[/] File '{arg}' does not exist.")
                        continue
                    
                    code = read_file(arg, exit_on_error=False)
                    if code is None:
                        continue
                    lang = detect_language(arg) or "text"
                    num_lines = len(code.splitlines())
                    
                    history.append({
                        "role": "user",
                        "text": f"Here is the content of the file '{arg}':\n\n```{lang}\n{code}\n```"
                    })
                    history.append({
                        "role": "model",
                        "text": f"Loaded file '{arg}' into context. How can I help you with this file?"
                    })
                    console.print(f"[green][+] Successfully loaded '{arg}' into chat context ({num_lines} lines, language: {lang}).[/]")
                    continue
                    
                elif cmd == "/analyze":
                    if not arg:
                        console.print("[bold red]Usage:[/] /analyze <file_path>")
                        continue
                    if not os.path.exists(arg):
                        console.print(f"[bold red]Error:[/] File '{arg}' does not exist.")
                        continue
                    handle_analyze(arg, url, exit_on_error=False)
                    continue
                    
                elif cmd == "/fix":
                    if not arg:
                        console.print("[bold red]Usage:[/] /fix <file_path>")
                        continue
                    if not os.path.exists(arg):
                        console.print(f"[bold red]Error:[/] File '{arg}' does not exist.")
                        continue
                    handle_fix(arg, url, exit_on_error=False)
                    continue
                    
                elif cmd == "/docgen":
                    if not arg:
                        console.print("[bold red]Usage:[/] /docgen <file_path>")
                        continue
                    if not os.path.exists(arg):
                        console.print(f"[bold red]Error:[/] File '{arg}' does not exist.")
                        continue
                    handle_docgen(arg, url, exit_on_error=False)
                    continue
                    
                else:
                    console.print(f"[bold red]Unknown command:[/] {cmd}. Type `/help` to view available commands.")
                    continue
            
            # ── 0. Follow-up Intent on Previously Scanned Dir ─────────────
            # If user says check/analyze/dikkat etc. after a dir scan, auto-run multi-file analysis
            if last_scanned_files:
                followup_triggers = [
                    "check", "analyze", "analyse", "scan", "review", "audit",
                    "dikkat", "problem", "issue", "bug", "error", "koi",
                    "inn", "inhe", "unhe", "in files", "these files",
                    "kya hai", "bata", "dekho", "dekhna", "find"
                ]
                user_lower = user_input.lower()
                is_followup = any(t in user_lower for t in followup_triggers)
                # Make sure it's not a new dir/file reference
                has_new_ref = bool(find_referenced_dirs(user_input) or find_referenced_files(user_input))
                
                if is_followup and not has_new_ref:
                    console.print(
                        f"[dim yellow][*] Using previously scanned directory: '[cyan]{last_scanned_dir}[/]' "
                        f"({len(last_scanned_files)} code file(s))[/]"
                    )
                    handle_multi_files(last_scanned_files, "analyze", url)
                    continue

            # ── 1. Directory Detection (check BEFORE file detection) ──────
            referenced_dirs = find_referenced_dirs(user_input)
            if referenced_dirs:
                # Scan all mentioned directories
                all_dir_files = []
                augmented_message = user_input
                for dir_path in referenced_dirs:
                    abs_dir = os.path.abspath(dir_path)
                    console.print(f"[dim green][+] Auto-scanned directory '[cyan]{abs_dir}[/]'...[/]")
                    try:
                        tree_str, total_files, code_files, file_list = scan_directory_for_context(dir_path)
                    except Exception as e:
                        console.print(f"[bold red]Could not scan '{dir_path}':[/] {e}")
                        continue
                    # Save to session memory
                    last_scanned_dir = abs_dir
                    last_scanned_files = file_list
                    all_dir_files.extend(file_list)
                    augmented_message += (
                        f"\n\n[Workspace Context: Directory scan of '{abs_dir}']\n"
                        f"```\n{tree_str}\n```\n"
                        f"Note to AI: This directory has {total_files} total files, {code_files} are code files."
                    )

                user_lower = user_input.lower()

                # ── Smart Intent: specific file + action within dir ───────
                # e.g. "main.py mein bug hai?" → analyze main.py directly
                specific_files = find_referenced_files(user_input)
                analyze_kw = ["bug", "error", "issue", "dikkat", "analyze", "analyse",
                              "scan", "review", "audit", "check", "security", "problem"]
                fix_kw     = ["fix", "refactor", "optimize", "improve", "correct"]
                docgen_kw  = ["document", "docgen", "comment", "docstring"]

                if specific_files:
                    # Resolve relative paths — try against each scanned dir
                    resolved = []
                    for sf in specific_files:
                        if os.path.isfile(sf):
                            resolved.append(os.path.abspath(sf))
                        else:
                            # Try finding in last scanned dir
                            for dir_path in referenced_dirs:
                                candidate = os.path.join(dir_path, sf)
                                if os.path.isfile(candidate):
                                    resolved.append(os.path.abspath(candidate))
                                    break
                                # Also try by basename match
                                for f in all_dir_files:
                                    if os.path.basename(f).lower() == os.path.basename(sf).lower():
                                        resolved.append(f)
                                        break

                    if resolved:
                        target = resolved[0]
                        if any(k in user_lower for k in analyze_kw):
                            console.print(f"[dim yellow][*] Analyzing specific file: [cyan]{os.path.basename(target)}[/][/]")
                            handle_analyze(target, url, exit_on_error=False)
                            continue
                        elif any(k in user_lower for k in fix_kw):
                            console.print(f"[dim yellow][*] Fixing specific file: [cyan]{os.path.basename(target)}[/][/]")
                            handle_fix(target, url, exit_on_error=False)
                            continue
                        elif any(k in user_lower for k in docgen_kw):
                            console.print(f"[dim yellow][*] Generating docs for: [cyan]{os.path.basename(target)}[/][/]")
                            handle_docgen(target, url, exit_on_error=False)
                            continue

                # ── Smart Intent: dir-level action (no specific file) ────
                # e.g. "koi bug hai inn files mein?" → multi-file analyze
                if all_dir_files and any(k in user_lower for k in analyze_kw):
                    console.print(f"[dim yellow][*] Running analysis on {len(all_dir_files)} files in scanned dir(s)...[/]")
                    handle_multi_files(all_dir_files, "analyze", url)
                    continue
                elif all_dir_files and any(k in user_lower for k in fix_kw):
                    console.print(f"[dim yellow][*] Running fix on {len(all_dir_files)} files...[/]")
                    handle_multi_files(all_dir_files, "fix", url)
                    continue

                # ── Default: send dir context to chat ────────────────────
                try:
                    with console.status("[dim]Ethrix is thinking...[/]"):
                        payload = {
                            "message": augmented_message,
                            "history": history,
                            "provider": config.get("provider", "online"),
                            "model": config.get("model")
                        }
                        response = requests.post(f"{url}/chat", json=payload, timeout=120)
                except requests.exceptions.Timeout:
                    console.print("[bold red]Timeout:[/] Model took too long to respond.")
                    continue
                except requests.exceptions.ConnectionError:
                    console.print("[bold red]Connection Error:[/] Lost connection to backend.")
                    break
                if response.status_code == 200:
                    data = response.json()
                    reply = data.get("reply", "")
                    console.print("\n[bold purple]Ethrix >[/]")
                    display_reply(reply)
                    history.append({"role": "user", "text": augmented_message})
                    history.append({"role": "model", "text": reply})
                else:
                    console.print(f"[bold red]API Error ({response.status_code}):[/] {response.text}")

                continue

            # ── 2. File Detection ─────────────────────────────────────────
            referenced_files = find_referenced_files(user_input)
            
            if referenced_files:
                # Check for structured action triggers
                intent = parse_natural_intent(user_input, referenced_files)
                if intent:
                    action, file_path = intent
                    if action == "analyze":
                        handle_analyze(file_path, url, exit_on_error=False)
                    elif action == "fix":
                        handle_fix(file_path, url, exit_on_error=False)
                    elif action == "docgen":
                        handle_docgen(file_path, url, exit_on_error=False)
                    continue
                
                # Conversational mode with automatic file auto-loading
                augmented_message = user_input
                for file_path in referenced_files:
                    code = read_file(file_path, exit_on_error=False)
                    if code:
                        lang = detect_language(file_path) or "text"
                        num_lines = len(code.splitlines())
                        console.print(f"[dim green][+] Auto-loaded '{file_path}' into context ({num_lines} lines).[/]")
                        augmented_message += f"\n\n[Context: Content of '{file_path}']:\n```{lang}\n{code}\n```"
                
                try:
                    with console.status("[dim]Ethrix is thinking...[/]"):
                        payload = {
                            "message": augmented_message,
                            "history": history,
                            "provider": config.get("provider", "online"),
                            "model": config.get("model")
                        }
                        response = requests.post(f"{url}/chat", json=payload, timeout=120)
                except requests.exceptions.Timeout:
                    console.print("[bold red]Timeout:[/] Model took too long to respond. Try again or use a faster model.")
                    continue
                except requests.exceptions.ConnectionError:
                    console.print("[bold red]Connection Error:[/] Lost connection to backend. Try restarting Ethrix.")
                    break
                    
                if response.status_code != 200:
                    console.print(f"[bold red]API Error (Status {response.status_code}):[/] {response.text}")
                    continue
                    
                data = response.json()
                reply = data.get("reply", "")
                
                console.print("\n[bold purple]Ethrix >[/]")
                display_reply(reply)
                
                history.append({"role": "user", "text": augmented_message})
                history.append({"role": "model", "text": reply})
                continue
                
            # Standard conversational mode
            try:
                with console.status("[dim]Ethrix is thinking...[/]"):
                    payload = {
                        "message": user_input,
                        "history": history,
                        "provider": config.get("provider", "online"),
                        "model": config.get("model")
                    }
                    response = requests.post(f"{url}/chat", json=payload, timeout=120)
            except requests.exceptions.Timeout:
                console.print("[bold red]Timeout:[/] Model took too long to respond. Try again or use a faster model.")
                continue
            except requests.exceptions.ConnectionError:
                console.print("[bold red]Connection Error:[/] Lost connection to backend. Try restarting Ethrix.")
                break
                
            if response.status_code != 200:
                console.print(f"[bold red]API Error (Status {response.status_code}):[/] {response.text}")
                continue
                
            data = response.json()
            reply = data.get("reply", "")
            
            console.print("\n[bold purple]Ethrix >[/]")
            display_reply(reply)
            
            history.append({"role": "user", "text": user_input})
            history.append({"role": "model", "text": reply})
            
        except KeyboardInterrupt:
            console.print("\n[bold yellow]Session interrupted. Goodbye![/]")
            break
        except Exception as e:
            console.print(f"[bold red]Unexpected Error:[/] {e}")

def handle_all(file_path: str, url: str):
    """Run the full pipeline: analyze → fix → docgen.
    Suppresses individual browser reports to avoid opening 3 tabs.
    Shows a combined terminal summary at the end.
    """
    console.print(f"\n[bold cyan]=== RUNNING FULL CODE REVIEW & OPTIMIZATION PIPELINE ===[/]")
    console.print(f"[dim]File: {file_path}[/]\n")
    
    config = load_config()
    provider = config.get("provider", "online")
    model = config.get("model", "llama-3.3-70b-versatile")
    code = read_file(file_path)
    if code is None:
        return
    lang = detect_language(file_path) or "text"
    
    combined_sections = []

    # ── Step 1: Analyze ──────────────────────────────────────────────────
    console.print("[bold cyan]>> Step 1/3: Analyzing for Bugs & Security Risks...[/]")
    try:
        r = requests.post(f"{config.get('url', 'http://127.0.0.1:8000')}/analyze",
                          json={"code": code, "language": lang, "provider": provider, "model": model},
                          timeout=120)
        if r.status_code == 200:
            data = r.json()
            table = Table(title="Step 1 — Analysis Summary", title_style="bold cyan")
            table.add_column("Type", style="bold"); table.add_column("Severity"); table.add_column("Line(s)", justify="center"); table.add_column("Description")
            has_issues = False
            for bug in data.get("bugs", []):
                has_issues = True
                sev = bug.get("severity", "Medium")
                sev_color = "red" if sev.lower() == "high" else ("yellow" if sev.lower() == "medium" else "blue")
                table.add_row("Bug/Flaw", f"[{sev_color}]{sev}[/]", bug.get("line_number") or "N/A", bug.get("description", ""))
            for risk in data.get("security_risks", []):
                has_issues = True
                sev = risk.get("severity", "Medium")
                sev_color = "red" if sev.lower() == "high" else ("yellow" if sev.lower() == "medium" else "blue")
                table.add_row("Security Risk", f"[bold {sev_color}]{sev}[/]", risk.get("line_number") or "N/A", risk.get("description", ""))
            if not has_issues:
                table.add_row("Clean", "[green]None[/]", "-", "No bugs or security issues detected!")
            console.print(table)
            combined_sections.append(("## Code Analysis Report", data.get("raw_markdown_report", "")))
        else:
            console.print(f"[bold red]Analyze API Error ({r.status_code}):[/] {r.text}")
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        console.print(f"[bold red]Step 1 failed:[/] {e}")

    # ── Step 2: Fix ───────────────────────────────────────────────────────
    console.print("\n[bold cyan]>> Step 2/3: Generating Code Fixes & Refactoring...[/]")
    try:
        r = requests.post(f"{config.get('url', 'http://127.0.0.1:8000')}/fix",
                          json={"code": code, "language": lang, "provider": provider, "model": model},
                          timeout=120)
        if r.status_code == 200:
            data = r.json()
            refactored = clean_newlines(data.get("refactored_code", ""))
            explanation = clean_newlines(data.get("explanation", ""))
            import difflib
            diff = "".join(difflib.unified_diff(
                code.splitlines(keepends=True), refactored.splitlines(keepends=True),
                fromfile=f"a/{os.path.basename(file_path)}", tofile=f"b/{os.path.basename(file_path)}", lineterm=""))
            if diff:
                console.print(Panel(Syntax(diff, "diff", theme="monokai"), title="Step 2 — Code Changes (Diff)", border_style="cyan"))
            else:
                console.print("[green]Step 2: Code already optimized — no changes needed.[/]")
            combined_sections.append(("## Refactored Code & Explanation", f"```{lang}\n{refactored}\n```\n\n{explanation}"))
        else:
            console.print(f"[bold red]Fix API Error ({r.status_code}):[/] {r.text}")
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        console.print(f"[bold red]Step 2 failed:[/] {e}")

    # ── Step 3: Docgen ────────────────────────────────────────────────────
    console.print("\n[bold cyan]>> Step 3/3: Generating Inline Documentation...[/]")
    try:
        r = requests.post(f"{config.get('url', 'http://127.0.0.1:8000')}/docgen",
                          json={"code": code, "language": lang, "provider": provider, "model": model},
                          timeout=120)
        if r.status_code == 200:
            data = r.json()
            commit_msg = clean_newlines(data.get("commit_message", ""))
            documented = clean_newlines(data.get("documented_code", ""))
            if commit_msg:
                console.print(Panel(Text(commit_msg, style="bold green"), title="Step 3 — Suggested Git Commit", border_style="cyan"))
            combined_sections.append(("## Documented Code", f"```{lang}\n{documented}\n```\n\n**Commit:** `{commit_msg}`"))
        else:
            console.print(f"[bold red]Docgen API Error ({r.status_code}):[/] {r.text}")
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        console.print(f"[bold red]Step 3 failed:[/] {e}")

    # ── Combined Browser Report ───────────────────────────────────────────
    if combined_sections:
        full_md = f"# Ethrix Full Pipeline Report\n**File:** `{file_path}`\n\n---\n\n"
        full_md += "\n\n---\n\n".join(f"{title}\n\n{body}" for title, body in combined_sections)
        console.print("\n[yellow][*] Opening combined full-pipeline report in browser...[/]")
        export_to_temp_html_and_open(f"Full Pipeline: {os.path.basename(file_path)}", full_md)

    console.print("\n[bold green][SUCCESS] Full Code Review Pipeline Completed![/]\n")


def main():
    # Fallback: if no subcommand or file path is provided, default to "chat"
    # Note: we also check if only global flags like --url are passed without a command.
    has_command = False
    for cmd in ["analyze", "fix", "docgen", "all", "chat", "config", "-h", "--help"]:
        if cmd in sys.argv:
            has_command = True
            break
            
    if not has_command:
        # Check if the user passed a file as the first argument
        # Look for the first argument that doesn't start with a hyphen
        first_non_flag = None
        for arg in sys.argv[1:]:
            if not arg.startswith("-"):
                first_non_flag = arg
                break
                
        if first_non_flag:
            if os.path.exists(first_non_flag) or "." in first_non_flag:
                # Insert "analyze" before the file path
                idx = sys.argv.index(first_non_flag)
                sys.argv.insert(idx, "analyze")
        else:
            # No files or subcommands: default to "chat"
            sys.argv.append("chat")

    parser = argparse.ArgumentParser(
        description="Ethrix: The AI-Powered Code Reviewer Command Line Interface (Ethrix-Forge)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8000",
        help="Base URL of the core FastAPI server (default: http://127.0.0.1:8000)"
    )
    
    subparsers = parser.add_subparsers(dest="command", required=True, help="Subcommands to execute")
    
    # Subcommand: analyze
    analyze_parser = subparsers.add_parser("analyze", help="Scan file(s)/directory for bugs and security risks")
    analyze_parser.add_argument("file_path", nargs="+", help="Path(s) to file(s) or a directory to analyze")
    
    # Subcommand: fix
    fix_parser = subparsers.add_parser("fix", help="Optimize and refactor code file(s)")
    fix_parser.add_argument("file_path", nargs="+", help="Path(s) to file(s) or a directory to fix")
    
    # Subcommand: docgen
    docgen_parser = subparsers.add_parser("docgen", help="Generate inline documentation for file(s)")
    docgen_parser.add_argument("file_path", nargs="+", help="Path(s) to file(s) or a directory")
    
    # Subcommand: all
    all_parser = subparsers.add_parser("all", help="Full pipeline (analyze + fix + docgen) on file(s)")
    all_parser.add_argument("file_path", nargs="+", help="Path(s) to file(s) or a directory")
    
    # Subcommand: chat
    chat_parser = subparsers.add_parser("chat", help="Start an interactive chat session with the AI reviewer")
    chat_parser.add_argument("file_paths", nargs="*", help="Optional local files to pre-load into the chat context")
    
    # Subcommand: config
    config_parser = subparsers.add_parser("config", help="Run the configuration wizard to select mode (Online vs. Offline)")
    
    args = parser.parse_args()
    
    # Run configuration setup
    if args.command == "config":
        prompt_configuration(force=True)
        sys.exit(0)
    else:
        # Use saved config if available; only prompt on first run or via 'config' command
        config = prompt_configuration(force=False)
        
    # Auto-start Ollama if provider is offline
    if config.get("provider") == "offline":
        ensure_ollama_running()
        
    # Auto-start backend server if it is not already running
    ensure_server_running(args.url)
    
    if args.command == "analyze":
        if len(args.file_path) == 1 and os.path.isfile(args.file_path[0]):
            handle_analyze(args.file_path[0], args.url)  # Single file — original fast path
        else:
            handle_multi_files(args.file_path, "analyze", args.url)
    elif args.command == "fix":
        if len(args.file_path) == 1 and os.path.isfile(args.file_path[0]):
            handle_fix(args.file_path[0], args.url)
        else:
            handle_multi_files(args.file_path, "fix", args.url)
    elif args.command == "docgen":
        if len(args.file_path) == 1 and os.path.isfile(args.file_path[0]):
            handle_docgen(args.file_path[0], args.url)
        else:
            handle_multi_files(args.file_path, "docgen", args.url)
    elif args.command == "all":
        if len(args.file_path) == 1 and os.path.isfile(args.file_path[0]):
            handle_all(args.file_path[0], args.url)
        else:
            handle_multi_files(args.file_path, "all", args.url)
    elif args.command == "chat":
        handle_chat(args.url, args.file_paths)

if __name__ == "__main__":
    main()
