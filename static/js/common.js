/**
 * 公共 API 工具模块 — 薄包装层，实际实现由主程序注入的 SongloftPlugin 提供
 */
export const {
    getAuthToken,
    apiGet,
    apiPost,
    apiPut,
    apiDelete,
    getTheme,
    onThemeChange,
} = window.SongloftPlugin;
