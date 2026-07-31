const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3010;

const BROWSER_OPTIONS = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'safari', label: 'Safari' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'edge', label: 'Edge' },
  { id: 'brave', label: 'Brave' },
  { id: 'opera', label: 'Opera' }
];

function pathExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function getBrowserAppPaths(browserId) {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    const appDirs = ['/Applications', path.join(home, 'Applications')];
    const appNames = {
      chrome: 'Google Chrome.app',
      safari: 'Safari.app',
      firefox: 'Firefox.app',
      edge: 'Microsoft Edge.app',
      brave: 'Brave Browser.app',
      opera: 'Opera.app'
    };
    const name = appNames[browserId];
    return name ? appDirs.map(dir => path.join(dir, name)) : [];
  }

  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const paths = {
      chrome: [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ],
      firefox: [
        path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
        path.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe')
      ],
      edge: [
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ],
      brave: [
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
      ],
      opera: [
        path.join(local, 'Programs', 'Opera', 'opera.exe'),
        path.join(programFiles, 'Opera', 'opera.exe')
      ],
      safari: []
    };
    return paths[browserId] || [];
  }

  // Linux
  const linuxBins = {
    chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    firefox: ['firefox'],
    edge: ['microsoft-edge', 'microsoft-edge-stable'],
    brave: ['brave-browser', 'brave'],
    opera: ['opera'],
    safari: []
  };
  return (linuxBins[browserId] || []).map(bin => {
    // Resolve via common bin locations; existence check is enough for which()
    return ['/usr/bin', '/usr/local/bin', '/snap/bin'].map(dir => path.join(dir, bin));
  }).flat();
}

function detectInstalledBrowsers() {
  return BROWSER_OPTIONS.filter(browser => {
    const candidates = getBrowserAppPaths(browser.id);
    return candidates.some(pathExists);
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Helper to get Year-Month-Day folder name
function getDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Ensure downloads directory exists
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// In-memory job queue
let jobs = [];
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = 1; // Instagram is sensitive to concurrent scraping; 1 is safer.

// Server-Sent Events (SSE) clients
let sseClients = [];

// Helper to broadcast progress updates to all connected clients
function broadcast(event, data) {
  sseClients.forEach(client => {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial jobs state
  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
  });

  // Send current jobs list immediately upon connection
  res.write(`event: init\n`);
  res.write(`data: ${JSON.stringify(jobs)}\n\n`);
});

// List installed browsers available for --cookies-from-browser
app.get('/api/browsers', (req, res) => {
  res.json({ browsers: detectInstalledBrowsers() });
});

// Add URLs to download queue
app.post('/api/download', (req, res) => {
  const { urls, cookiesBrowser } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Invalid URLs list' });
  }

  const allowedBrowsers = BROWSER_OPTIONS.map(b => b.id);
  const sanitizedBrowser = allowedBrowsers.includes(cookiesBrowser) ? cookiesBrowser : 'none';

  const newJobs = [];
  urls.forEach(url => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    // Check if URL is already in queue and not finished
    const exists = jobs.find(j => j.url === trimmedUrl && (j.status === 'pending' || j.status === 'downloading'));
    if (exists) return;

    const job = {
      id: '_' + Math.random().toString(36).substr(2, 9),
      url: trimmedUrl,
      status: 'pending',
      progress: 0,
      speed: '',
      eta: '',
      filename: '',
      filePath: '',
      downloadUrl: '',
      error: null,
      addedAt: new Date().toLocaleTimeString(),
      cookiesBrowser: sanitizedBrowser
    };
    jobs.push(job);
    newJobs.push(job);
  });

  broadcast('jobs-added', newJobs);
  processQueue();

  res.json({ success: true, count: newJobs.length });
});

// Clean jobs list
app.post('/api/clear', (req, res) => {
  // Only clear completed or failed jobs
  jobs = jobs.filter(j => j.status === 'downloading' || j.status === 'pending');
  broadcast('jobs-cleared', jobs);
  res.json({ success: true, jobs });
});

// Open downloads folder in Finder
app.post('/api/open-folder', (req, res) => {
  const todayDir = path.join(DOWNLOADS_DIR, getDateString());
  const dirToOpen = fs.existsSync(todayDir) ? todayDir : DOWNLOADS_DIR;
  exec(`open "${dirToOpen}"`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not open folder' });
    }
    res.json({ success: true });
  });
});

// Open a specific downloaded file
app.post('/api/open-file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File does not exist' });
  }

  exec(`open "${filePath}"`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not open file' });
    }
    res.json({ success: true });
  });
});

