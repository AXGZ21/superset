# Chorus - Comprehensive Analysis

## Overview

**Chorus** is a native macOS AI chat application that enables users to chat with multiple AI models simultaneously from a single interface. Built by the developers behind Conductor, it brings an "everything in one place" philosophy to AI interaction.

**Repository**: alternatives/chorus
**Version**: 0.14.4
**Built by**: Melty Labs
**License**: MIT

### Core Problem Solved
- Users switch between multiple AI platforms to compare responses
- Chorus consolidates into a single interface
- Send one prompt, receive responses from all configured models at once

---

## Features

### Core Chat Capabilities
- **Multi-model chat**: Send prompts to multiple AI providers simultaneously
- **Model picker**: User-defined configurations and system prompts
- **Message streaming**: Real-time updates
- **Reply functionality**: Threaded conversations
- **Chat branching**: Fork/revert/branch chats

### Projects & Organization
- **Projects system**: Organize chats into folders
- **Chat pinning and sorting**
- **Quick chats**: Lightweight ambient chat windows
- **Chat summaries**: Context preservation

### Content & Attachments
- **Multi-format attachments**: Images, PDFs, text files, webpages
- **Attachment metadata tracking**
- **Screenshot attachment**
- **Automatic compression and optimization**

### AI Integration & Tools
- **MCP support**: Model Context Protocol for extensible tools
- **11+ built-in toolsets**:
  - Web search and scraping (Firecrawl)
  - Terminal/shell execution
  - File system access and code editing
  - GitHub, Slack, Apple/macOS automation
  - Custom tool creation
- **Tool permissions system** (always allow/deny/ask)

### Advanced Features
- **Cost tracking**: Per-message API usage display
- **Multi-model comparison interface**
- **Group chats (experimental)**: Popcorn-style multiplayer AI
- **Find in page functionality**
- **User reviews and editing suggestions**
- **Brainstorming mode**

---

## Architecture

### High-Level Structure

```
Chorus = Tauri Desktop App + React UI + Rust Backend + SQLite
```

### Frontend (React/TypeScript - ~40.8K lines)
```
src/
├── ui/                           # React components
│   ├── components/               # 42+ component files
│   │   ├── MultiChat.tsx         # Core chat interface (3,829 lines)
│   │   ├── ChatInput.tsx
│   │   ├── AppSidebar.tsx
│   │   └── renderers/            # Message rendering
│   └── hooks/                    # Global hooks
│
├── core/chorus/
│   ├── api/                      # TanStack Query queries/mutations
│   ├── ModelProviders/           # 8+ provider implementations
│   │   ├── ProviderAnthropic.ts
│   │   ├── ProviderOpenAI.ts
│   │   ├── ProviderGoogle.ts
│   │   ├── ProviderOpenRouter.ts
│   │   ├── ProviderPerplexity.ts
│   │   ├── ProviderGrok.ts
│   │   ├── ProviderOllama.ts
│   │   └── ProviderLMStudio.ts
│   ├── toolsets/                 # 11 built-in toolsets
│   ├── Toolsets.ts               # Toolset system (600+ lines)
│   └── MCPStdioTauri.ts          # MCP implementation
```

### Backend (Rust/Tauri - 3.9K lines)
- Entry point, IPC commands, SQLite migrations, window management

---

## Tech Stack

### Frontend
- **React** 18.3, **TypeScript** 5.8
- **Tauri** 2.5+ (desktop framework)
- **TanStack React Query** 5.69
- **Zustand** 5.0, **shadcn/ui** + **Radix UI**
- **TailwindCSS** v3.4, **Framer Motion**
- **React Markdown** + **Rehype**

### Backend
- **Rust** with async/await (tokio)
- **Tauri** framework + plugins (sql, fs, http, shell, clipboard, notifications, etc.)
- **SQLite** (local database)

### AI/LLM Integration
- **@anthropic-ai/sdk**, **openai** v6.10
- **@google/generative-ai**
- **@modelcontextprotocol/sdk**
- **js-tiktoken**, **exa-js**, **@mendable/firecrawl-js**

---

## Strengths

1. **Multi-Model Comparison** - Compare all AI models at once
2. **Extensibility** - Comprehensive MCP support, 11+ toolsets
3. **Privacy & Local-First** - All chat history in local SQLite
4. **Performance** - Native Tauri app with efficient streaming
5. **Rich Data Model** - Multiple block types (chat, compare, brainstorm)
6. **Cost Tracking** - Per-message cost tracking
7. **Developer Experience** - Clear code organization, type-safe
8. **Project Organization** - Projects, pinning, favorites
9. **Advanced Capabilities** - Group chats, screenshot attachments

---

## Weaknesses

1. **macOS-Only** - Currently no Windows/Linux
2. **MCP Server Complexity** - Technical knowledge required
3. **Database Size Management** - SQLite can grow large (60MB+)
4. **UI Complexity** - MultiChat.tsx is 3,829 lines
5. **Incomplete Features** - Group chats marked experimental
6. **No Real-time Collaboration** - Single-user experience
7. **Limited Cloud Features** - No cross-device sync
8. **Tool Permission Friction** - Every tool may need approval

---

## Unique Ideas Worth Noting

1. **Multi-Model Conversation Interface** - "Popcorn style" parallel AI responses
2. **MCP-First Tool Integration** - Early MCP adoption
3. **Message Block Types** - Chat, Compare, Brainstorm, Tools blocks
4. **Cost Tracking at Message Level** - Inline cost display
5. **Bring-Your-Own-Keys Model** - No subscription required
6. **Ambient Chats** - Quick-chat accessible from anywhere
7. **Version Control for Chats** - Branch, fork, revert like Git
8. **Local-First, Backend-Light Architecture** - Minimal server costs

---

## What Superset Could Take From This

### High Priority
1. **Multi-Model Comparison** - Send prompts to multiple models at once
2. **MCP-First Tool Integration** - Extensible tool system via MCP
3. **Local-First Architecture** - All data stored locally in SQLite
4. **Cost Tracking** - Per-message API cost display

### Medium Priority
5. **Provider Abstraction** - 8+ model provider implementations
6. **Chat Branching/Version Control** - Fork, revert, branch conversations
7. **Ambient/Quick Chats** - Lightweight overlay windows
8. **Toolset System** - 11+ built-in toolsets pattern

### Worth Exploring
9. **Message Block Types** - Different visualizations for chat/compare/brainstorm
10. **Group Chats** - Multiple AIs responding to same prompt
11. **Tauri Architecture** - Rust backend + React frontend pattern
