/**
 * Songloft 插件前端 — 公共 API 工具模块
 *
 * 封装认证 Token 读取和 HTTP 请求发送，统一错误处理。
 * 所有前端模块通过 import { apiGet, apiPost, ... } from './common.js' 调用后端 API。
 *
 * API_BASE 使用相对路径 '.'，请求自动发送到插件自身的 HTTP 路由前缀下。
 */

const API_BASE = '.';

/**
 * 从 localStorage 获取 Songloft 认证 Token
 */
export function getAuthToken() {
    try {
        const authData = localStorage.getItem('songloft-auth');
        if (authData) {
            const auth = JSON.parse(authData);
            return auth.accessToken || '';
        }
    } catch (e) {
        console.error('获取 Token 失败:', e);
    }
    return '';
}

/**
 * 构建请求头（含可选的 Authorization）
 */
function buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
}

/**
 * 解析响应：非 2xx 时读取 JSON 错误体并抛出友好错误信息。
 */
async function parseResponse(response) {
    if (!response.ok) {
        let msg = response.statusText || `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (body && (body.message || body.error)) {
                msg = body.message || body.error;
            }
        } catch (_) { /* 非 JSON body 时保留 statusText */ }
        throw new Error(msg);
    }
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
}

/**
 * 发送 GET 请求并返回 JSON
 */
export function apiGet(path) {
    return fetch(API_BASE + path, {
        method: 'GET',
        headers: buildHeaders()
    }).then(parseResponse);
}

/**
 * 发送 POST 请求并返回 JSON
 */
export function apiPost(path, body) {
    return fetch(API_BASE + path, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body)
    }).then(parseResponse);
}

/**
 * 发送 PUT 请求并返回 JSON
 */
export function apiPut(path, body) {
    return fetch(API_BASE + path, {
        method: 'PUT',
        headers: buildHeaders(),
        body: JSON.stringify(body)
    }).then(parseResponse);
}

/**
 * 发送 DELETE 请求并返回 JSON
 */
export function apiDelete(path) {
    return fetch(API_BASE + path, {
        method: 'DELETE',
        headers: buildHeaders()
    }).then(parseResponse);
}
