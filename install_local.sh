#!/bin/bash
# Ethrix-Forge Local Unix Installer
# Installs the local cloned repository globally by linking the current directory directly to shell PATH.

set -e

echo "============================================="
echo "       Ethrix-Forge Local Installer          "
echo "============================================="

# 1. Verify Python
echo "[*] Verifying Python installation..."
if ! command -v python3 &>/dev/null; then
    echo "[-] Python 3 not found. Please install Python 3."
    exit 1
fi
echo "[+] Found Python: $(python3 --version)"

# 2. Configure PATH
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[*] Registering local directory to shell PATH..."
chmod +x "$CURRENT_DIR/ethrix"

SHELL_NAME=$(basename "$SHELL")
CONFIG_FILE=""
if [ "$SHELL_NAME" = "zsh" ]; then
    CONFIG_FILE="$HOME/.zshrc"
elif [ "$SHELL_NAME" = "bash" ]; then
    CONFIG_FILE="$HOME/.bashrc"
else
    CONFIG_FILE="$HOME/.profile"
fi

if [ -f "$CONFIG_FILE" ]; then
    if ! grep -q "$CURRENT_DIR" "$CONFIG_FILE"; then
        echo "export PATH=\"\$PATH:$CURRENT_DIR\"" >> "$CONFIG_FILE"
        echo "[+] Successfully added $CURRENT_DIR to PATH in $CONFIG_FILE!"
    else
        echo "[*] $CURRENT_DIR is already present in $CONFIG_FILE PATH."
    fi
else
    echo "[-] Shell config file $CONFIG_FILE not found. Please add the following manually to your PATH:"
    echo "export PATH=\"\$PATH:$CURRENT_DIR\""
fi

# 3. Install Dependencies
echo "[*] Installing Python dependencies..."
python3 -m pip install -r "$CURRENT_DIR/backend/requirements.txt" --quiet
python3 -m pip install rich requests fastapi uvicorn --quiet
echo "[+] Dependencies verified successfully."

echo ""
echo "============================================="
echo "    Ethrix-Forge Installed Locally!          "
echo "============================================="
echo "Please run: source $CONFIG_FILE"
echo "To run the CLI: ethrix chat"
echo "============================================="
