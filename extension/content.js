console.log('[图片助手] Content script 已注入');

// ===== 全局错误捕获（抑制上下文失效错误） =====
window.addEventListener('unhandledrejection', function(event) {
    const msg = event.reason?.message || String(event.reason);
    if (msg.includes('Extension context invalidated') ||
        msg.includes('Extension context') ||
        msg.includes('message port closed') ||
        msg.includes('Could not establish connection')) {
        event.preventDefault();
        console.debug('[图片助手] 扩展上下文已失效，忽略此消息');
    }
});

document.documentElement.setAttribute('data-extension-installed', 'true');
window.postMessage({ type: 'EXTENSION_READY' }, '*');

// ===== 与后台通信的封装（带错误静默） =====
function sendMessageToBackground(message, callback) {
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                const errMsg = chrome.runtime.lastError.message;
                if (errMsg.includes('Extension context invalidated') ||
                    errMsg.includes('message port closed') ||
                    errMsg.includes('channel closed before a response')) {
                    if (callback) callback(null);
                    return;
                }
                console.warn('[图片助手] 发送消息失败:', errMsg);
                if (callback) callback(null);
                return;
            }
            if (callback) callback(response);
        });
    } catch (e) {
        if (!e.message?.includes('Extension context')) {
            console.warn('[图片助手] 发送消息异常:', e);
        }
        if (callback) callback(null);
    }
}

// ===== Ping =====
sendMessageToBackground({ action: 'ping' }, (response) => {
    if (response) {
        console.log('[图片助手] ping 响应:', response);
        console.log('[图片助手] 后台通信正常');
    }
});

// ===== 监听外部预览触发 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'SHOW_MAGNET_PREVIEW') {
        console.log('[图片助手] 收到外部预览触发:', message.magnet);
        if (message.magnet) {
            window.postMessage({ type: 'REQUEST_MAGNET_PREVIEW', magnet: message.magnet }, '*');
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: '缺少 magnet' });
        }
        return true;
    }
});

