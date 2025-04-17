# Hanzo Studio

[![Latest macOS Build](https://img.shields.io/github/v/release/hanzoai/studio?include_prereleases&label=latest%20macOS%20.dmg%20build)](https://github.com/hanzoai/studio/releases/latest)

> **Note**: After installing on macOS, you may need to run this command to open the app:
> ```sh
> xattr -c /Applications/Hanzo\ Desktop.app
> ```

Hanzo Studio features MCP server support for all function calling capable models hosted on Hanzo.

## Features

- Chat interface with image support
- Local MCP servers

## Prerequisites

- Node.js (v18+)
- pnpm package manager

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Start the development server:
   ```
   pnpm dev
   ```

## Building for Production

To build the application for production:

```
pnpm dist
```

This will create installable packages in the `release` directory.

## Configuration

In the settings page, add your Hanzo API key:

```json
{
  "HANZO_API_KEY": "sk-hz-xxxxxxxxx"
}
```

You can obtain a Hanzo API key by signing up at [https://cloud.hanzo.ai](https://cloud.hanzo.ai).
