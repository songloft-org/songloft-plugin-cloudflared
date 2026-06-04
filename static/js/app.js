/**
 * Cloudflared 隧道 — 前端应用逻辑
 */
import { apiGet, apiPost } from './common.js';

const PLATFORM_MAP = {
    'darwin-amd64':  { file: 'cloudflared-darwin-amd64.tgz' },
    'darwin-arm64':  { file: 'cloudflared-darwin-arm64.tgz' },
    'linux-amd64':   { file: 'cloudflared-linux-amd64' },
    'linux-arm64':   { file: 'cloudflared-linux-arm64' },
    'linux-armv7':   { file: 'cloudflared-linux-arm' },
    'windows-amd64': { file: 'cloudflared-windows-amd64.exe' },
    'windows-arm64': { file: 'cloudflared-windows-amd64.exe' },
};

let currentTab = 'home';
let pollTimer = null;
let tunnelUrlPollTimer = null;
let serverPlatform = 'linux-amd64';

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    history.replaceState({ tab: 'home' }, '', '#home');

    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.tab) {
            window._isPopState = true;
            switchTab(event.state.tab);
            window._isPopState = false;
        }
    });

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    document.getElementById('btn-start').addEventListener('click', startTunnel);
    document.getElementById('btn-stop').addEventListener('click', stopTunnel);
    document.getElementById('btn-download').addEventListener('click', downloadCloudflared);
    document.getElementById('btn-copy-url').addEventListener('click', copyTunnelUrl);
    document.getElementById('btn-copy-link').addEventListener('click', copyDownloadLink);

    try {
        const resp = await apiGet('/api/platform');
        if (resp && resp.data) {
            if (resp.data.platform) {
                serverPlatform = resp.data.platform;
                document.getElementById('detected-platform').textContent = serverPlatform;
            }
            if (resp.data.port) {
                document.getElementById('server-port').textContent = resp.data.port;
            }
        }
    } catch (e) {
        console.error('获取平台信息失败:', e);
    }

    await refreshStatus();
});

// ============================================
// Tab 切换
// ============================================

function switchTab(tabName) {
    if (!window._isPopState) {
        history.pushState({ tab: tabName }, '', '#' + tabName);
    }
    currentTab = tabName;

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-page').forEach(page => {
        page.classList.toggle('active', page.id === 'tab-' + tabName);
    });

    if (tabName === 'settings') {
        loadReleaseInfo();
        loadManualDownloadLink();
    }
}

// ============================================
// 首页功能
// ============================================

async function refreshStatus() {
    try {
        const resp = await apiGet('/api/status');
        if (resp && resp.data) {
            updateStatusUI(resp.data);
        }
    } catch (e) {
        console.error('获取状态失败:', e);
    }
}

function updateStatusUI(data) {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const versionText = document.getElementById('installed-version');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const tunnelCard = document.getElementById('tunnel-card');

    if (!data.installed) {
        statusDot.className = 'status-dot stopped';
        statusText.textContent = '未安装';
        versionText.textContent = '-';
        startBtn.disabled = true;
        stopBtn.classList.add('hidden');
        tunnelCard.classList.add('hidden');
        stopPolling();
        return;
    }

    versionText.textContent = data.version || '已安装';

    if (data.running) {
        statusDot.className = 'status-dot running';
        statusText.textContent = '运行中';
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        tunnelCard.classList.remove('hidden');
        startPolling();
    } else {
        statusDot.className = 'status-dot stopped';
        statusText.textContent = '已停止';
        startBtn.classList.remove('hidden');
        startBtn.disabled = false;
        stopBtn.classList.add('hidden');
        tunnelCard.classList.add('hidden');
        stopPolling();
    }
}