// Process download queue
function processQueue() {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) return;

  const nextJob = jobs.find(j => j.status === 'pending');
  if (!nextJob) return;

  activeDownloads++;
  nextJob.status = 'downloading';
  broadcast('job-updated', nextJob);

  const url = nextJob.url;
  
  // Date-based subfolder
  const dateStr = getDateString();
  const jobDownloadsDir = path.join(DOWNLOADS_DIR, dateStr);
  if (!fs.existsSync(jobDownloadsDir)) {
    fs.mkdirSync(jobDownloadsDir, { recursive: true });
  }
  
  // Spawn yt-dlp command
  // --newline splits progress lines into actual newlines instead of \r
  // --progress formats progress info
  // -P sets directory
  const args = [
    '--newline',
    '--no-playlist',
    '-S', 'vcodec:h264,res,acodec:m4a',
    '--recode-video', 'mp4',
    '--postprocessor-args', 'VideoConvertor:-vcodec libx264 -pix_fmt yuv420p',
    '-P', jobDownloadsDir,
    '-o', '%(title)s-%(id)s.%(ext)s'
  ];

  if (nextJob.cookiesBrowser && nextJob.cookiesBrowser !== 'none') {
    args.push('--cookies-from-browser', nextJob.cookiesBrowser);
  }

  args.push(url);

  console.log(`Starting download for: ${url} (saving to ${dateStr}/)`);
  if (nextJob.cookiesBrowser && nextJob.cookiesBrowser !== 'none') {
    console.log(`Using cookies from browser: ${nextJob.cookiesBrowser}`);
  }
  const child = spawn('yt-dlp', args);

  let detectedFilename = '';
  let stderrOutput = '';

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      // 1. Match progress: [download]  12.5% of 10.00MiB at  1.20MiB/s ETA 00:08
      const progressMatch = line.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/);
      if (progressMatch) {
        nextJob.progress = parseFloat(progressMatch[1]);
        nextJob.speed = progressMatch[3];
        nextJob.eta = progressMatch[4];
        broadcast('job-updated', nextJob);
        return;
      }

      // 2. Match simple progress (e.g. just percent)
      const simpleProgressMatch = line.match(/\[download\]\s+(\d+\.\d+)%/);
      if (simpleProgressMatch && !progressMatch) {
        nextJob.progress = parseFloat(simpleProgressMatch[1]);
        broadcast('job-updated', nextJob);
      }

      // 3. Match Destination / Filename: [download] Destination: /path/to/downloads/file.mp4
      const destMatch = line.match(/\[download\]\s+Destination:\s+(.+)/) || line.match(/Merging formats into "(.+)"/);
      if (destMatch) {
        const fullPath = destMatch[1].replace(/"/g, ''); // strip quotes
        detectedFilename = path.basename(fullPath);
        nextJob.filename = detectedFilename;
        nextJob.filePath = fullPath;
        nextJob.downloadUrl = `/downloads/${dateStr}/${encodeURIComponent(detectedFilename)}`;
        broadcast('job-updated', nextJob);
      }

      // 4. Match already downloaded files
      if (line.includes('has already been downloaded')) {
        const alreadyMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
        if (alreadyMatch) {
          const fullPath = alreadyMatch[1].replace(/"/g, '');
          detectedFilename = path.basename(fullPath);
          nextJob.filename = detectedFilename;
          nextJob.filePath = fullPath;
          nextJob.downloadUrl = `/downloads/${dateStr}/${encodeURIComponent(detectedFilename)}`;
          nextJob.progress = 100;
          broadcast('job-updated', nextJob);
        }
      }
    });
  });

  child.stderr.on('data', (data) => {
    const errorMsg = data.toString().trim();
    console.error(`yt-dlp stderr: ${errorMsg}`);
    stderrOutput += errorMsg + '\n';
  });

  child.on('close', (code) => {
    activeDownloads--;
    if (code === 0) {
      nextJob.status = 'completed';
      nextJob.progress = 100;
      nextJob.speed = '';
      nextJob.eta = '';
      
      // If we didn't capture the filename, check if there's any file in downloads that matches or just use a generic name
      if (!nextJob.filename) {
        // Fallback file detection: find the most recently created file in downloads directory
        try {
          const files = fs.readdirSync(jobDownloadsDir)
            .map(file => ({
              name: file,
              time: fs.statSync(path.join(jobDownloadsDir, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);
          if (files.length > 0) {
            nextJob.filename = files[0].name;
            nextJob.filePath = path.join(jobDownloadsDir, files[0].name);
            nextJob.downloadUrl = `/downloads/${dateStr}/${encodeURIComponent(files[0].name)}`;
          } else {
            nextJob.filename = 'Downloaded Video';
          }
        } catch (e) {
          nextJob.filename = 'Downloaded Video';
        }
      } else if (!nextJob.downloadUrl) {
        nextJob.downloadUrl = `/downloads/${dateStr}/${encodeURIComponent(nextJob.filename)}`;
      }
    } else {
      nextJob.status = 'failed';
      if (stderrOutput.includes('empty media response') || stderrOutput.includes('cookies') || stderrOutput.includes('login') || stderrOutput.includes('Sign in')) {
        nextJob.error = '下载失败。Instagram 限制了匿名访问，请尝试开启 Cookie 授权后再试。';
      } else {
        nextJob.error = '下载失败。请检查链接或网络，或尝试开启 Cookie 授权。';
      }
    }
    
    broadcast('job-updated', nextJob);
    
    // Process next in line
    processQueue();
  });
}

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
