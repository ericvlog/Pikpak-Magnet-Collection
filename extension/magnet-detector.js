(function() {
    if (window.__magnetDetectorInjected) return;
    window.__magnetDetectorInjected = true;

    console.log('[Magnet Detector] 已注入，扫描磁力链接...');

    // ===== 持久化预览缓存（新增） =====
    const PREVIEWED_CACHE_KEY = 'previewedMagnets';
    let previewedMagnets = new Set();

    // 加载预览缓存
    async function loadPreviewedCache() {
        try {
            const result = await chrome.storage.local.get([PREVIEWED_CACHE_KEY]);
            const list = result[PREVIEWED_CACHE_KEY] || [];
            previewedMagnets = new Set(list);
            console.log('[Magnet Detector] 加载预览缓存:', previewedMagnets.size, '条');
        } catch (e) {
            console.warn('[Magnet Detector] 加载预览缓存失败:', e);
        }
    }

    // 保存预览缓存
    async function savePreviewedCache() {
        try {
            const list = Array.from(previewedMagnets);
            await chrome.storage.local.set({ [PREVIEWED_CACHE_KEY]: list });
        } catch (e) {
            console.warn('[Magnet Detector] 保存预览缓存失败:', e);
        }
    }

    // 标记磁力为已预览（持久化）
    function markMagnetAsPreviewed(magnet) {
        previewedMagnets.add(magnet);
        savePreviewedCache();
    }

    // 检查磁力是否已预览
    function isMagnetPreviewed(magnet) {
        return previewedMagnets.has(magnet);
    }

    // ===== 标记按钮为已预览（变黄） =====
    function markButtonAsPreviewed(magnet) {
        markMagnetAsPreviewed(magnet);
        document.querySelectorAll(`.pk-magnet-btn[data-magnet="${CSS.escape(magnet)}"]`).forEach(btn => {
            btn.classList.add('previewed');
        });
    }

    // ===== 保存失败磁力到 429 列表 =====
    function saveFailedMagnet(magnet, title) {
        sendMessageToBackground({
            action: 'saveFailedMagnet',
            magnet: magnet,
            title: title || '未知资源'
        }, (response) => {
            if (response && response.success) {
                console.log('[Magnet Detector] 已记录失败磁力到 429 列表:', magnet.substring(0, 40) + '...');
            } else {
                console.warn('[Magnet Detector] 记录失败磁力失败:', response?.error);
            }
        });
    }

    // ===== 全局错误捕获 =====
    window.addEventListener('unhandledrejection', function(event) {
        const msg = event.reason?.message || String(event.reason);
        if (msg.includes('Extension context invalidated') ||
            msg.includes('Extension context') ||
            msg.includes('message port closed') ||
            msg.includes('Could not establish connection')) {
            event.preventDefault();
            console.debug('[Magnet Detector] 扩展上下文已失效，忽略此消息');
        }
    });

    // ===== 与后台通信的封装 =====
    function sendMessageToBackground(message, callback) {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message;
                    if (errMsg.includes('Extension context invalidated') ||
                        errMsg.includes('message port closed') ||
                        errMsg.includes('Could not establish connection')) {
                        if (callback) callback(null);
                        return;
                    }
                    console.warn('[Magnet Detector] 发送消息失败:', errMsg);
                    if (callback) callback(null);
                    return;
                }
                if (callback) callback(response);
            });
        } catch (e) {
            if (!e.message?.includes('Extension context')) {
                console.warn('[Magnet Detector] 发送消息异常:', e);
            }
            if (callback) callback(null);
        }
    }

    // ===== 外部触发预览（Torrent 解析完成后使用） =====
    window.__magnetHelperShowPreviewModal = function(magnet) {
        if (!magnet) {
            console.warn('[Magnet Detector] 无效磁力链接，无法触发预览');
            return;
        }
        try {
            showPreviewModal(magnet);
        } catch (err) {
            console.error('[Magnet Detector] 触发预览失败:', err);
        }
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === 'SHOW_MAGNET_PREVIEW') {
            const magnet = message.magnet;
            console.log('[Magnet Detector] 收到外部预览请求:', magnet);
            if (magnet) {
                try {
                    window.__magnetHelperShowPreviewModal(magnet);
                    sendResponse({ success: true });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            } else {
                sendResponse({ success: false, error: '缺少 magnet' });
            }
            return true;
        }
    });

    // ===== 倒计时提示 =====
    let cooldownToast = null;
    let cooldownInterval = null;

    function showCooldownToast(seconds) {
        if (cooldownToast) {
            cooldownToast.remove();
            cooldownToast = null;
        }
        if (cooldownInterval) {
            clearInterval(cooldownInterval);
            cooldownInterval = null;
        }

        const div = document.createElement('div');
        div.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #ef4444;
            color: white;
            padding: 12px 24px;
            border-radius: 40px;
            font-size: 14px;
            font-weight: 600;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            text-align: center;
            animation: fadeInUp 0.3s ease;
            min-width: 200px;
        `;
        div.id = 'pp-cooldown-toast';
        div.textContent = `预览服务繁忙，剩余 ${seconds} 秒后恢复`;

        document.body.appendChild(div);
        cooldownToast = div;

        let remaining = seconds;
        cooldownInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(cooldownInterval);
                cooldownInterval = null;
                if (cooldownToast) {
                    cooldownToast.remove();
                    cooldownToast = null;
                }
            } else {
                if (cooldownToast) {
                    cooldownToast.textContent = `预览服务繁忙，剩余 ${remaining} 秒后恢复`;
                }
            }
        }, 1000);
    }

    // ===== 样式注入（增加 .previewed 黄色样式） =====
    const style = document.createElement('style');
    style.textContent = `
        .pk-magnet-btn {
            display: inline-block;
            margin-left: 6px;
            padding: 0 6px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            vertical-align: middle;
            transition: transform 0.15s;
        }
        .pk-magnet-btn:hover {
            transform: scale(1.2);
        }
        .pk-magnet-btn svg {
            width: 18px;
            height: 18px;
            display: block;
            stroke: currentColor;
        }
        /* 已预览的图标变黄（仅视觉标记，不阻止点击） */
        .pk-magnet-btn.previewed svg {
            stroke: #fbbf24 !important;
            fill: #fbbf24 !important;
        }
        .pk-magnet-preview-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(4px);
        }
        .pk-magnet-preview-card {
            background: #fff;
            border-radius: 16px;
            width: 420px;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            border: 1px solid #e2e8f0;
        }
        .pk-magnet-preview-hero {
            width: 100%;
            height: 210px;
            background: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            border-radius: 16px 16px 0 0;
            position: relative;
        }
        .pk-magnet-preview-hero img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #1a1a2e;
            display: block;
        }
        .pk-magnet-preview-close {
            position: absolute;
            top: 12px;
            right: 12px;
            background: rgba(0,0,0,0.4);
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .pk-magnet-preview-close:hover {
            background: rgba(0,0,0,0.6);
        }
        .pk-magnet-preview-body {
            padding: 18px 20px 20px 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .pk-magnet-preview-title {
            font-size: 16px;
            font-weight: 800;
            line-height: 1.45;
            overflow: hidden;
            word-break: break-all;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }
        .pk-magnet-preview-desc {
            font-size: 12px;
            line-height: 1.5;
            opacity: 0.68;
        }
        .pk-magnet-preview-shots {
            display: flex;
            gap: 7px;
            overflow-x: auto;
            padding-bottom: 2px;
        }
        .pk-magnet-preview-shot {
            width: 68px;
            height: 42px;
            border-radius: 7px;
            overflow: hidden;
            flex: 0 0 auto;
            border: 1px solid #e2e8f0;
            cursor: pointer;
            transition: border-color 0.2s;
        }
        .pk-magnet-preview-shot.active {
            border-color: #1a5eff;
        }
        .pk-magnet-preview-shot img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #1a1a2e;
            display: block;
        }
        .pk-magnet-preview-meta {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
        }
        .pk-magnet-preview-meta-item {
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 8px 9px;
            background: #fff;
        }
        .pk-magnet-preview-meta-label {
            font-size: 11px;
            opacity: 0.58;
            margin-bottom: 4px;
        }
        .pk-magnet-preview-meta-value {
            font-size: 13px;
            font-weight: 700;
        }
        .pk-magnet-preview-hash {
            font-size: 11px;
            line-height: 1.45;
            opacity: 0.62;
            word-break: break-all;
            background: #f1f5f9;
            border-radius: 8px;
            padding: 8px 10px;
        }
        .pk-magnet-preview-folder {
            display: flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            height: 26px;
            margin-top: -2px;
            font-size: 12px;
            cursor: pointer;
            position: relative;
            user-select: none;
        }
        .pk-magnet-preview-folder-label {
            opacity: 0.72;
            flex-shrink: 0;
        }
        .pk-magnet-preview-folder-name {
            font-weight: 700;
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex-shrink: 1;
        }
        .pk-magnet-preview-folder-arrow {
            font-size: 9px;
            opacity: 0.5;
            transition: transform 0.2s;
            flex-shrink: 0;
        }
        .pk-magnet-preview-folder-arrow.open {
            transform: rotate(180deg);
        }
        .pk-magnet-preview-folder-dropdown {
            position: absolute;
            bottom: 100%;
            left: 0;
            right: 0;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.12);
            z-index: 9999;
            max-height: 200px;
            overflow-y: auto;
            margin-bottom: 4px;
        }
        .pk-magnet-preview-folder-option {
            padding: 8px 12px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .pk-magnet-preview-folder-option:hover {
            background: #f1f5f9;
        }
        .pk-magnet-preview-folder-option.active {
            background: #e8f0fe;
            color: #1a5eff;
            font-weight: 700;
        }
        .pk-magnet-preview-folder-option.loading,
        .pk-magnet-preview-folder-option.error {
            cursor: default;
            opacity: 0.6;
        }
        .pk-magnet-preview-folder-option.create {
            border-top: 1px solid #e2e8f0;
            color: #1a5eff;
            font-weight: 700;
        }
        body.dark .pk-magnet-preview-folder-dropdown {
            background: #1e293b;
            border-color: #334155;
        }
        body.dark .pk-magnet-preview-folder-option:hover {
            background: #334155;
        }
        body.dark .pk-magnet-preview-folder-option.active {
            background: #0f3b6b;
        }
        body.dark .pk-magnet-preview-folder-option.create {
            border-color: #334155;
        }
        .pk-magnet-preview-actions {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .pk-magnet-preview-actions button {
            flex: 1;
            height: 38px;
            border-radius: 9px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pk-magnet-preview-actions .btn-outline {
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #1a1a1a;
        }
        .pk-magnet-preview-actions .btn-outline:hover {
            background: #f1f5f9;
        }
        .pk-magnet-preview-actions .btn-primary {
            border: none;
            background: #1a5eff;
            color: #fff;
            font-weight: 800;
        }
        .pk-magnet-preview-actions .btn-primary:hover {
            filter: brightness(0.9);
        }
        .pk-magnet-preview-actions .btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .pk-magnet-preview-source {
            font-size: 11px;
            line-height: 1.35;
            opacity: 0.58;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .pk-magnet-preview-source a {
            color: #1a5eff;
            text-decoration: none;
            font-weight: 700;
        }
        .pk-magnet-preview-source a:hover {
            text-decoration: underline;
        }
        body.dark .pk-magnet-preview-card {
            background: #1e293b;
            border-color: #334155;
        }
        body.dark .pk-magnet-preview-hero {
            background: #0f172a;
        }
        body.dark .pk-magnet-preview-meta-item {
            background: #1e293b;
            border-color: #334155;
        }
        body.dark .pk-magnet-preview-hash {
            background: #0f172a;
        }
        body.dark .pk-magnet-preview-actions .btn-outline {
            background: #1e293b;
            border-color: #334155;
            color: #f1f5f9;
        }
        body.dark .pk-magnet-preview-actions .btn-outline:hover {
            background: #334155;
        }
    `;
    document.head.appendChild(style);

    // ===== 图标 SVG =====
    const iconSvg = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
    `;

    // ================================================================
    // 截图提取逻辑
    // ================================================================
    function toWhatslinkImageUrl(value) {
        let url = String(value || '').trim();
        if (!url) return '';
        if (/^\/\//.test(url)) url = `https:${url}`;
        else if (/^\//.test(url)) url = `https://whatslink.info${url}`;
        else if (!/^https?:\/\//i.test(url) && /\.(webp|png|jpe?g|gif)(\?|#|$)/i.test(url)) {
            url = `https://whatslink.info/${url.replace(/^\.?\//, '')}`;
        }
        return /^https?:\/\//i.test(url) ? url : '';
    }

    function pickShot(item) {
        if (!item) return null;
        if (typeof item === 'string') {
            const src = toWhatslinkImageUrl(item);
            return src ? { src, time: 0 } : null;
        }
        if (Array.isArray(item)) {
            for (const sub of item) {
                const shot = pickShot(sub);
                if (shot) return shot;
            }
            return null;
        }
        if (typeof item === 'object') {
            const officialSrc = toWhatslinkImageUrl(item.screenshot);
            if (officialSrc) return { src: officialSrc, time: Number(item.time || 0) || 0 };
            const keys = ['url', 'src', 'image', 'img', 'thumbnail', 'thumb', 'preview', 'poster', 'file', 'path'];
            for (const key of keys) {
                const shot = pickShot(item[key]);
                if (shot) return { src: shot.src, time: Number(item.time || shot.time || 0) || 0 };
            }
            for (const val of Object.values(item)) {
                const shot = pickShot(val);
                if (shot) return { src: shot.src, time: Number(item.time || shot.time || 0) || 0 };
            }
        }
        return null;
    }

    function collectShots(source) {
        const list = [];
        const seen = new Set();
        const push = (value) => {
            const shot = pickShot(value);
            if (shot && shot.src && !seen.has(shot.src)) {
                seen.add(shot.src);
                list.push(shot);
            }
        };
        if (Array.isArray(source.screenshots)) {
            source.screenshots.forEach(push);
        }
        if (source.screenshot) {
            push({ screenshot: source.screenshot, time: source.time });
        }
        if (Array.isArray(source.thumbnails)) {
            source.thumbnails.forEach(push);
        }
        if (Array.isArray(source.images)) {
            source.images.forEach(push);
        }
        if (Array.isArray(source.files)) {
            source.files.forEach(file => {
                if (file && (file.screenshots || file.screenshot || file.thumbnail || file.thumb || file.preview || file.poster || file.image || file.url || file.path)) {
                    push(file);
                }
            });
        }
        if (list.length === 0) {
            const shot = pickShot(source);
            if (shot) list.push(shot);
        }
        return list.slice(0, 5);
    }

    // ===== 工具函数 =====
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let size = bytes;
        while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
        return (size < 10 ? size.toFixed(2) : size.toFixed(1)) + ' ' + units[i];
    }

    let currentToast = null;
    function showToast(msg, isError = false, extraEl = null) {
        if (cooldownToast) return;
        if (currentToast) currentToast.remove();
        const div = document.createElement('div');
        div.textContent = msg;
        if (extraEl) div.appendChild(extraEl);
        div.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: ${isError ? '#ef4444' : '#10b981'};
            color: white;
            padding: 8px 20px;
            border-radius: 40px;
            font-size: 14px;
            font-weight: 600;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: fadeInUp 0.3s ease;
        `;
        document.body.appendChild(div);
        currentToast = div;
        if (!extraEl) {
            setTimeout(() => {
                div.style.opacity = '0';
                div.style.transition = 'opacity 0.3s';
                setTimeout(() => { if (currentToast === div) currentToast = null; div.remove(); }, 400);
            }, 2500);
        }
    }
    function hideToast() {
        if (currentToast) { currentToast.remove(); currentToast = null; }
    }

    // ===== 与后台通信 =====
    function requestPreview(magnet) {
        return new Promise((resolve, reject) => {
            sendMessageToBackground({ action: 'magnetPreview', magnet }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    if (response && response.cooldown !== undefined) {
                        showCooldownToast(response.cooldown);
                        reject(new Error(response.error || '预览服务繁忙'));
                    } else {
                        reject(new Error(response?.error || '预览请求失败'));
                    }
                }
            });
        });
    }

    function saveMagnetToManager(magnetLink, title, size, imageUrl) {
        return new Promise((resolve, reject) => {
            sendMessageToBackground({
                action: 'saveMagnet',
                magnet: magnetLink,
                title: title || '',
                size: size || '',
                imageUrl: imageUrl || ''
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve();
                } else {
                    reject(new Error(response?.error || '保存失败'));
                }
            });
        });
    }

    function ppFetchFolderTreeViaMessage() {
        return new Promise((resolve, reject) => {
            sendMessageToBackground({ action: 'fetchFolderTree' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.error || '获取文件夹树失败'));
                }
            });
        });
    }

    function ppFetchChildFoldersViaMessage(parentId) {
        return new Promise((resolve, reject) => {
            sendMessageToBackground({ action: 'fetchFolderChildren', parentId: parentId || '' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.error || '获取子文件夹失败'));
                }
            });
        });
    }

    function ppCreateFolderViaMessage(name, parentId) {
        return new Promise((resolve, reject) => {
            sendMessageToBackground({ action: 'createFolder', name, parentId: parentId || '' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.error || '创建文件夹失败'));
                }
            });
        });
    }

    function offlineToPikPak(magnet, parentId) {
        return new Promise((resolve, reject) => {
            const msg = { action: 'pikpakOffline', magnet: magnet };
            if (parentId) msg.parentId = parentId;
            sendMessageToBackground(msg, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.error || '离线失败'));
                }
            });
        });
    }

    // ===== 显示预览弹窗（核心修改：移除拦截） =====
    function showPreviewModal(magnetLink) {
        // 检查是否已预览（仅用于日志，不阻止请求）
        if (isMagnetPreviewed(magnetLink)) {
            console.log('[Magnet Detector] 该磁力已预览过，但仍可再次预览');
        }

        requestPreview(magnetLink)
            .then(data => {
                // 预览成功后，标记为已预览（持久化）
                markButtonAsPreviewed(magnetLink);

                console.log('[Magnet Detector] 预览数据:', data);
                const name = data.name || '未知资源';
                const count = data.count || 0;
                const size = data.size ? formatSize(data.size) : '未知';
                const type = data.file_type || data.type || '未知';
                const hash = (magnetLink.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || '';

                const shots = collectShots(data);
                const validShots = shots.map(s => s.src).filter(src => src && src.startsWith('http'));
                const heroSrc = validShots[0] || '';

                const overlay = document.createElement('div');
                overlay.className = 'pk-magnet-preview-overlay';
                overlay.innerHTML = `
                    <div class="pk-magnet-preview-card">
                        <div class="pk-magnet-preview-hero">
                            ${heroSrc ? `<img src="${heroSrc}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div style=\\'color:#888;font-size:14px;\\'>无预览图</div>'">` : '<div style="color:#888;font-size:14px;">无预览图</div>'}
                            <button class="pk-magnet-preview-close">✖</button>
                        </div>
                        <div class="pk-magnet-preview-body">
                            <div>
                                <div class="pk-magnet-preview-title" contenteditable="plaintext-only">${escapeHtml(name)}</div>
                                <div class="pk-magnet-preview-desc">检测到磁力链接，选择以下操作：</div>
                            </div>
                            ${validShots.length > 1 ? `
                            <div class="pk-magnet-preview-shots">
                                ${validShots.slice(0, 5).map((src, idx) => `
                                    <div class="pk-magnet-preview-shot ${idx === 0 ? 'active' : ''}" data-src="${src}">
                                        <img src="${src}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.pk-magnet-preview-shot')?.remove();">
                                    </div>
                                `).join('')}
                            </div>
                            ` : ''}
                            <div class="pk-magnet-preview-meta">
                                <div class="pk-magnet-preview-meta-item">
                                    <div class="pk-magnet-preview-meta-label">文件数</div>
                                    <div class="pk-magnet-preview-meta-value">${count}</div>
                                </div>
                                <div class="pk-magnet-preview-meta-item">
                                    <div class="pk-magnet-preview-meta-label">总大小</div>
                                    <div class="pk-magnet-preview-meta-value">${size}</div>
                                </div>
                                <div class="pk-magnet-preview-meta-item">
                                    <div class="pk-magnet-preview-meta-label">类型</div>
                                    <div class="pk-magnet-preview-meta-value">${escapeHtml(type)}</div>
                                </div>
                            </div>
                            <div class="pk-magnet-preview-hash">磁力：${hash}</div>
                            <div class="pk-magnet-preview-folder" id="magnetPreviewFolderSelector">
                                <span class="pk-magnet-preview-folder-label">保存到：</span>
                                <span class="pk-magnet-preview-folder-name" id="magnetPreviewFolderName">📁 默认文件夹</span>
                                <span class="pk-magnet-preview-folder-arrow" id="magnetPreviewFolderArrow">▼</span>
                                <div class="pk-magnet-preview-folder-dropdown" id="magnetPreviewFolderDropdown" style="display:none;"></div>
                            </div>
                            <div class="pk-magnet-preview-actions">
                                <button class="btn-outline" data-action="offline">离线下载</button>
                                <button class="btn-outline" data-action="save">保存到管理器</button>
                                <button class="btn-primary" data-action="both">离线并保存</button>
                            </div>
                            <div class="pk-magnet-preview-source">
                                预览信息来自 <a href="https://whatslink.info/" target="_blank" rel="noopener noreferrer">whatslink.info</a>
                            </div>
                        </div>
                    </div>
                `;

                document.body.appendChild(overlay);

                const closeBtn = overlay.querySelector('.pk-magnet-preview-close');
                let selectedImageUrl = heroSrc;
                let selectedParentId = '';
                let selectedFolderName = '📁 默认文件夹';
                let folderDropdownOpen = false;

                overlay.querySelectorAll('.pk-magnet-preview-shot').forEach(shot => {
                    shot.addEventListener('click', () => {
                        const src = shot.dataset.src;
                        const hero = overlay.querySelector('.pk-magnet-preview-hero img');
                        if (hero && src) {
                            hero.src = src;
                            selectedImageUrl = src;
                        }
                        overlay.querySelectorAll('.pk-magnet-preview-shot').forEach(s => s.classList.remove('active'));
                        shot.classList.add('active');
                    });
                });

                const close = () => overlay.remove();
                closeBtn.addEventListener('click', close);
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) close();
                });

                // ===== 文件夹选择器（按需加载，逐层导航） =====
                const folderSelector = overlay.querySelector('#magnetPreviewFolderSelector');
                const folderNameEl = overlay.querySelector('#magnetPreviewFolderName');
                const folderArrowEl = overlay.querySelector('#magnetPreviewFolderArrow');
                const folderDropdown = overlay.querySelector('#magnetPreviewFolderDropdown');
                let folderNavPath = []; // 导航路径栈：{ id, name }

                function closeFolderDropdown() {
                    folderDropdownOpen = false;
                    folderArrowEl.classList.remove('open');
                    folderDropdown.style.display = 'none';
                }

                function getCurrentParentId() {
                    return folderNavPath.length > 0 ? folderNavPath[folderNavPath.length - 1].id : '';
                }

                async function loadAndRenderCurrentLevel() {
                    folderDropdown.innerHTML = '<div class="pk-magnet-preview-folder-option loading">加载中...</div>';
                    try {
                        const parentId = getCurrentParentId();
                        const folders = await ppFetchChildFoldersViaMessage(parentId);
                        renderFolderList(folders);
                    } catch (err) {
                        folderDropdown.innerHTML = '<div class="pk-magnet-preview-folder-option error">加载失败: ' + escapeHtml(err.message) + '</div>';
                    }
                }

                function renderFolderList(folders) {
                    let html = '';
                    // 返回上级
                    if (folderNavPath.length > 0) {
                        html += '<div class="pk-magnet-preview-folder-option back" data-action="back">← 返回上级</div>';
                    }
                    // 子文件夹（可点击进入）
                    for (const f of folders) {
                        const active = f.id === selectedParentId ? ' active' : '';
                        html += `<div class="pk-magnet-preview-folder-option${active}" data-id="${f.id}" data-enter="1">📁 ${escapeHtml(f.name)}</div>`;
                    }
                    // 新建文件夹
                    html += '<div class="pk-magnet-preview-folder-option create" data-action="create">➕ 新建文件夹</div>';
                    folderDropdown.innerHTML = html;

                    // 返回上级
                    const backBtn = folderDropdown.querySelector('[data-action="back"]');
                    if (backBtn) {
                        backBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            folderNavPath.pop();
                            loadAndRenderCurrentLevel();
                        });
                    }

                    // 进入子文件夹
                    folderDropdown.querySelectorAll('[data-enter="1"]').forEach(opt => {
                        opt.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const id = opt.dataset.id;
                            const name = opt.textContent.replace('📁', '').trim();
                            folderNavPath.push({ id, name });
                            selectedParentId = id;
                            selectedFolderName = '📂 ' + folderNavPath.map(p => p.name).join(' / ');
                            folderNameEl.textContent = selectedFolderName;
                            folderDropdown.querySelectorAll('.pk-magnet-preview-folder-option').forEach(o => o.classList.remove('active'));
                            opt.classList.add('active');
                            await loadAndRenderCurrentLevel();
                        });
                    });

                    // 新建文件夹
                    const createOpt = folderDropdown.querySelector('[data-action="create"]');
                    if (createOpt) {
                        createOpt.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const name = prompt('请输入新文件夹名称：');
                            if (!name || !name.trim()) return;
                            try {
                                createOpt.textContent = '创建中...';
                                const parentId = folderNavPath.length > 0 ? folderNavPath[folderNavPath.length - 1].id : '';
                                const result = await ppCreateFolderViaMessage(name.trim(), parentId);
                                selectedParentId = result.id;
                                selectedFolderName = '📂 ' + (folderNavPath.length > 0 ? folderNavPath.map(p => p.name).join(' / ') + ' / ' : '') + name.trim();
                                folderNameEl.textContent = selectedFolderName;
                                await loadAndRenderCurrentLevel();
                            } catch (err) {
                                alert('创建文件夹失败: ' + err.message);
                            }
                        });
                    }
                }

                folderSelector.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!folderDropdownOpen) {
                        folderDropdownOpen = true;
                        folderArrowEl.classList.add('open');
                        folderDropdown.style.display = 'block';
                        if (!folderDropdown.dataset.loaded) {
                            await loadAndRenderCurrentLevel();
                            folderDropdown.dataset.loaded = 'true';
                        } else {
                            loadAndRenderCurrentLevel();
                        }
                    } else {
                        closeFolderDropdown();
                    }
                });

                document.addEventListener('click', (e) => {
                    if (folderDropdownOpen && !folderSelector.contains(e.target)) {
                        closeFolderDropdown();
                    }
                });

                const buttons = overlay.querySelectorAll('[data-action]');
                buttons.forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const action = btn.dataset.action;
                        const originalText = btn.textContent;
                        btn.disabled = true;
                        btn.textContent = '处理中...';

                        try {
                            if (action === 'offline') {
                                await offlineToPikPak(magnetLink, selectedParentId);
                                showToast('✅ 已发送到 PikPak 离线下载');
                                close();
                            } else if (action === 'save') {
                                const editedName = (overlay.querySelector('.pk-magnet-preview-title').textContent || '').trim() || name;
                                await saveMagnetToManager(magnetLink, editedName, size, selectedImageUrl);
                                showToast('✅ 已保存到磁力管理器');
                                close();
                            } else if (action === 'both') {
                                const editedName = (overlay.querySelector('.pk-magnet-preview-title').textContent || '').trim() || name;
                                await Promise.all([
                                    offlineToPikPak(magnetLink, selectedParentId),
                                    saveMagnetToManager(magnetLink, editedName, size, selectedImageUrl)
                                ]);
                                showToast('✅ 已离线并保存到管理器');
                                close();
                            }
                        } catch (err) {
                            showToast('❌ ' + err.message, true);
                            btn.disabled = false;
                            btn.textContent = originalText;
                        }
                    });
                });
            })
            .catch(err => {
                const errorMsg = err.message || '预览失败';
                console.warn('[Magnet Detector] 预览失败:', errorMsg);

                let title = magnetLink;
                const dnMatch = magnetLink.match(/[?&]dn=([^&]+)/i);
                if (dnMatch) {
                    try { title = decodeURIComponent(dnMatch[1]); } catch(e) {}
                } else {
                    const btn = document.querySelector(`.pk-magnet-btn[data-magnet="${CSS.escape(magnetLink)}"]`);
                    if (btn && btn.parentElement) {
                        const prev = btn.parentElement.querySelector('a');
                        if (prev) title = prev.textContent.trim();
                    }
                }
                const hash = (magnetLink.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || '';

                if (errorMsg.includes('429') ||
                    errorMsg.includes('繁忙') ||
                    errorMsg.includes('too many requests') ||
                    errorMsg.includes('限流') ||
                    errorMsg.includes('冷却')) {
                    saveFailedMagnet(magnetLink, title);
                    if (!cooldownToast) {
                        showToast('预览服务繁忙，已记录失败磁力', true);
                    }
                }

                // 保持完整弹窗结构，仅替换图片区域为占位
                const overlay = document.createElement('div');
                overlay.className = 'pk-magnet-preview-overlay';
                overlay.innerHTML = `
                    <div class="pk-magnet-preview-card">
                        <div class="pk-magnet-preview-hero" style="min-height:40px;display:flex;align-items:center;justify-content:center;background:#f5f5f5;">
                            <div style="color:#999;font-size:14px;text-align:center;padding:16px;">
                                <div style="font-size:20px;margin-bottom:4px;">🖼️</div>
                                预览暂不可用<br><span style="font-size:12px;">${escapeHtml(errorMsg)}</span>
                            </div>
                            <button class="pk-magnet-preview-close">✖</button>
                        </div>
                        <div class="pk-magnet-preview-body">
                            <div>
                                <div class="pk-magnet-preview-title" contenteditable="plaintext-only">${escapeHtml(title)}</div>
                                <div class="pk-magnet-preview-desc">whatslink.info 暂时无法预览，仍可直接操作：</div>
                            </div>
                            ${hash ? `<div class="pk-magnet-preview-hash">磁力：${hash}</div>` : ''}
                            <div class="pk-magnet-preview-folder" id="magnetPreviewFolderSelector">
                                <span class="pk-magnet-preview-folder-label">保存到：</span>
                                <span class="pk-magnet-preview-folder-name" id="magnetPreviewFolderName">📁 默认文件夹</span>
                                <span class="pk-magnet-preview-folder-arrow" id="magnetPreviewFolderArrow">▼</span>
                                <div class="pk-magnet-preview-folder-dropdown" id="magnetPreviewFolderDropdown" style="display:none;"></div>
                            </div>
                            <div class="pk-magnet-preview-actions">
                                <button class="btn-outline" data-action="offline">离线下载</button>
                                <button class="btn-outline" data-action="save">保存到管理器</button>
                                <button class="btn-primary" data-action="both">离线并保存</button>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                let selectedParentId = '';
                let selectedFolderName = '📁 默认文件夹';
                let folderDropdownOpen = false;

                const close = () => overlay.remove();
                overlay.querySelector('.pk-magnet-preview-close').addEventListener('click', close);
                overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

                // ===== 文件夹选择器 =====
                const folderSelector = overlay.querySelector('#magnetPreviewFolderSelector');
                const folderNameEl = overlay.querySelector('#magnetPreviewFolderName');
                const folderArrowEl = overlay.querySelector('#magnetPreviewFolderArrow');
                const folderDropdown = overlay.querySelector('#magnetPreviewFolderDropdown');
                let folderNavPath = [];

                function closeFolderDropdown() {
                    folderDropdownOpen = false;
                    folderArrowEl.classList.remove('open');
                    folderDropdown.style.display = 'none';
                }

                function getCurrentParentId() {
                    return folderNavPath.length > 0 ? folderNavPath[folderNavPath.length - 1].id : '';
                }

                async function loadAndRenderCurrentLevel() {
                    folderDropdown.innerHTML = '<div class="pk-magnet-preview-folder-option loading">加载中...</div>';
                    try {
                        const parentId = getCurrentParentId();
                        const folders = await ppFetchChildFoldersViaMessage(parentId);
                        renderFolderList(folders);
                    } catch (err) {
                        folderDropdown.innerHTML = '<div class="pk-magnet-preview-folder-option error">加载失败: ' + escapeHtml(err.message) + '</div>';
                    }
                }

                function renderFolderList(folders) {
                    let html = '';
                    if (folderNavPath.length > 0) {
                        html += '<div class="pk-magnet-preview-folder-option back" data-action="back">← 返回上级</div>';
                    }
                    for (const f of folders) {
                        const active = f.id === selectedParentId ? ' active' : '';
                        html += `<div class="pk-magnet-preview-folder-option${active}" data-id="${f.id}" data-enter="1">📁 ${escapeHtml(f.name)}</div>`;
                    }
                    html += '<div class="pk-magnet-preview-folder-option create" data-action="create">➕ 新建文件夹</div>';
                    folderDropdown.innerHTML = html;

                    const backBtn = folderDropdown.querySelector('[data-action="back"]');
                    if (backBtn) {
                        backBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            folderNavPath.pop();
                            loadAndRenderCurrentLevel();
                        });
                    }

                    folderDropdown.querySelectorAll('[data-enter="1"]').forEach(opt => {
                        opt.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const id = opt.dataset.id;
                            const name = opt.textContent.replace('📁', '').trim();
                            folderNavPath.push({ id, name });
                            selectedParentId = id;
                            selectedFolderName = '📂 ' + folderNavPath.map(p => p.name).join(' / ');
                            folderNameEl.textContent = selectedFolderName;
                            folderDropdown.querySelectorAll('.pk-magnet-preview-folder-option').forEach(o => o.classList.remove('active'));
                            opt.classList.add('active');
                            await loadAndRenderCurrentLevel();
                        });
                    });

                    const createOpt = folderDropdown.querySelector('[data-action="create"]');
                    if (createOpt) {
                        createOpt.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const name = prompt('请输入新文件夹名称：');
                            if (!name || !name.trim()) return;
                            try {
                                createOpt.textContent = '创建中...';
                                const parentId = folderNavPath.length > 0 ? folderNavPath[folderNavPath.length - 1].id : '';
                                const result = await ppCreateFolderViaMessage(name.trim(), parentId);
                                selectedParentId = result.id;
                                selectedFolderName = '📂 ' + (folderNavPath.length > 0 ? folderNavPath.map(p => p.name).join(' / ') + ' / ' : '') + name.trim();
                                folderNameEl.textContent = selectedFolderName;
                                await loadAndRenderCurrentLevel();
                            } catch (err) {
                                alert('创建文件夹失败: ' + err.message);
                            }
                        });
                    }
                }

                folderSelector.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!folderDropdownOpen) {
                        folderDropdownOpen = true;
                        folderArrowEl.classList.add('open');
                        folderDropdown.style.display = 'block';
                        if (!folderDropdown.dataset.loaded) {
                            await loadAndRenderCurrentLevel();
                            folderDropdown.dataset.loaded = 'true';
                        } else {
                            loadAndRenderCurrentLevel();
                        }
                    } else {
                        closeFolderDropdown();
                    }
                });

                document.addEventListener('click', (e) => {
                    if (folderDropdownOpen && !folderSelector.contains(e.target)) {
                        closeFolderDropdown();
                    }
                });

                // ===== 操作按钮 =====
                overlay.querySelectorAll('[data-action]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const action = btn.dataset.action;
                        const originalText = btn.textContent;
                        btn.disabled = true;
                        btn.textContent = '处理中...';
                        try {
                            if (action === 'offline') {
                                await offlineToPikPak(magnetLink, selectedParentId);
                                showToast('✅ 已离线到 PikPak');
                                close();
                            } else if (action === 'save') {
                                const editedName = (overlay.querySelector('.pk-magnet-preview-title').textContent || '').trim() || title;
                                await saveMagnetToManager(magnetLink, editedName, '', '');
                                showToast('✅ 已保存到管理器');
                                close();
                            } else if (action === 'both') {
                                const editedName = (overlay.querySelector('.pk-magnet-preview-title').textContent || '').trim() || title;
                                await Promise.all([
                                    offlineToPikPak(magnetLink, selectedParentId),
                                    saveMagnetToManager(magnetLink, editedName, '', '')
                                ]);
                                showToast('✅ 已离线并保存');
                                close();
                            }
                        } catch (err) {
                            showToast('❌ ' + err.message, true);
                            btn.disabled = false;
                            btn.textContent = originalText;
                        }
                    });
                });
            });
    }

    // ===== 扫描页面中的磁力链接 =====
    function scanAndAddButtons() {
        const magnetLinks = [];

        document.querySelectorAll('a[href*="magnet:?xt=urn:btih:"]').forEach(a => {
            const href = a.href;
            if (href && !a.dataset.pkMagnetProcessed) {
                a.dataset.pkMagnetProcessed = 'true';
                magnetLinks.push({ element: a, url: href });
            }
        });

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const text = node.textContent;
                    if (text && /magnet:\?xt=urn:btih:[a-fA-F0-9]{40}/i.test(text)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const match = text.match(/(magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^\s]*)/i);
            if (match) {
                const url = match[1];
                if (textNode.parentElement.dataset.pkMagnetProcessed) return;
                textNode.parentElement.dataset.pkMagnetProcessed = 'true';
                const span = document.createElement('span');
                span.textContent = text.substring(0, match.index);
                const link = document.createElement('a');
                link.href = url;
                link.textContent = url;
                link.style.color = '#1a5eff';
                link.style.textDecoration = 'underline';
                link.addEventListener('click', (e) => { e.preventDefault(); });
                const button = document.createElement('button');
                button.className = 'pk-magnet-btn';
                button.innerHTML = iconSvg;
                button.dataset.magnet = url;
                // 如果已预览过，直接加 class
                if (isMagnetPreviewed(url)) {
                    button.classList.add('previewed');
                }
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPreviewModal(url);
                });
                span.appendChild(link);
                span.appendChild(button);
                const afterText = text.substring(match.index + match[0].length);
                span.appendChild(document.createTextNode(afterText));
                textNode.parentElement.replaceChild(span, textNode);
            }
        });

        magnetLinks.forEach(({ element, url }) => {
            if (element.nextElementSibling && element.nextElementSibling.classList.contains('pk-magnet-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'pk-magnet-btn';
            btn.innerHTML = iconSvg;
            btn.dataset.magnet = url;
            if (isMagnetPreviewed(url)) {
                btn.classList.add('previewed');
            }
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showPreviewModal(url);
            });
            element.insertAdjacentElement('afterend', btn);
        });
    }

    // ===== 初始化 =====
    // 先加载预览缓存，再扫描页面
    loadPreviewedCache().then(() => {
        setTimeout(scanAndAddButtons, 500);
    });

    const observer = new MutationObserver(() => {
        scanAndAddButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.__scanMagnetLinks = scanAndAddButtons;
})();