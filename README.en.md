# Instagram Local Video Downloader

[中文](README.md) | [English](README.en.md)

A local Instagram video batch downloader. Backend: **Node.js + Express**. Download engine: **`yt-dlp`**. The frontend shows live progress and supports bulk import.

## Features

- **Runs locally**: Everything stays on your machine; no credentials uploaded to the cloud
- **Multiple URLs**: Paste links in the text box, one per line
- **Spreadsheet import**: Drag and drop `.csv` / `.xlsx` / `.xls` to extract Instagram links automatically
- **Browser cookies**: Detects installed browsers (Chrome, Safari, Firefox, Edge, Brave, Opera) and can use their cookies when Instagram blocks anonymous access
- **Live progress**: Server-Sent Events (SSE) for download progress, speed, and ETA
- **Open local files**: Open a finished file or the downloads folder (Finder on macOS)
- **Single-job queue**: Downloads run one at a time by default to reduce rate-limit risk
- **Date folders**: Videos are saved under `./downloads/YYYY-MM-DD/`

## Setup

### 1. Install `yt-dlp`

**macOS:**

```bash
brew install yt-dlp
```

**Windows:** Install via [winget](https://winget.run/), [Scoop](https://scoop.sh/), or the official release, and make sure `yt-dlp` is on your `PATH`.

### 2. Install dependencies and start

```bash
npm install
npm start
```

Then open: **http://localhost:3010**

Override the port with an environment variable, for example: `PORT=3000 npm start`

## Cookies

If anonymous downloads fail (errors mentioning login / cookies), choose a browser under **Browser Cookie Source**. The list only shows browsers detected on this machine. Log in to Instagram in that browser first.

## File import

- No special headers or layout required
- The tool scans every cell and extracts Instagram post URLs (`/p/`, `/reel/`, `/reels/`, `/tv/`) into the queue

## Download location

All videos are saved under `./downloads/` in the project directory, grouped by date.
