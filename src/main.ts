/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';

const router = createRouter();

// --- 全局状态 ---

let detectedPlatform = '';
let cachedTunnelUrl = '';
const PROCESS_NAME = 'cloudflared-tunnel';
const TUNNEL_URL_REGEX = /https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

const PLATFORM_ASSETS: Record<string, { file: string; extract: boolean }> = {
  'darwin-amd64':  { file: 'cloudflared-darwin-amd64.tgz', extract: true },
  'darwin-arm64':  { file: 'cloudflared-darwin-arm64.tgz', extract: true },
  'linux-amd64':   { file: 'cloudflared-linux-amd64',      extract: false },
  'linux-arm64':   { file: 'cloudflared-linux-arm64',      extract: false },
  'linux-armv7':   { file: 'cloudflared-linux-arm',        extract: false },
  'windows-amd64': { file: 'cloudflared-windows-amd64.exe', extract: false },
  'windows-arm64': { file: 'cloudflared-windows-amd64.exe', extract: false },
};

// --- 宿主 API ---

async function callHostAPI<T = unknown>(method: string, path: string): Promise<T> {
  const hostUrl = await songloft.plugin.getHostUrl();
  const token = await songloft.plugin.getToken();
  const resp = await fetch(hostUrl + path, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Host API ${resp.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

async function getHostConfig(key: string): Promise<string> {
  try {
    const data = await callHostAPI<{ key: string; value: string }>('GET', `/api/v1/configs/${key}`);
    return data?.value || '';
  } catch (_) {
    return '';
  }
}

// --- 平台与端口 ---

let serverPort = '58091';

function isWindows(): boolean {
  return detectedPlatform.startsWith('windows');
}

function getBinName(): string {
  return isWindows() ? 'cloudflared.exe' : 'cloudflared';
}

// --- 二进制管理 ---

async function isInstalled(): Promise<boolean> {
  return await songloft.command.exists(getBinName());
}

async function getVersion(): Promise<string> {
  try {
    const result = await songloft.command.exec(getBinName(), ['version'], { timeout: 5000 });
    if (result.exitCode === 0) {
      const output = result.stdout || result.stderr;
      const match = output.match(/cloudflared version (\S+)/);
      return match ? match[1] : output.trim();
    }
  } catch (_) { /* ignore */ }
  return '';
}

// --- 隧道管理 ---

async function startTunnel(port: string): Promise<void> {
  const args = ['tunnel', '--url', `http://localhost:${port}`, '--logfile', 'output.log', '--loglevel', 'info'];
  await songloft.command.start(PROCESS_NAME, getBinName(), args);
  cachedTunnelUrl = '';
}

async function stopTunnel(): Promise<void> {
  await songloft.command.stop(PROCESS_NAME);
  cachedTunnelUrl = '';
}

async function isTunnelRunning(): Promise<boolean> {
  return await songloft.command.isRunning(PROCESS_NAME);
}

async function readOutput(): Promise<string> {
  try {
    if (!await songloft.fs.exists('output.log')) return '';
    const content = await songloft.fs.readFile('output.log');
    const lines = content.split('\n');
    return lines.slice(-200).join('\n');
  } catch (_) {
    return '';
  }
}

async function extractTunnelUrl(): Promise<string> {
  if (cachedTunnelUrl) return cachedTunnelUrl;
  const output = await readOutput();
  if (output) {
    const match = output.match(TUNNEL_URL_REGEX);
    if (match) {
      cachedTunnelUrl = match[0];
    }
  }
  return cachedTunnelUrl;
}

// --- 下载管理 ---

async function fetchLatestRelease(): Promise<{ tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }> {
  const resp = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest');
  if (!resp.ok) throw new Error(`GitHub API HTTP ${resp.status}`);
  return await resp.json() as any;
}

function applyGithubProxy(url: string, proxyPrefix: string): string {
  if (!proxyPrefix) return url;
  if (proxyPrefix[proxyPrefix.length - 1] !== '/') {
    proxyPrefix += '/';
  }
  return proxyPrefix + url;
}

async function downloadBinary(platform: string, githubProxy?: string): Promise<void> {
  const mapping = PLATFORM_ASSETS[platform];
  if (!mapping) throw new Error(`不支持的平台: ${platform}`);

  const release = await fetchLatestRelease();
  const asset = release.assets.find((a: any) => a.name === mapping.file);
  if (!asset) throw new Error(`未找到下载文件: ${mapping.file}`);

  const downloadUrl = applyGithubProxy(asset.browser_download_url, githubProxy || '');
  const binName = platform.startsWith('windows') ? 'cloudflared.exe' : 'cloudflared';

  if (mapping.extract) {
    await songloft.command.download(downloadUrl, mapping.file, {
      extract: 'tgz',
      extractTarget: binName,
    });
  } else {
    await songloft.command.download(downloadUrl, binName);
  }

  if (!platform.startsWith('windows')) {
    await songloft.command.exec('chmod', ['+x', `bin/${binName}`], { timeout: 5000 });
  }
}

// --- API 路由 ---

router.get('/api/platform', () => {
  return jsonResponse({ data: { platform: detectedPlatform, port: serverPort } });
});

router.get('/api/status', async () => {
  const installed = await isInstalled();
  if (!installed) {
    return jsonResponse({ data: { installed: false, running: false, version: '' } });
  }
  const running = await isTunnelRunning();
  const version = await getVersion();
  return jsonResponse({ data: { installed: true, running, version } });
});

router.post('/api/start', async (req) => {
  const body = req.body ? JSON.parse(String(req.body)) : {};
  const port = body.port || serverPort;

  const running = await isTunnelRunning();
  if (running) {
    return jsonResponse({ error: 'cloudflared 已在运行中' }, 409);
  }

  await startTunnel(port);
  return jsonResponse({ data: { message: 'cloudflared 已启动' } });
});

router.post('/api/stop', async () => {
  await stopTunnel();
  return jsonResponse({ data: { message: 'cloudflared 已停止' } });
});

router.get('/api/output', async () => {
  const running = await isTunnelRunning();
  const output = await readOutput();

  if (output) {
    const match = output.match(TUNNEL_URL_REGEX);
    if (match && !cachedTunnelUrl) {
      cachedTunnelUrl = match[0];
    }
  }

  return jsonResponse({ data: { output, running } });
});

router.get('/api/tunnel-url', async () => {
  const url = await extractTunnelUrl();
  return jsonResponse({ data: { url } });
});

router.post('/api/download', async (req) => {
  const body = JSON.parse(String(req.body));
  const platform = body.platform;
  const githubProxy = body.github_proxy || '';
  if (!platform) {
    return jsonResponse({ error: '平台信息不能为空' }, 400);
  }
  if (!PLATFORM_ASSETS[platform]) {
    return jsonResponse({ error: `不支持的平台: ${platform}` }, 400);
  }

  try {
    await downloadBinary(platform, githubProxy);
    return jsonResponse({ data: { success: true, message: '下载完成' } });
  } catch (e: any) {
    return jsonResponse({ error: '下载失败: ' + (e.message || e) }, 500);
  }
});

router.get('/api/releases', async () => {
  try {
    const release = await fetchLatestRelease();
    return jsonResponse({ data: { tag_name: release.tag_name, assets: release.assets } });
  } catch (e: any) {
    return jsonResponse({ error: '获取 release 信息失败: ' + (e.message || e) }, 500);
  }
});

// --- 生命周期 ---

async function onInit(): Promise<void> {
  detectedPlatform = await getHostConfig('server_platform') || 'linux-amd64';
  serverPort = await getHostConfig('server_port') || '58091';
  songloft.log.info(`Cloudflared 隧道 initialized, platform: ${detectedPlatform}, port: ${serverPort}`);
}

async function onDeinit(): Promise<void> {
  try {
    const running = await isTunnelRunning();
    if (running) {
      await stopTunnel();
    }
  } catch (_) { /* best effort */ }
  songloft.log.info('Cloudflared 隧道 deinitialized');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
