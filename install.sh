#!/usr/bin/env bash
# Ethrix-Forge Unix Installer (Bash)
# Installs Ethrix-Forge globally under $HOME/.ethrix-forge and configures shell PATH.

set -e

echo "============================================="
echo "       Ethrix-Forge CLI Installer            "
echo "============================================="

# 1. Prerequisites Verification
echo "[*] Verifying Python 3 installation..."
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is not found in your PATH. Please install Python 3 and try again."
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "[+] Found Python: $PYTHON_VERSION"

# 2. Setup Target Directory
INSTALL_DIR="$HOME/.ethrix-forge"
if [ -d "$INSTALL_DIR" ]; then
    echo "[*] Existing installation found at $INSTALL_DIR. Overwriting..."
    rm -rf "$INSTALL_DIR"
fi
mkdir -p "$INSTALL_DIR"

# 3. Download Zip from GitHub
ZIP_URL="https://github.com/Shantanu-Pathak-1/Ethrix-Forge/archive/refs/heads/master.zip"
ZIP_PATH="/tmp/ethrix-forge.zip"

echo "[*] Downloading Ethrix-Forge codebase from GitHub..."
if command -v curl &>/dev/null; then
    curl -L -o "$ZIP_PATH" "$ZIP_URL"
elif command -v wget &>/dev/null; then
    wget -O "$ZIP_PATH" "$ZIP_URL"
else
    echo "Error: Neither curl nor wget was found. Please install one of them."
    exit 1
fi

# 4. Extract Files
echo "[*] Extracting files..."
EXTRACT_TEMP="/tmp/ethrix-temp"
rm -rf "$EXTRACT_TEMP"
mkdir -p "$EXTRACT_TEMP"

if command -v unzip &>/dev/null; then
    unzip -q "$ZIP_PATH" -d "$EXTRACT_TEMP"
else
    echo "Error: 'unzip' utility is required but not installed."
    exit 1
fi

# Locate the extracted directory
SUBFOLDER=$(find "$EXTRACT_TEMP" -maxdepth 1 -type d | grep -v "^$EXTRACT_TEMP$" | head -n 1)

# Copy everything including hidden files
cp -R "$SUBFOLDER"/. "$INSTALL_DIR/"

# Cleanup temp files
rm -f "$ZIP_PATH"
rm -rf "$EXTRACT_TEMP"

# Make the launcher script executable
chmod +x "$INSTALL_DIR/ethrix"

# 5. Install Dependencies
echo "[*] Installing Python dependencies..."
python3 -m pip install -r "$INSTALL_DIR/backend/requirements.txt" --break-system-packages 2>/dev/null || \
python3 -m pip install -r "$INSTALL_DIR/backend/requirements.txt" --user 2>/dev/null || \
python3 -m pip install -r "$INSTALL_DIR/backend/requirements.txt" || true

python3 -m pip install rich requests fastapi uvicorn --break-system-packages 2>/dev/null || \
python3 -m pip install rich requests fastapi uvicorn --user 2>/dev/null || \
python3 -m pip install rich requests fastapi uvicorn || true

# 6. Configure Environment PATH
echo "[*] Configuring shell profiles..."
PATH_LINE="export PATH=\"\$HOME/.ethrix-forge:\$PATH\""
SHELL_CONFIGS=("$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.bash_profile")
CONFIGURED_ANY=false

for CONFIG in "${SHELL_CONFIGS[@]}"; do
    if [ -f "$CONFIG" ]; then
        if ! grep -q ".ethrix-forge" "$CONFIG"; then
            echo "" >> "$CONFIG"
            echo "# Ethrix-Forge CLI PATH Setup" >> "$CONFIG"
            echo "$PATH_LINE" >> "$CONFIG"
            echo "[+] Added PATH setup to $CONFIG"
        fi
        CONFIGURED_ANY=true
    fi
done

if [ "$CONFIGURED_ANY" = false ]; then
    echo "Warning: Shell config files (~/.bashrc, ~/.zshrc) were not found."
    echo "Please manually add the following line to your shell configuration:"
    echo "  $PATH_LINE"
fi

# 7. Success Output
echo ""
echo "============================================="
echo "    Ethrix-Forge Installed Successfully!     "
echo "============================================="
echo "Please restart your terminal session to apply PATH changes."
echo "To use the CLI, run:"
echo "  ethrix chat"
echo "============================================="
