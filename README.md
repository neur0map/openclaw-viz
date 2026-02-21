<div align="center">

# Prowl

**Your second monitor while AI writes the code.**

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](https://github.com/neur0map/prowl/releases)
[![Beta](https://img.shields.io/badge/status-beta-orange.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/neur0map/prowl/pulls)

<br />

[Features](#features) · [Quick Start](#quick-start) · [Why Prowl](#why-prowl) · [Languages](#supported-languages) · [Tech Stack](#tech-stack)

<br />

## See Prowl in Action

<video src="https://github.com/neur0map/prowl/raw/main/public/media/prowl.mp4" controls width="800"></video>

<br />

### Focus Graph

<img src="public/media/focus-graph.png" alt="Prowl Focus Graph" width="800" />

<br />

### Code Editor View

<img src="public/media/code.png" alt="Prowl Code Editor" width="800" />

</div>

---

## Why Prowl

You're vibe coding — shipping fast with AI writing most of it. Claude Code, Codex, or Gemini CLI running in your terminal. Files appearing, changing, disappearing. You're watching text scroll by, hoping nothing breaks.

Prowl gives you the picture.

| Problem | Prowl |
|---------|-------|
| Staring at terminal output, guessing what's changing | Watch files light up on a graph in real time |
| Need to understand code without reading it | Ask questions in a separate chat |
| Bloating your AI coder's context with "what does X do?" | Query Prowl instead, keep your main context clean |
| Want to explore a GitHub repo before cloning | Paste the URL, browse the structure |
| Searching folders for "the file that handles auth" | Graph shows relationships, chat finds it instantly |

---

## Why Give It a Try

| If you... | Prowl helps by... |
|-----------|-------------------|
| Use Claude Code, Codex, Gemini CLI, or similar | Showing live file activity while they work |
| Work on unfamiliar codebases | Mapping structure without reading every file |
| Want to save tokens | Querying Prowl instead of your main coder |
| Review AI-generated code | Seeing what changed at a glance |
| Explore open source projects | Browsing GitHub repos without cloning |

---

## Features

### Core

| Feature | Description |
|---------|-------------|
| **Live Graph** | Files, functions, classes rendered as nodes. Updates in real time as files change. |
| **Built-in Terminal** | Run your AI coder here. Multiple tabs. Watch the graph while it works. |
| **Code Editor** | Click any node to view or edit. Monaco-powered. |
| **Codebase Chat** | Ask questions about your code. Doesn't touch your main coder's context. |

### Detection

Four layers running in parallel:

| Layer | What it catches |
|-------|-----------------|
| Filesystem watcher | File writes, additions, removals |
| Claude Code log parser | Structured tool events from JSONL logs |
| Process monitor | Which processes have files open |
| WebSocket client | OpenClaw workspace events |

### Chat Tools

| Tool | Purpose |
|------|---------|
| Hybrid search | BM25 + semantic embeddings + rank fusion |
| Cypher queries | Query the graph database directly |
| Regex grep | Pattern search across files |
| File reader | Read file contents |
| Symbol explorer | Browse functions, classes, imports |
| Impact analysis | Trace what depends on what |

### Other

| Feature | Description |
|---------|-------------|
| **GitHub import** | Paste a repo URL, explore without cloning |
| **ZIP support** | Drag and drop archives |
| **Community detection** | Leiden algorithm clusters related code |
| **Process tracing** | Trace execution paths through call graphs |
| **MCP server** | Query indexed DB from external tools |

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Python** 3.x with `setuptools` (needed for native module compilation)
- **Git**

### Development

```bash
git clone https://github.com/neur0map/prowl.git
cd prowl
npm install
npm run dev
```

This starts the Electron app with hot reload.

---

## The Workflow

```
1. Open your project in Prowl
          ↓
2. Launch your AI coder in the built-in terminal
          ↓
3. Watch nodes pulse as files change
          ↓
4. Need context? Ask Prowl's chat (saves tokens)
          ↓
5. Found the file? Copy path → feed to your AI
          ↓
6. Quick fix? Edit directly in Prowl
```

---

## Loading a Codebase

| Method | How |
|--------|-----|
| Local folder | Pick a directory, Prowl parses and watches |
| GitHub URL | Paste URL, explore without cloning |
| ZIP file | Drag and drop |

Prowl uses tree-sitter to extract symbols and builds a graph database (KuzuDB) you can query with Cypher.

---

## Supported Languages

| Language | Status |
|----------|--------|
| JavaScript | Supported |
| TypeScript | Supported |
| Python | Supported |
| Java | Supported |
| Go | Supported |
| Rust | Supported |
| C | Supported |
| C++ | Supported |
| C# | Supported |

---

## LLM Providers

| Provider | Support |
|----------|---------|
| OpenAI | Supported |
| Anthropic | Supported |
| Google Gemini | Supported |
| Azure OpenAI | Supported |
| Ollama | Supported |
| OpenRouter | Supported |

API keys stored securely via OS keychain (Electron safeStorage).

---

## Building

```bash
npm run build          # compile TypeScript + bundle for production
npm run dist:mac       # build + package macOS DMG
npm run dist:win       # build + package Windows installer
npm run dist:linux     # build + package Linux AppImage/deb
npm run dist           # build + package all platforms
npm run pack           # build + package (unpacked dir, for testing)
```

Built artifacts go to `release/`.

### Python note

Native modules (`node-pty`, `msgpackr-extract`) require `node-gyp` which uses Python. If you're on Python 3.12+ and get a `ModuleNotFoundError: No module named 'distutils'` error, install setuptools:

```bash
pip3 install setuptools
```

---

## Installation (unsigned builds)

The app is not yet code-signed with an Apple Developer certificate. macOS will block it by default.

### macOS — bypass Gatekeeper

```bash
xattr -cr /Applications/Prowl.app
```

Or: right-click the app > **Open** > click **Open** in the dialog.

### macOS — keychain prompt

On first launch, macOS will ask to access **"prowl Safe Storage"** in your keychain. This is used to encrypt the snapshot integrity key. Click **Always Allow** to suppress future prompts.

> **Coming soon:** Code-signed and notarized macOS builds. Once signed, both the Gatekeeper warning and the keychain authenticity prompt will disappear automatically.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Electron, React, TypeScript |
| Styling | Tailwind CSS v4 |
| Graph | Sigma.js, graphology |
| Parsing | tree-sitter WASM |
| Database | KuzuDB WASM |
| AI | LangChain, Transformers.js |
| Terminal | xterm.js, node-pty |
| Editor | Monaco |
| Build | Vite |

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=neur0map/prowl&type=Date)](https://star-history.com/#neur0map/prowl&Date)

---

## Contributing

PRs welcome. Open an issue first for major changes.

---

## License

MIT

