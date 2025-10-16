# EnvHub

[中文](./README.zh-CN.md) | English

A modern development environment manager for Windows and macOS, providing one-click installation and multi-version management for popular development tools and databases.

## Features

- **Multi-Platform Support**: `win-x64`, `darwin-x64`, `darwin-arm64` with automatic platform detection and Rosetta compatibility
- **Online Installation**: Download and install from official mirrors (npmmirror, EDB, Foojay, etc.)
- **Multi-Version Management**: Install and switch between multiple versions seamlessly
- **Shim-Based Architecture**: Version switching without administrator privileges using `~/.envhub/shims`
- **Supported Tools**:
  - **Languages**: Python, Node.js, Java (Temurin, Oracle, Corretto, GraalVM, Zulu, Liberica, Microsoft)
  - **Databases**: PostgreSQL (with pgvector extension), Redis (Redis Stack / Windows port)
- **Smart Features**:
  - Download resume support for interrupted downloads
  - Package caching for faster re-installation
  - Real-time installation progress tracking
  - Automatic PATH management
- **Modern GUI**: Built with Electron + Vue 3 + TypeScript + Arco Design

## Installation

### Download

Download the latest release for your platform:

- **macOS**: `EnvHub-{version}-arm64.dmg` (Apple Silicon) or `EnvHub-{version}-x64.dmg` (Intel)
- **Windows**: `EnvHub-{version}-win-x64.exe`

### First Launch

**Note**: EnvHub is an open-source application without code signing. This is a deliberate choice as the project is 100% transparent and maintained by developers for developers.

**macOS Users:**

On first launch, macOS Gatekeeper will block the app. To open:

1. Right-click (or Control-click) the app icon
2. Select "Open"
3. Click "Open" in the dialog

Or remove quarantine attribute in Terminal:
```bash
xattr -cr /Applications/EnvHub.app
```

**Windows Users:**

Windows SmartScreen may show a warning. To proceed:

1. Click "More info"
2. Click "Run anyway"

**After First Launch:**

1. The app will automatically detect your platform and show available tools
2. Browse Languages or Databases tabs to see what you can install

## Quick Start

### 1. Install a Tool

1. Navigate to **Languages** or **Databases** tab
2. Click **Refresh** to fetch latest versions from online sources
3. Select the version you want to install
4. Click **Install** and wait for download to complete
5. The tool will be automatically extracted and configured

### 2. Set as Active Version

After installation, click **Set as Current** to:
- Generate shim scripts in `~/.envhub/shims`
- Make the selected version active globally

### 3. Configure PATH

Add `~/.envhub/shims` to your system PATH:

**macOS/Linux:**
```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH="$HOME/.envhub/shims:$PATH"
```

**Windows:**
1. Search for "Environment Variables" in Windows Settings
2. Edit User PATH variable
3. Add `%USERPROFILE%\.envhub\shims`

Or use the built-in PATH manager in **Settings** tab for one-click setup.

### 4. Verify Installation

Open a new terminal and run:
```bash
python --version
node --version
java --version
psql --version
redis-server --version
```

## Directory Structure

```
~/.envhub/
├── cache/
│   ├── downloads/         # Downloaded installation packages
│   ├── temp/              # Temporary extraction files
│   └── versions-cache.json # Cached version lists (24h TTL)
├── toolchains/            # Installed tool versions
│   ├── python/{version}/{platform}/
│   ├── node/{version}/{platform}/
│   ├── java/{version}/{platform}/
│   └── pg/{version}/{platform}/
├── shims/                 # Version switching scripts
│   ├── python, pip, python3
│   ├── node, npm, npx, corepack, pnpm
│   ├── java, javac, jar
│   ├── psql, pg_ctl, postgres, initdb
│   └── redis-server, redis-cli
├── logs/                  # Installation and runtime logs
├── pg/                    # PostgreSQL data directories
│   └── {major}/
│       └── {cluster}/
│           ├── data/      # Database files
│           └── logs/      # Server logs
└── state.json             # Installed versions and active selections
```

## Development

### Prerequisites

- Node.js 18+ and pnpm
- Git

### Setup

```bash
# Clone repository
git clone <repository-url>
cd envhub

# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

### Available Scripts

```bash
# Development
pnpm dev              # Start dev server with HMR

# Type checking
pnpm typecheck        # Check all modules
pnpm typecheck:node   # Check main + preload
pnpm typecheck:web    # Check renderer

# Code quality
pnpm lint             # Lint code
pnpm format           # Format code

# Build
pnpm build            # Build for production
pnpm build:mac        # Build macOS installer
pnpm build:win        # Build Windows installer
pnpm build:linux      # Build Linux installer
```

### Project Structure

- **`src/main/`**: Electron main process
  - `envhub/core/`: Core modules (platform, paths, logging, extraction)
  - `envhub/registry/`: Online version sources and downloader
  - `envhub/runtimes/`: Language installers (Python, Node, Java)
  - `envhub/databases/`: Database installers (PostgreSQL, Redis)
  - `envhub/env/`: Environment management (shims, PATH, autostart)
- **`src/preload/`**: Secure IPC bridge via `contextBridge`
- **`src/renderer/`**: Vue 3 application
  - `views/`: Main views (Languages, Databases, Settings, Logs)
  - `components/`: Reusable UI components
  - `store/`: Pinia state management

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/), [Vue 3](https://vuejs.org/), and [TypeScript](https://www.typescriptlang.org/)
- UI components from [Arco Design](https://arco.design/)
- Uses [python-build-standalone](https://github.com/indygreg/python-build-standalone) for Python distributions
- Uses [Foojay DiscoAPI](https://api.foojay.io/) for Java distributions
- Uses [EDB binaries](https://www.enterprisedb.com/) for PostgreSQL
- Uses [Redis Stack](https://redis.io/docs/stack/) for macOS/Linux Redis
- Uses [tporadowski/redis](https://github.com/tporadowski/redis) for Windows Redis
