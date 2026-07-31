# Instagram Local Video Downloader

[中文](README.md) | [English](README.en.md)

本地运行的 Instagram 视频批量下载小工具。后端使用 **Node.js + Express**，下载引擎为 **`yt-dlp`**，前端提供实时进度与批量导入界面。

## 主要功能

- **本地运行**：完全在本机工作，无需把登录凭据上传到云端
- **多链接输入**：文本框内粘贴多个链接，一行一个
- **表格批量导入**：支持拖拽上传 `.csv` / `.xlsx` / `.xls`，自动提取所有 Instagram 链接
- **浏览器 Cookie 授权**：自动检测本机已安装浏览器（Chrome、Safari、Firefox、Edge、Brave、Opera），可选读取 Cookie 以应对 Instagram 登录限制
- **实时进度**：通过 Server-Sent Events (SSE) 展示下载进度、速度与剩余时间
- **打开本地文件**：下载完成后可直接打开文件或下载目录（macOS 使用 Finder）
- **单任务排队**：默认串行下载，降低被限流风险
- **按日期归档**：视频保存在 `./downloads/YYYY-MM-DD/` 目录下

## 安装与准备

### 1. 安装 `yt-dlp`

**macOS：**

```bash
brew install yt-dlp
```

**Windows：** 可用 [winget](https://winget.run/) / [Scoop](https://scoop.sh/) / 官方发布包安装，并确保 `yt-dlp` 在 PATH 中可用。

### 2. 安装依赖并启动

```bash
npm install
npm start
```

启动成功后打开：**http://localhost:3010**

可通过环境变量修改端口，例如：`PORT=3000 npm start`

## Cookie 说明

若匿名下载失败（常见提示与登录 / cookies 相关），在页面中选择「浏览器 Cookie 来源」。下拉列表仅展示本机已检测到的浏览器。使用前请先在对应浏览器中登录 Instagram。

## 文件导入说明

- 无需特定表头或格式
- 工具会遍历表格内所有单元格，提取符合 Instagram 帖子格式的 URL（`/p/`、`/reel/`、`/reels/`、`/tv/`）并加入队列

## 文件存放路径

所有下载的视频保存在项目目录下的 `./downloads/` 中，并按当天日期分子目录。