// ===== 监听页面消息 =====
window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // --- 图片下载（支持 referer） ---
    if (event.data.type === 'REQUEST_IMAGE_DOWNLOAD') {
        const url = event.data.url;
        const referer = event.data.referer || '';
        const requestId = event.data.requestId || '';
        console.log('[图片助手] 收到下载请求:', url, 'Referer:', referer, 'requestId:', requestId);

        sendMessageToBackground({ 
            action: 'downloadImage', 
            url: url,
            referer: referer
        }, (response) => {
            if (!response) {
                window.postMessage({ type: 'IMAGE_DOWNLOAD_RESULT', success: false, error: '后台未返回有效响应', requestId: requestId }, '*');
                return;
            }
            if (response.success) {
                const byteCharacters = atob(response.data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: response.contentType });
                window.postMessage({ type: 'IMAGE_DOWNLOAD_RESULT', success: true, blob: blob, requestId: requestId }, '*');
            } else {
                window.postMessage({ type: 'IMAGE_DOWNLOAD_RESULT', success: false, error: response.error || '未知错误', requestId: requestId }, '*');
            }
        });
    }

    // --- 磁力预览请求 ---
    if (event.data.type === 'REQUEST_MAGNET_PREVIEW') {
        const magnet = event.data.magnet;
        console.log('[Content] 请求磁力预览:', magnet);
        sendMessageToBackground({ action: 'magnetPreview', magnet: magnet }, (response) => {
            window.postMessage({
                type: 'MAGNET_PREVIEW_RESULT',
                success: response?.success || false,
                data: response?.data,
                error: response?.error
            }, '*');
        });
    }

    // --- PikPak 离线 ---
    if (event.data.type === 'REQUEST_PIKPAK_OFFLINE') {
        const magnet = event.data.magnet;
        const parentId = event.data.parentId || '';
        console.log('[Content] 收到 PikPak 离线请求:', magnet, 'parentId:', parentId);

        sendMessageToBackground({ action: 'pikpakOffline', magnet: magnet, parentId: parentId }, (response) => {
            console.log('[Content] 收到 background 响应:', response);
            if (!response) {
                window.postMessage({
                    type: 'PIKPAK_OFFLINE_RESULT',
                    success: false,
                    error: '扩展未返回有效响应'
                }, '*');
                return;
            }
            window.postMessage({
                type: 'PIKPAK_OFFLINE_RESULT',
                success: response.success,
                data: response.data,
                error: response.error,
                code: response.code
            }, '*');
        });
    }

    // --- 文件夹树（通过扩展直接请求，无需 CORS 代理） ---
    if (event.data.type === 'REQUEST_FOLDER_TREE') {
        console.log('[Content] 收到文件夹树请求');
        sendMessageToBackground({ action: 'fetchFolderTree' }, (response) => {
            window.postMessage({
                type: 'FOLDER_TREE_RESULT',
                success: response?.success || false,
                data: response?.data || [],
                error: response?.error || null
            }, '*');
        });
    }

    if (event.data.type === 'REQUEST_FOLDER_CHILDREN') {
        const parentId = event.data.parentId || '';
        sendMessageToBackground({ action: 'fetchFolderChildren', parentId }, (response) => {
            window.postMessage({
                type: 'FOLDER_CHILDREN_RESULT',
                success: response?.success || false,
                data: response?.data || [],
                error: response?.error || null
            }, '*');
        });
    }

    if (event.data.type === 'REQUEST_CREATE_FOLDER') {
        const { name, parentId } = event.data;
        console.log('[Content] 收到创建文件夹请求:', name, parentId);
        sendMessageToBackground({ action: 'createFolder', name: name, parentId: parentId || '' }, (response) => {
            window.postMessage({
                type: 'CREATE_FOLDER_RESULT',
                success: response?.success || false,
                data: response?.data || null,
                error: response?.error || null
            }, '*');
        });
    }

    // --- 获取待导入队列 ---
    if (event.data.type === 'REQUEST_PENDING_MAGNETS') {
        console.log('[Content] 收到待导入队列请求');
        sendMessageToBackground({ action: 'getPendingMagnets' }, (response) => {
            window.postMessage({
                type: 'PENDING_MAGNETS_RESULT',
                success: response?.success || false,
                data: response?.data || [],
                total: response?.total || 0,
                error: response?.error || null
            }, '*');
        });
    }

    // --- 清空待导入队列 ---
    if (event.data.type === 'REQUEST_CLEAR_PENDING_MAGNETS') {
        console.log('[Content] 收到清空队列请求');
        sendMessageToBackground({ action: 'clearPendingMagnets' }, (response) => {
            window.postMessage({
                type: 'CLEAR_PENDING_MAGNETS_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }

    // ===== 新增：保存磁力到管理器（用于批量添加和预览窗） =====
    if (event.data.type === 'REQUEST_SAVE_MAGNET') {
        const { magnet, title, size, imageUrl } = event.data;
        console.log('[Content] 收到保存磁力请求:', magnet.substring(0, 40) + '...');
        sendMessageToBackground({
            action: 'saveMagnet',
            magnet: magnet,
            title: title || '',
            size: size || '',
            imageUrl: imageUrl || ''
        }, (response) => {
            window.postMessage({
                type: 'SAVE_MAGNET_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }

    // ===== 新增：失败预览相关 =====
    if (event.data.type === 'REQUEST_FAILED_PREVIEWS') {
        console.log('[Content] 收到获取失败预览列表请求');
        sendMessageToBackground({ action: 'getFailedMagnets' }, (response) => {
            window.postMessage({
                type: 'FAILED_PREVIEWS_RESULT',
                success: response?.success || false,
                data: response?.data || [],
                total: response?.total || 0,
                error: response?.error || null
            }, '*');
        });
    }
    if (event.data.type === 'REQUEST_REMOVE_FAILED_PREVIEW') {
        const magnet = event.data.magnet;
        console.log('[Content] 收到删除失败预览请求:', magnet.substring(0, 40) + '...');
        sendMessageToBackground({ action: 'removeFailedMagnet', magnet: magnet }, (response) => {
            window.postMessage({
                type: 'REMOVE_FAILED_PREVIEW_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }
    if (event.data.type === 'REQUEST_CLEAR_FAILED_PREVIEWS') {
        console.log('[Content] 收到清空失败预览列表请求');
        sendMessageToBackground({ action: 'clearFailedMagnets' }, (response) => {
            window.postMessage({
                type: 'CLEAR_FAILED_PREVIEWS_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }
    if (event.data.type === 'REQUEST_SAVE_FAILED_MAGNET') {
        const { magnet, title } = event.data;
        console.log('[Content] 收到保存失败磁力请求:', magnet.substring(0, 40) + '...');
        sendMessageToBackground({
            action: 'saveFailedMagnet',
            magnet: magnet,
            title: title || ''
        }, (response) => {
            window.postMessage({
                type: 'SAVE_FAILED_MAGNET_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }

    // ===== 新增：预览缓存（持久化） =====
    if (event.data.type === 'REQUEST_PREVIEWED_MAGNETS') {
        console.log('[Content] 收到获取已预览列表请求');
        sendMessageToBackground({ action: 'getPreviewedMagnets' }, (response) => {
            window.postMessage({
                type: 'PREVIEWED_MAGNETS_RESULT',
                success: response?.success || false,
                data: response?.data || [],
                error: response?.error || null
            }, '*');
        });
    }
    if (event.data.type === 'REQUEST_ADD_PREVIEWED_MAGNET') {
        const magnet = event.data.magnet;
        console.log('[Content] 收到添加已预览磁力请求:', magnet.substring(0, 40) + '...');
        sendMessageToBackground({ action: 'addPreviewedMagnet', magnet: magnet }, (response) => {
            window.postMessage({
                type: 'ADD_PREVIEWED_MAGNET_RESULT',
                success: response?.success || false,
                error: response?.error || null
            }, '*');
        });
    }

    // --- 代理地址同步 ---
    if (event.data.type === 'PP_PROXY_UPDATED') {
        const proxy = event.data.proxy || '';
        chrome.storage.local.set({ pp_cors_proxy: proxy });
        console.log('[Content] 已同步代理地址到扩展存储:', proxy.substring(0, 40) || '(空)');
    }

    // --- 通信模式同步 ---
    if (event.data.type === 'PP_MODE_UPDATED') {
        const mode = event.data.mode || 'extension';
        chrome.storage.local.set({ pp_bridge_mode: mode });
        console.log('[Content] 已同步通信模式到扩展存储:', mode);
    }

    // --- 连通性测试 ---
    if (event.data.type === 'REQUEST_CONNECTION_TEST') {
        sendMessageToBackground({ action: 'testConnection' }, (response) => {
            window.postMessage({ type: 'CONNECTION_TEST_RESULT', success: response?.success || false, data: response?.data || [], error: response?.error }, '*');
        });
    }

    // --- 解析 fileId 为下载 URL ---
    if (event.data.type === 'REQUEST_RESOLVE_FILE') {
        const fileId = event.data.fileId;
        sendMessageToBackground({ action: 'resolveFile', fileId }, (response) => {
            window.postMessage({ type: 'RESOLVE_FILE_RESULT', success: response?.success || false, downloadUrl: response?.downloadUrl || '', error: response?.error || '' }, '*');
        });
    }

    // --- 解析 t.me 视频链接 ---
    if (event.data.type === 'REQUEST_RESOLVE_TG_VIDEO') {
        const messageUrl = event.data.messageUrl;
        sendMessageToBackground({ action: 'resolveTgVideo', messageUrl }, (response) => {
            window.postMessage({ type: 'RESOLVE_TG_VIDEO_RESULT', success: response?.success || false, videoUrl: response?.videoUrl || '', error: response?.error || '' }, '*');
        });
    }

    // --- 解析 t.me 链接（剪贴板监视用） ---
    if (event.data.type === 'REQUEST_RESOLVE_TG_LINK') {
        const url = event.data.url;
        sendMessageToBackground({ action: 'resolveTgLink', url }, (response) => {
            window.postMessage({ type: 'RESOLVE_TG_LINK_RESULT', success: response?.success || false, error: response?.error || '', message: response?.message || '', pendingCreated: response?.pendingCreated || false, restricted: response?.restricted || false }, '*');
        });
    }

    // --- 转发到 @PikPakBot ---
    if (event.data.type === 'REQUEST_FORWARD_TO_PIKPAK') {
        const fileId = event.data.fileId;
        const fileMeta = event.data.fileMeta || {};
        sendMessageToBackground({ action: 'forwardToPikpakBot', fileId, fileMeta }, (response) => {
            window.postMessage({ type: 'FORWARD_TO_PIKPAK_RESULT', success: response?.success || false, error: response?.error || '', errorCode: response?.errorCode || '' }, '*');
        });
    }

    // --- 获取全量 docMap（旧卡片迁移用） ---
    if (event.data.type === 'REQUEST_DOC_MAP') {
        sendMessageToBackground({ action: 'docMap' }, (response) => {
            window.postMessage({ type: 'DOC_MAP_RESULT', success: response?.success || false, docMap: response?.docMap || {}, error: response?.error || '' }, '*');
        });
    }

    // --- 轻量解析 t.me 链接（仅解析文件元数据，不下图不入队列） ---
    if (event.data.type === 'REQUEST_RESOLVE_TG_FILE') {
        const messageUrl = event.data.messageUrl;
        const docId = event.data.docId || '';
        sendMessageToBackground({ action: 'resolveTgFile', messageUrl, docId }, (response) => {
            window.postMessage({ type: 'RESOLVE_TG_FILE_RESULT', success: response?.success || false, error: response?.error || '', fileMeta: response?.fileMeta || null, errorCode: response?.errorCode || '' }, '*');
        });
    }

    // --- Telethon 登录 ---
    if (event.data.type === 'REQUEST_TELEGRAM_LOGIN_STATUS') {
        sendMessageToBackground({ action: 'telegramLoginStatus' }, (response) => {
            window.postMessage({ type: 'TELEGRAM_LOGIN_STATUS_RESULT', loggedIn: response?.loggedIn || false, error: response?.error || '' }, '*');
        });
    }
    if (event.data.type === 'REQUEST_TELEGRAM_SEND_CODE') {
        const phoneNumber = event.data.phoneNumber;
        sendMessageToBackground({ action: 'telegramSendCode', phoneNumber }, (response) => {
            window.postMessage({ type: 'TELEGRAM_SEND_CODE_RESULT', success: response?.success || false, error: response?.error || '' }, '*');
        });
    }
    if (event.data.type === 'REQUEST_TELEGRAM_SIGN_IN') {
        const code = event.data.code;
        sendMessageToBackground({ action: 'telegramSignIn', code }, (response) => {
            window.postMessage({ type: 'TELEGRAM_SIGN_IN_RESULT', success: response?.success || false, error: response?.error || '', needs2fa: response?.needs2fa || false }, '*');
        });
    }
    if (event.data.type === 'REQUEST_TELEGRAM_2FA') {
        const password = event.data.password;
        sendMessageToBackground({ action: 'telegram2fa', password }, (response) => {
            window.postMessage({ type: 'TELEGRAM_2FA_RESULT', success: response?.success || false, error: response?.error || '' }, '*');
        });
    }
    if (event.data.type === 'REQUEST_TELEGRAM_LOGOUT') {
        sendMessageToBackground({ action: 'telegramLogout' }, (response) => {
            window.postMessage({ type: 'TELEGRAM_LOGOUT_RESULT', success: response?.success || false, error: response?.error || '' }, '*');
        });
    }

    // ===== PikPak 共享目录转存 =====
    if (event.data.type === 'REQUEST_PIKPAK_SHARE_INFO') {
        const shareUrl = event.data.shareUrl;
        sendMessageToBackground({ action: 'getPikpakShareInfo', shareUrl }, (response) => {
            window.postMessage({ type: 'PIKPAK_SHARE_INFO_RESULT', success: response?.success || false, shareId: response?.shareId, passCodeToken: response?.passCodeToken, files: response?.files || [], error: response?.error || '' }, '*');
        });
    }
    if (event.data.type === 'REQUEST_SAVE_PIKPAK_SHARE_FILES') {
        const { shareId, passCodeToken, fileIds, parentId } = event.data;
        sendMessageToBackground({ action: 'savePikpakShareFiles', shareId, passCodeToken, fileIds, parentId }, (response) => {
            window.postMessage({ type: 'SAVE_PIKPAK_SHARE_FILES_RESULT', success: response?.success || false, data: response?.data, error: response?.error || '' }, '*');
        });
    }

    // ===== PikPak 共享目录子文件夹导航 =====
    if (event.data.type === 'REQUEST_PIKPAK_SHARE_FOLDER') {
        const { shareId, passCodeToken, parentId } = event.data;
        sendMessageToBackground({ action: 'getPikpakShareFolder', shareId, passCodeToken, parentId }, (response) => {
            window.postMessage({ type: 'PIKPAK_SHARE_FOLDER_RESULT', success: response?.success || false, files: response?.files || [], error: response?.error || '' }, '*');
        });
    }

    // --- 触发 Bot 队列检查（由页面 autoImport 驱动） ---
    if (event.data.type === 'REQUEST_BOT_POLL') {
        pollBotPendingItems().then(() => {
            window.postMessage({ type: 'BOT_POLL_COMPLETE' }, '*');
        });
    }
});

// ===== Telegram Bot 触发（由页面 autoImport 驱动，不定时） =====
async function pollBotPendingItems() {
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => resolve(false), 10000);
        sendMessageToBackground({ action: 'pollBotPending' }, (response) => {
            clearTimeout(timeoutId);
            resolve(response?.success || false);
        });
    });
}