async function startTunnel() {
    const btn = document.getElementById('btn-start');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> 启动中...';

    const port = document.getElementById('server-port').textContent;
    try {
        const resp = await apiPost('/api/start', { port });
        if (resp && resp.data && resp.data.message) {
            showSnackbar(resp.data.message);
        }
        setTimeout(refreshStatus, 1000);
    } catch (e) {
        showSnackbar('启动失败: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span> 启动隧道';
    }
}

async function stopTunnel() {
    const btn = document.getElementById('btn-stop');
    btn.disabled = true;

    try {
        const resp = await apiPost('/api/stop', {});
        if (resp && resp.data && resp.data.message) {
            showSnackbar(resp.data.message);
        }
        stopPolling();
        setTimeout(refreshStatus, 500);
    } catch (e) {
        showSnackbar('停止失败: ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

// ============================================
// 输出轮询
// ============================================

function startPolling() {
    if (pollTimer) return;
    pollOutput();
    pollTimer = setInterval(pollOutput, 3000);
    startTunnelUrlPolling();
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    stopTunnelUrlPolling();
}

async function pollOutput() {
    try {
        const resp = await apiGet('/api/output');
        if (!resp || !resp.data) return;

        const logEl = document.getElementById('log-output');
        if (logEl && resp.data.output) {
            logEl.textContent = resp.data.output;
            logEl.scrollTop = logEl.scrollHeight;
        }

        if (resp.data.running === false) {
            stopPolling();
            refreshStatus();
        }
    } catch (e) {
        console.error('轮询输出失败:', e);
    }
}

async function pollTunnelUrl() {
    try {
        const resp = await apiGet('/api/tunnel-url');
        if (!resp || !resp.data) return;

        const tunnelUrl = resp.data.url;
        if (tunnelUrl) {
            const urlEl = document.getElementById('tunnel-url');
            const linkEl = document.getElementById('tunnel-link');
            if (urlEl && linkEl) {
                linkEl.href = tunnelUrl;
                linkEl.textContent = tunnelUrl;
                urlEl.classList.remove('hidden');
            }
            stopTunnelUrlPolling();
        }
    } catch (e) {
        console.error('获取隧道 URL 失败:', e);
    }
}

function startTunnelUrlPolling() {
    if (tunnelUrlPollTimer) return;
    pollTunnelUrl();
    tunnelUrlPollTimer = setInterval(pollTunnelUrl, 3000);
}

function stopTunnelUrlPolling() {
    if (tunnelUrlPollTimer) {
        clearInterval(tunnelUrlPollTimer);
        tunnelUrlPollTimer = null;
    }
}

function copyTunnelUrl() {
    const linkEl = document.getElementById('tunnel-link');
    if (linkEl && linkEl.textContent) {
        navigator.clipboard.writeText(linkEl.textContent).then(() => {
            showSnackbar('已复制到剪贴板');
        }).catch(() => {
            showSnackbar('复制失败');
        });
    }
}

// ============================================
// 设置页功能
// ============================================

async function loadReleaseInfo() {
    const versionEl = document.getElementById('latest-version');
    const downloadBtn = document.getElementById('btn-download');

    versionEl.textContent = '加载中...';

    try {
        const resp = await apiGet('/api/releases');
        if (resp && resp.data && resp.data.tag_name) {
            versionEl.textContent = resp.data.tag_name;
            downloadBtn.disabled = false;
        } else {
            versionEl.textContent = '获取失败';
        }
    } catch (e) {
        versionEl.textContent = '获取失败';
        console.error('获取 release 信息失败:', e);
    }
}

async function downloadCloudflared() {
    const btn = document.getElementById('btn-download');
    const progressBar = document.getElementById('download-progress');

    if (!PLATFORM_MAP[serverPlatform]) {
        showSnackbar('不支持的平台: ' + serverPlatform);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">downloading</span> 下载中...';
    progressBar.classList.remove('hidden');
    progressBar.classList.add('progress-indeterminate');

    try {
        const resp = await apiPost('/api/download', { platform: serverPlatform });

        if (resp && resp.data && resp.data.success) {
            showSnackbar('下载完成');
            refreshStatus();
            loadReleaseInfo();
        } else if (resp && resp.error) {
            showSnackbar(resp.error);
        }
    } catch (e) {
        showSnackbar('下载失败: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined">download</span> 下载最新版本';
        progressBar.classList.remove('progress-indeterminate');
        progressBar.classList.add('hidden');
    }
}

function loadManualDownloadLink() {
    const linkEl = document.getElementById('manual-download-link');
    const mapping = PLATFORM_MAP[serverPlatform];
    if (!mapping) {
        linkEl.textContent = '不支持的平台';
        linkEl.removeAttribute('href');
        return;
    }
    const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/' + mapping.file;
    linkEl.href = url;
    linkEl.textContent = url;
}

function copyDownloadLink() {
    const linkEl = document.getElementById('manual-download-link');
    if (linkEl && linkEl.href && linkEl.href !== '#') {
        navigator.clipboard.writeText(linkEl.href).then(() => {
            showSnackbar('下载链接已复制到剪贴板');
        }).catch(() => {
            showSnackbar('复制失败');
        });
    }
}

// ============================================
// Snackbar 通知
// ============================================

function showSnackbar(message) {
    const snackbar = document.getElementById('snackbar');
    snackbar.textContent = message;
    snackbar.classList.add('show');
    setTimeout(() => {
        snackbar.classList.remove('show');
    }, 3000);
}
