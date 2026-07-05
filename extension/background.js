console.log('[图片助手] Service Worker 已激活 (内部登录模式)');

// ===== 全局错误捕获 =====
self.addEventListener('unhandledrejection', function(event) {
    console.error('[Service Worker] 未捕获的 Promise 拒绝:', event.reason);
    event.preventDefault();
});
self.addEventListener('error', function(event) {
    console.error('[Service Worker] 未捕获的错误:', event.error);
    event.preventDefault();
});

// ===== 常量 =====
const DEFAULT_WHITELIST = [
    'imagetwist.com',
    'imagebam.com',
    'imgbox.com',
    'postimg.cc',
    'postimages.org',
    'ibb.co',
    'imgur.com',
    'picsum.photos'
];

const CLIENT_ID = 'Ypcug64Odf8hwuKB';
const CLIENT_SECRET = 'YUMx5nI8ZU8Ap8pm';
const TOKEN_URL = 'https://user.mypikpak.com/v1/auth/token';
const LOGIN_URL = 'https://user.mypikpak.com/v1/auth/signin';
const CAPTCHA_INIT_URL = 'https://user.mypikpak.com/v1/shield/captcha/init';

// ===== Device ID 管理 =====
async function getDeviceId() {
    const result = await chrome.storage.local.get('deviceId');
    if (result.deviceId) {
        return result.deviceId;
    }
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const deviceId = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ deviceId });
    console.log('[后台] 生成新 device_id:', deviceId);
    return deviceId;
}

// ===== Token 管理 =====
let tokenRefreshLock = false;
let lastRefreshTime = 0;
const REFRESH_COOLDOWN = 120 * 1000;
let tokenRefreshInterval = null;
let savedUsername = '';
let savedPassword = '';

// ===== 读取存储 =====
async function getPikPakTokenFromStorage() {
    try {
        const result = await chrome.storage.local.get([
            'pikpakToken', 'refreshToken', 'captchaToken',
            'deviceId', 'tokenCapturedAt', 'tokenValid', 'expires_at',
            'pikpakUsername', 'pikpakPassword'
        ]);
        console.log('[后台] 从存储读取:', {
            hasToken: !!result.pikpakToken,
            hasRefreshToken: !!result.refreshToken,
            refreshTokenLength: result.refreshToken ? result.refreshToken.length : 0,
            hasSavedAccount: !!(result.pikpakUsername && result.pikpakPassword)
        });
        if (result.pikpakUsername) savedUsername = result.pikpakUsername;
        if (result.pikpakPassword) savedPassword = result.pikpakPassword;
        return {
            token: result.pikpakToken || '',
            refreshToken: result.refreshToken || '',
            captchaToken: result.captchaToken || '',
            deviceId: result.deviceId || '',
            tokenCapturedAt: result.tokenCapturedAt || null,
            tokenValid: result.tokenValid !== false,
            expiresAt: result.expires_at || 0,
            username: result.pikpakUsername || '',
            password: result.pikpakPassword || ''
        };
    } catch (err) {
        console.warn('[后台] 读取存储失败:', err);
        return { token: '', refreshToken: '', captchaToken: '', deviceId: '', tokenCapturedAt: null, tokenValid: true, expiresAt: 0, username: '', password: '' };
    }
}

// ===== 登录 =====
async function loginWithPassword(username, password) {
    console.log('[后台] 开始登录:', username);
    const deviceId = await getDeviceId();

    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Origin': 'https://mypikpak.com',
        'Referer': 'https://mypikpak.com/',
    };

    let meta = {};
    if (username.includes('@')) {
        meta = { email: username };
    } else if (/^\d+$/.test(username)) {
        meta = { phone_number: username };
    } else {
        meta = { username: username };
    }

    // 获取 captcha_token
    const captchaResponse = await fetch(CAPTCHA_INIT_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            client_id: CLIENT_ID,
            action: 'POST:/v1/auth/signin',
            device_id: deviceId,
            meta: meta
        })
    });
    if (!captchaResponse.ok) {
        const errText = await captchaResponse.text();
        throw new Error(`获取 captcha 失败: ${errText}`);
    }
    const captchaData = await captchaResponse.json();
    const captchaToken = captchaData.captcha_token || '';
    if (!captchaToken) {
        throw new Error('获取 captcha_token 失败');
    }

    // 执行登录
    const loginResponse = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            username: username,
            password: password,
            captcha_token: captchaToken,
            device_id: deviceId
        })
    });

    if (!loginResponse.ok) {
        const errText = await loginResponse.text();
        throw new Error(`登录失败: ${errText}`);
    }

    const data = await loginResponse.json();
    console.log('[后台] 登录成功, 用户:', data.sub);

    const tokenType = data.token_type || 'Bearer';
    const fullToken = tokenType + ' ' + data.access_token;
    const expiresAt = Date.now() + (data.expires_in || 7200) * 1000;

    await chrome.storage.local.set({
        pikpakToken: fullToken,
        refreshToken: data.refresh_token || '',
        expires_at: expiresAt,
        captchaToken: captchaToken,
        deviceId: deviceId,
        tokenCapturedAt: Date.now(),
        tokenValid: true,
        pikpakUsername: username,
        pikpakPassword: password
    });

    savedUsername = username;
    savedPassword = password;

    return data;
}

// ===== 刷新 Token =====
async function refreshAccessToken(refreshToken) {
    console.log('[后台] 开始刷新，refreshToken 长度:', refreshToken ? refreshToken.length : 0);

    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Origin': 'https://mypikpak.com',
        'Referer': 'https://mypikpak.com/',
    };

    const response = await fetch('https://user.mypikpak.com/v1/auth/token', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('[后台] 刷新响应错误:', errText);
        let isInvalidGrant = false;
        try {
            const errJson = JSON.parse(errText);
            if (errJson.error === 'invalid_grant') isInvalidGrant = true;
            if (errJson.error === 'permission_denied') {
                throw new Error('permission_denied');
            }
        } catch (e) {}
        const error = new Error(`HTTP ${response.status}: ${errText}`);
        error.isInvalidGrant = isInvalidGrant;
        throw error;
    }
    const data = await response.json();
    console.log('[后台] 刷新成功，新 token 类型:', data.token_type);
    return data;
}

// ===== 刷新检查 =====
async function refreshTokenIfNeeded(force = false) {
    if (tokenRefreshLock) {
        console.log('[自动刷新] 刷新进行中，跳过');
        return false;
    }
    try {
        const stored = await getPikPakTokenFromStorage();
        if (!stored.refreshToken) {
            console.log('[自动刷新] 无 refresh_token');
            if (stored.username && stored.password) {
                console.log('[自动刷新] 尝试使用保存的账号自动登录...');
                try {
                    await loginWithPassword(stored.username, stored.password);
                    console.log('[自动刷新] 自动登录成功');
                    return true;
                } catch (loginErr) {
                    console.error('[自动刷新] 自动登录失败:', loginErr);
                    return false;
                }
            }
            return false;
        }
        const now = Date.now();
        const expiresAt = stored.expiresAt || 0;
        const timeLeft = expiresAt - now;
        const needRefresh = force || (timeLeft < 30 * 60 * 1000 && timeLeft > -60000);
        if (!needRefresh) {
            console.log('[自动刷新] Token 有效，剩余', Math.round(timeLeft / 1000), '秒');
            return true;
        }
        if (!force && (now - lastRefreshTime) < REFRESH_COOLDOWN) {
            console.log('[自动刷新] 刷新过于频繁，跳过');
            return false;
        }
        tokenRefreshLock = true;
        console.log('[自动刷新] 开始刷新 Token...');
        const newTokenData = await refreshAccessToken(stored.refreshToken);
        const newAccessToken = newTokenData.access_token;
        const newExpiresIn = newTokenData.expires_in || 7200;
        const newRefreshToken = newTokenData.refresh_token || stored.refreshToken;
        const tokenType = newTokenData.token_type || 'Bearer';
        const fullToken = tokenType + ' ' + newAccessToken;

        await chrome.storage.local.set({
            pikpakToken: fullToken,
            refreshToken: newRefreshToken,
            expires_at: Date.now() + newExpiresIn * 1000,
            tokenValid: true,
            tokenCapturedAt: Date.now()
        });
        lastRefreshTime = Date.now();
        console.log('[自动刷新] Token 刷新成功，有效期', newExpiresIn, '秒');
        tokenRefreshLock = false;
        return true;
    } catch (err) {
        if (err.message === 'permission_denied' || err.isInvalidGrant) {
            console.warn('[自动刷新] Token 失效，尝试使用保存的账号重新登录...');
            const stored = await getPikPakTokenFromStorage();
            if (stored.username && stored.password) {
                try {
                    await loginWithPassword(stored.username, stored.password);
                    console.log('[自动刷新] 重新登录成功');
                    tokenRefreshLock = false;
                    return true;
                } catch (loginErr) {
                    console.error('[自动刷新] 重新登录失败:', loginErr);
                }
            }
            console.warn('[自动刷新] 清除存储，请手动登录');
            await chrome.storage.local.remove([
                'pikpakToken', 'refreshToken', 'captchaToken',
                'deviceId', 'tokenCapturedAt', 'tokenValid', 'expires_at'
            ]);
            tokenRefreshLock = false;
            throw new Error('Token 已失效，请重新登录 PikPak');
        }
        console.error('[自动刷新] Token 刷新失败:', err);
        await chrome.storage.local.set({ tokenValid: false });
        tokenRefreshLock = false;
        return false;
    }
}

function startTokenRefreshScheduler() {
    if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = setInterval(() => {
        refreshTokenIfNeeded(false).catch(() => {});
    }, 15 * 60 * 1000);
    setTimeout(() => refreshTokenIfNeeded(false), 5000);
}
startTokenRefreshScheduler();

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.pikpakToken) {
        chrome.storage.local.set({ tokenValid: true });
        console.log('[自动刷新] Token 已更新，标记有效');
    }
});

// ===== 白名单功能（供 downloadImage 使用） =====
async function getWhitelist() {
    const result = await chrome.storage.sync.get('whitelist');
    if (result.whitelist && Array.isArray(result.whitelist) && result.whitelist.length > 0) {
        return result.whitelist;
    }
    await chrome.storage.sync.set({ whitelist: DEFAULT_WHITELIST });
    return DEFAULT_WHITELIST;
}

function isUrlWhitelisted(url, whitelist) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        return whitelist.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    } catch {
        return false;
    }
}

// ================================================================
// Torrent 解析（与 t2m.js 完全一致）
// 核心逻辑：
//   1. Bencode.decode 完整解码
//   2. Bencode.encode(info) 重新编码 info 字典
//   3. SHA1 计算
//   4. 转 Base32
// ================================================================

// ---- Bencode 解码 ----
function Bencode_decode(str) {
    let pos = 0;
    const len = str.length;

    function decode_value() {
        if (pos >= len) throw new Error('Invalid format');
        const c = str[pos];
        if (c >= '0' && c <= '9') return decode_string();
        if (c === 'i') return decode_int();
        if (c === 'l') return decode_list();
        if (c === 'd') return decode_dict();
        throw new Error('Invalid format');
    }

    function decode_string() {
        const start = pos;
        while (pos < len && str[pos] >= '0' && str[pos] <= '9') pos++;
        if (pos === start || str[pos] !== ':') throw new Error('Invalid format');
        const length = parseInt(str.substring(start, pos), 10);
        pos++;
        const value = str.substring(pos, pos + length);
        pos += length;
        return value;
    }

    function decode_int() {
        pos++; // skip 'i'
        const start = pos;
        while (pos < len && str[pos] !== 'e') pos++;
        if (pos === start || pos >= len) throw new Error('Invalid format');
        const value = parseInt(str.substring(start, pos), 10);
        pos++; // skip 'e'
        return value;
    }

    function decode_list() {
        pos++; // skip 'l'
        const list = [];
        while (pos < len && str[pos] !== 'e') {
            list.push(decode_value());
        }
        if (pos >= len) throw new Error('Invalid format');
        pos++; // skip 'e'
        return list;
    }

    function decode_dict() {
        pos++; // skip 'd'
        const dict = {};
        while (pos < len && str[pos] !== 'e') {
            const key = decode_string();
            const value = decode_value();
            dict[key] = value;
        }
        if (pos >= len) throw new Error('Invalid format');
        pos++; // skip 'e'
        return dict;
    }

    try {
        return decode_value();
    } catch (e) {
        return null;
    }
}

// ---- Bencode 编码（与 t2m 完全一致） ----
function Bencode_encode(value) {
    const t = typeof value;
    if (t === 'number') return 'i' + Math.floor(value) + 'e';
    if (t === 'string') return '' + value.length + ':' + value;
    if (Array.isArray(value)) {
        let str = 'l';
        for (let i = 0; i < value.length; i++) {
            str += Bencode_encode(value[i]);
        }
        str += 'e';
        return str;
    }
    // Dict: 键按字典序排序
    let str = 'd';
    const keys = Object.keys(value).sort();
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        str += '' + key.length + ':' + key;
        str += Bencode_encode(value[key]);
    }
    str += 'e';
    return str;
}

// ---- Base32 编码（与 t2m 完全一致） ----
function Base32_encode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const pad_lengths = [0, 1, 3, 4, 6];
    const pad_char = '=';

    let len = str.length;
    let str_new = '';
    let i = 0;

    // Null pad
    while ((str.length % 5) !== 0) str += '\x00';

    while (i < len) {
        const c1 = str.charCodeAt(i++);
        const c2 = str.charCodeAt(i++);
        const c3 = str.charCodeAt(i++);
        const c4 = str.charCodeAt(i++);
        const c5 = str.charCodeAt(i++);

        str_new += alphabet[(c1 >> 3)];
        str_new += alphabet[((c1 & 0x07) << 2) | (c2 >> 6)];
        str_new += alphabet[((c2 & 0x3F) >> 1)];
        str_new += alphabet[((c2 & 0x01) << 4) | (c3 >> 4)];
        str_new += alphabet[((c3 & 0x0F) << 1) | (c4 >> 7)];
        str_new += alphabet[((c4 & 0x7F) >> 2)];
        str_new += alphabet[((c4 & 0x03) << 3) | (c5 >> 5)];
        str_new += alphabet[(c5 & 0x1F)];
    }

    // Padding
    if (i > len) {
        const pad_count = pad_lengths[i - len];
        str_new = str_new.substring(0, str_new.length - pad_count);
        while ((str_new.length % 8) !== 0) str_new += pad_char;
    }

    return str_new;
}

// ---- 将二进制 Uint8Array 转为二进制字符串 ----
function binaryArrayToString(arr) {
    let str = '';
    for (let i = 0; i < arr.length; i++) {
        str += String.fromCharCode(arr[i]);
    }
    return str;
}

// ---- SHA1 计算 ----
async function sha1Digest(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    return new Uint8Array(hashBuffer);
}

// ---- 生成磁力链接 ----
async function generateMagnetFromTorrent(torrentData) {
    // 1. 将 Uint8Array 转为字符串（Bencode 解码需要字符串）
    let dataStr = '';
    for (let i = 0; i < torrentData.length; i++) {
        dataStr += String.fromCharCode(torrentData[i]);
    }

    // 2. Bencode 解码
    const decoded = Bencode_decode(dataStr);
    if (!decoded) throw new Error('解码失败');

    // 3. 提取 info 字典
    const info = decoded.info;
    if (!info) throw new Error('未找到 info 字典');

    // 4. Bencode 编码 info（键已自动排序）
    const infoBencoded = Bencode_encode(info);

    // 5. 将编码后的字符串转为 Uint8Array
    const infoBytes = new Uint8Array(infoBencoded.length);
    for (let i = 0; i < infoBencoded.length; i++) {
        infoBytes[i] = infoBencoded.charCodeAt(i);
    }

    // 6. SHA1 计算
    const hash = await sha1Digest(infoBytes);

    // 7. 转为二进制字符串
    const hashStr = binaryArrayToString(hash);

    // 8. Base32 编码
    const infoHash = Base32_encode(hashStr);

    // 9. 提取 name 和 announce
    let name = '';
    let announce = '';
    try {
        if (info.name) name = info.name;
        if (decoded.announce) announce = decoded.announce;
        if (decoded['announce-list'] && Array.isArray(decoded['announce-list']) && decoded['announce-list'].length > 0) {
            const first = decoded['announce-list'][0];
            if (Array.isArray(first) && first[0]) announce = first[0];
        }
    } catch (e) {}

    // 10. 组装 Magnet
    let magnet = `magnet:?xt=urn:btih:${infoHash}`;
    if (name) magnet += `&dn=${encodeURIComponent(name)}`;
    if (announce) magnet += `&tr=${encodeURIComponent(announce)}`;
    return magnet;
}

// ================================================================
// 下载监听
// ================================================================

const pendingDownloads = new Map();

chrome.downloads.onCreated.addListener((downloadItem) => {
    pendingDownloads.set(downloadItem.id, {
        id: downloadItem.id,
        url: downloadItem.url,
        filename: downloadItem.filename || '',
        referrer: downloadItem.referrer || ''
    });
});

chrome.downloads.onChanged.addListener((delta) => {
    const id = delta.id;
    
    if (delta.filename && delta.filename.current) {
        const currentFilename = delta.filename.current;
        if (pendingDownloads.has(id)) {
            const item = pendingDownloads.get(id);
            item.filename = currentFilename;
            pendingDownloads.set(id, item);
            if (currentFilename.toLowerCase().endsWith('.torrent')) {
                console.log('[Torrent] 检测到 torrent 文件名:', currentFilename);
            }
        }
    }
    
    if (delta.state && delta.state.current === 'complete') {
        if (pendingDownloads.has(id)) {
            const item = pendingDownloads.get(id);
            pendingDownloads.delete(id);
            if (item.filename && item.filename.toLowerCase().endsWith('.torrent')) {
                chrome.storage.local.get('autoAnalyzeTorrent', (result) => {
                    const auto = result.autoAnalyzeTorrent !== false;
                    if (auto) {
                        console.log('[Torrent] 下载完成，开始处理:', item.filename);
                        handleTorrentDownload(item);
                    } else {
                        console.log('[Torrent] autoAnalyzeTorrent 已关闭，跳过处理');
                    }
                });
            }
        }
    }
});

async function handleTorrentDownload(downloadItem) {
    console.log('[Torrent] 处理下载:', downloadItem.filename);
    try {
        // 获取目标域名的 Cookie
        let cookieString = '';
        try {
            const urlObj = new URL(downloadItem.url);
            const domain = urlObj.hostname;
            const cookies = await new Promise((resolve) => {
                chrome.cookies.getAll({ domain: domain }, (cookies) => {
                    if (chrome.runtime.lastError) {
                        resolve([]);
                        return;
                    }
                    resolve(cookies);
                });
            });
            cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            console.log('[Torrent] 获取到 Cookie:', cookieString);
        } catch (err) {
            console.warn('[Torrent] 获取Cookie失败，继续请求:', err.message);
        }

        const referer = downloadItem.referrer || 'https://' + new URL(downloadItem.url).hostname + '/';
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'application/octet-stream, application/x-bittorrent, */*',
            'Referer': referer,
            'Origin': new URL(downloadItem.url).origin,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        };
        if (cookieString) {
            headers['Cookie'] = cookieString;
        }

        console.log('[Torrent] 请求 URL:', downloadItem.url);
        console.log('[Torrent] 请求头:', headers);

        const response = await fetch(downloadItem.url, {
            mode: 'cors',
            credentials: 'include',
            headers: headers,
        });
        if (!response.ok) throw new Error(`下载失败: ${response.status} ${response.statusText}`);
        
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
            const text = await response.text();
            console.error('[Torrent] 服务器返回文本内容，可能不是有效 torrent:', text.slice(0, 200));
            throw new Error('服务器返回了非 torrent 内容 (可能是错误页面或重定向)');
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        if (data.length === 0) throw new Error('文件为空');
        if (data[0] !== 100) {
            console.error('[Torrent] 文件头不是 d，前20字节:', Array.from(data.slice(0, 20)).map(b => String.fromCharCode(b)).join(''));
            throw new Error('无效的 torrent 文件 (头不是 d)');
        }
        
        const magnet = await generateMagnetFromTorrent(data);
        console.log('[Torrent] 生成的磁力链接:', magnet);

        // ===== 触发预览 =====
        await showMagnetPreviewFallback(referer, magnet);
    } catch (e) {
        console.warn('[Torrent] 处理失败:', e.message);
    }
}

async function tryShowMagnetPreviewOnTab(tabId, magnet) {
    if (!tabId) return false;
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_MAGNET_PREVIEW',
            magnet: magnet
        });
        console.log('[Torrent] ✅ 预览消息已发送到 tab:', tabId);
        return true;
    } catch (sendError) {
        console.warn('[Torrent] 消息发送失败，尝试注入脚本:', sendError.message);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['magnet-detector.js']
            });
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (magnet) => {
                    if (window.__magnetHelperShowPreviewModal) {
                        window.__magnetHelperShowPreviewModal(magnet);
                    } else if (window.showPreviewModal) {
                        window.showPreviewModal(magnet);
                    } else {
                        console.warn('[预览] 未找到 showPreviewModal');
                    }
                },
                args: [magnet]
            });
            console.log('[Torrent] ✅ 预览脚本注入成功到 tab:', tabId);
            return true;
        } catch (scriptError) {
            console.warn('[Torrent] 脚本注入失败:', scriptError.message);
            return false;
        }
    }
}

async function showMagnetPreviewFallback(refererUrl, magnet) {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length > 0 && await tryShowMagnetPreviewOnTab(activeTabs[0].id, magnet)) {
        return;
    }

    let targetUrl = '';
    if (refererUrl) {
        try {
            const ref = new URL(refererUrl);
            targetUrl = ref.href;
        } catch {}
    }

    if (targetUrl) {
        try {
            const allTabs = await chrome.tabs.query({});
            const matchingTab = allTabs.find(tab => tab.url && new URL(tab.url).hostname === new URL(targetUrl).hostname);
            if (matchingTab?.id && await tryShowMagnetPreviewOnTab(matchingTab.id, magnet)) {
                return;
            }
        } catch {}
    }

    const fallbackUrl = targetUrl || 'https://ericvlog.github.io/MagnetManager/';
    try {
        const newTab = await chrome.tabs.create({ url: fallbackUrl, active: true });
        await new Promise(resolve => setTimeout(resolve, 1500));
        await tryShowMagnetPreviewOnTab(newTab.id, magnet);
    } catch (err) {
        console.warn('[Torrent] 打开目标页面失败:', err.message);
    }
}

// ================================================================
// 消息处理
// ================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[后台] 收到消息:', request.action);

    // 登录
    if (request.action === 'loginPikPak') {
        (async () => {
            try {
                await loginWithPassword(request.username, request.password);
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // 退出登录
    if (request.action === 'logoutPikPak') {
        (async () => {
            await chrome.storage.local.remove([
                'pikpakToken', 'refreshToken', 'captchaToken',
                'deviceId', 'tokenCapturedAt', 'tokenValid', 'expires_at',
                'pikpakUsername', 'pikpakPassword'
            ]);
            sendResponse({ success: true });
        })();
        return true;
    }

    // 手动刷新 Token
    if (request.action === 'refreshToken') {
        (async () => {
            try {
                const result = await refreshTokenIfNeeded(true);
                sendResponse({ success: result });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ping
    if (request.action === 'ping') {
        sendResponse({ status: 'ok' });
        return true;
    }

    // tokenUpdated
    if (request.action === 'tokenUpdated') {
        sendResponse({ success: true });
        return true;
    }

    // 获取存储的 Token 信息
    if (request.action === 'getStoredTokenInfo') {
        (async () => {
            const stored = await getPikPakTokenFromStorage();
            sendResponse({
                success: true,
                token: stored.token,
                refreshToken: stored.refreshToken,
                captchaToken: stored.captchaToken,
                deviceId: stored.deviceId,
                capturedAt: stored.tokenCapturedAt || null,
                valid: stored.tokenValid !== false
            });
        })();
        return true;
    }

    // 待导入队列
    if (request.action === 'getPendingMagnets') {
        (async () => {
            try {
                const result = await chrome.storage.local.get(['pendingMagnets']);
                const pending = result.pendingMagnets || [];
                sendResponse({ success: true, data: pending.slice(-10), total: pending.length });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'clearPendingMagnets') {
        (async () => {
            try {
                await chrome.storage.local.remove('pendingMagnets');
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'saveMagnet') {
        (async () => {
            try {
                const { magnet, title, size, imageUrl } = request;
                if (!magnet) throw new Error('磁力链接不能为空');
                const result = await chrome.storage.local.get(['pendingMagnets']);
                const pending = result.pendingMagnets || [];
                if (pending.some(item => item.magnet === magnet)) {
                    throw new Error('该磁力已在待保存队列中');
                }
                pending.push({
                    magnet,
                    title: title || '未知标题',
                    size: size || '',
                    imageUrl: imageUrl || '',
                    timestamp: Date.now()
                });
                while (pending.length > 50) pending.shift();
                await chrome.storage.local.set({ pendingMagnets: pending });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ===== 失败预览管理 =====
    if (request.action === 'saveFailedMagnet') {
        (async () => {
            try {
                const { magnet, title } = request;
                if (!magnet) throw new Error('磁力链接不能为空');
                const result = await chrome.storage.local.get(['failedMagnets']);
                const list = result.failedMagnets || [];
                if (list.some(item => item.magnet === magnet)) {
                    sendResponse({ success: true, alreadyExists: true });
                    return;
                }
                list.push({
                    magnet,
                    title: title || '未知资源',
                    timestamp: Date.now()
                });
                while (list.length > 50) list.shift();
                await chrome.storage.local.set({ failedMagnets: list });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'getFailedMagnets') {
        (async () => {
            try {
                const result = await chrome.storage.local.get(['failedMagnets']);
                const list = result.failedMagnets || [];
                const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                sendResponse({ success: true, data: sorted.slice(0, 50), total: list.length });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'removeFailedMagnet') {
        (async () => {
            try {
                const { magnet } = request;
                if (!magnet) throw new Error('磁力链接不能为空');
                const result = await chrome.storage.local.get(['failedMagnets']);
                const list = result.failedMagnets || [];
                const newList = list.filter(item => item.magnet !== magnet);
                await chrome.storage.local.set({ failedMagnets: newList });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'clearFailedMagnets') {
        (async () => {
            try {
                await chrome.storage.local.remove('failedMagnets');
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ===== 持久化预览缓存 =====
    if (request.action === 'getPreviewedMagnets') {
        (async () => {
            try {
                const result = await chrome.storage.local.get(['previewedMagnets']);
                const list = result.previewedMagnets || [];
                sendResponse({ success: true, data: list });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'addPreviewedMagnet') {
        (async () => {
            try {
                const { magnet } = request;
                if (!magnet) throw new Error('磁力链接不能为空');
                const result = await chrome.storage.local.get(['previewedMagnets']);
                const list = result.previewedMagnets || [];
                if (!list.includes(magnet)) {
                    list.push(magnet);
                    await chrome.storage.local.set({ previewedMagnets: list });
                }
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ===== 文件夹树（通过扩展直接请求，无需 CORS 代理） =====
    if (request.action === 'fetchFolderTree') {
        (async () => {
            try {
                const tree = await ppFetchAllFoldersBg();
                sendResponse({ success: true, data: tree });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'fetchFolderChildren') {
        const parentId = request.parentId || '';
        (async () => {
            try {
                const children = await ppFetchDirectChildrenBg(parentId);
                sendResponse({ success: true, data: children });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === 'createFolder') {
        (async () => {
            try {
                const result = await ppCreateFolderBg(request.name, request.parentId);
                sendResponse({ success: true, data: result });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ===== 磁力预览 =====
    if (request.action === 'magnetPreview') {
        const magnet = request.magnet;
        (async () => {
            try {
                const url = `https://whatslink.info/api/v1/link?url=${encodeURIComponent(magnet)}`;
                const controller = new AbortController();
                const t1 = setTimeout(() => controller.abort(), 8000);
                let response;
                try {
                    response = await fetch(url, {
                        signal: controller.signal,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        },
                        cache: 'no-cache'
                    });
                } finally { clearTimeout(t1); }
                if (response.status === 429) {
                    throw new Error('预览服务繁忙 (429)');
                }
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                sendResponse({ success: true, data: data });
            } catch (error) {
                console.log('[预览] 直连失败，尝试代理回退:', error.message);
                try {
                    const stored = await chrome.storage.local.get('pp_cors_proxy');
                    const proxyBase = stored.pp_cors_proxy;
                    if (proxyBase) {
                        const proxyUrl = proxyBase + encodeURIComponent(`https://whatslink.info/api/v1/link?url=${encodeURIComponent(magnet)}`);
                        const c2 = new AbortController();
                        const t2 = setTimeout(() => c2.abort(), 8000);
                        let proxyResp;
                        try {
                            proxyResp = await fetch(proxyUrl, { signal: c2.signal });
                        } finally { clearTimeout(t2); }
                        if (proxyResp.ok) {
                            const proxyData = await proxyResp.json();
                            sendResponse({ success: true, data: proxyData });
                            return;
                        }
                        throw new Error(`代理返回 HTTP ${proxyResp.status}`);
                    }
                    throw new Error('未配置代理地址');
                } catch (proxyErr) {
                    sendResponse({ success: false, error: error.message + ' (代理回退: ' + proxyErr.message + ')' });
                }
            }
        })();
        return true;
    }

    // ===== 解析 Torrent URL（供 content 调用） =====
    if (request.action === 'parseTorrentUrl') {
        const url = request.url;
        (async () => {
            try {
                const response = await fetch(url, { mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);
                const magnet = await generateMagnetFromTorrent(data);
                sendResponse({ success: true, magnet });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ===== 图片下载（增强版：自动白名单 + Cookie + 多代理） =====
    if (request.action === 'downloadImage') {
        const url = request.url;
        const referer = request.referer || '';
        console.log('[后台] 收到下载请求:', url, 'Referer:', referer);

        (async function() {
            let responseSent = false;
            const safeSendResponse = (response) => {
                if (!responseSent) {
                    responseSent = true;
                    sendResponse(response);
                }
            };

            try {
                // 1. 自动添加白名单
                let whitelist = await getWhitelist();
                const urlObj = new URL(url);
                const hostname = urlObj.hostname;
                if (!isUrlWhitelisted(url, whitelist)) {
                    console.warn('[后台] 域名不在白名单，自动添加:', hostname);
                    whitelist.push(hostname);
                    await chrome.storage.sync.set({ whitelist });
                    whitelist = await getWhitelist();
                }

                // 2. 获取目标域名的 Cookie
                let cookieString = '';
                try {
                    const cookies = await new Promise((resolve) => {
                        chrome.cookies.getAll({ domain: hostname }, (cookies) => {
                            if (chrome.runtime.lastError) {
                                resolve([]);
                                return;
                            }
                            resolve(cookies);
                        });
                    });
                    cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    console.log('[后台] 获取到的Cookie:', cookieString);
                } catch (err) {
                    console.warn('[后台] 获取Cookie失败，继续请求:', err.message);
                }

                // 3. 构造请求头（模拟真实浏览器）
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Referer': referer || urlObj.origin + '/',
                    'Origin': urlObj.origin,
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Dest': 'image',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                };
                if (cookieString) {
                    headers['Cookie'] = cookieString;
                }

                // 4. 第一次请求
                let response = await fetch(url, {
                    mode: 'cors',
                    credentials: 'include',
                    headers: headers,
                });

                let contentType = response.headers.get('content-type') || '';

                // 5. 如果返回 HTML 或 JSON（说明被 CORS 拦截），尝试多代理
                if (contentType.includes('text/html') || contentType.includes('application/json')) {
                    console.warn('[后台] 返回非图片内容 (' + contentType + ')，尝试通过代理');

                    if (contentType.includes('application/json')) {
                        try {
                            const json = await response.clone().json();
                            const errMsg = json.error || json.message || '图片链接无效';
                            console.warn('[后台] 图片服务器返回错误:', errMsg);
                        } catch (e) {}
                    }

                    const proxyUrls = [
                        `https://corsproxy.io/?${encodeURIComponent(url)}`,
                        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
                    ];

                    const simpleHeaders = {
                        'User-Agent': headers['User-Agent'],
                        'Accept': headers['Accept'],
                        'Referer': headers['Referer'],
                    };
                    if (cookieString) {
                        simpleHeaders['Cookie'] = cookieString;
                    }

                    let proxySuccess = false;
                    for (const proxyUrl of proxyUrls) {
                        try {
                            const proxyResp = await fetch(proxyUrl, {
                                mode: 'cors',
                                credentials: 'omit',
                                headers: simpleHeaders,
                            });
                            const proxyContentType = proxyResp.headers.get('content-type') || '';
                            if (proxyContentType.startsWith('image/') && proxyResp.ok) {
                                response = proxyResp;
                                contentType = proxyContentType;
                                proxySuccess = true;
                                console.log('[后台] 代理下载成功:', proxyUrl.split('?')[0]);
                                break;
                            }
                        } catch (e) {
                            console.warn('[后台] 代理失败:', proxyUrl, e.message);
                        }
                    }

                    // 如果所有代理都失败，最后尝试裸请求
                    if (!proxySuccess) {
                        console.warn('[后台] 所有代理失败，尝试裸请求');
                        response = await fetch(url, {
                            mode: 'cors',
                            credentials: 'omit',
                        });
                        contentType = response.headers.get('content-type') || '';
                    }
                }

                // 6. 最终校验
                if (!contentType.startsWith('image/')) {
                    throw new Error(`服务器返回非图片内容 (${contentType})，请检查链接是否有效`);
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const base64 = arrayBufferToBase64(arrayBuffer);
                console.log('[后台] 下载成功，大小:', arrayBuffer.byteLength);
                safeSendResponse({ success: true, data: base64, contentType });
            } catch (error) {
                console.error('[后台] 下载失败:', error.message);
                safeSendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    // ===== PikPak 离线 =====
    if (request.action === 'pikpakOffline') {
        const magnetLink = request.magnet;
        (async () => {
            let responseSent = false;
            const safeSend = (resp) => { if (!responseSent) { responseSent = true; sendResponse(resp); } };
            async function performRequest(retryCount = 0) {
                const stored = await getPikPakTokenFromStorage();
                if (!stored.token) {
                    if (stored.username && stored.password) {
                        await loginWithPassword(stored.username, stored.password);
                        const newStored = await getPikPakTokenFromStorage();
                        if (!newStored.token) throw new Error('自动登录后仍未获取到 Token');
                    } else {
                        throw new Error('未登录 PikPak，请先在选项页登录');
                    }
                }
                const currentStored = await getPikPakTokenFromStorage();
                const payload = {
                    kind: "drive#file",
                    upload_type: "UPLOAD_TYPE_URL",
                    url: { "url": magnetLink },
                    params: { from: 'manual', with_thumbnail: 'true' }
                };
                if (request.parentId) {
                    payload.parent_id = request.parentId;
                } else {
                    payload.folder_type = 'DOWNLOAD';
                }
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': currentStored.token,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                };
                if (currentStored.captchaToken) headers['x-captcha-token'] = currentStored.captchaToken;

                const response = await fetch('https://api-drive.mypikpak.com/drive/v1/files', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                if (response.status === 401 || response.status === 403) {
                    if (retryCount === 0) {
                        console.warn('[扩展] Token 无效，尝试刷新...');
                        try {
                            const refreshed = await refreshTokenIfNeeded(true);
                            if (refreshed) return performRequest(retryCount + 1);
                            else throw new Error('Token 刷新失败');
                        } catch (refreshErr) {
                            throw refreshErr;
                        }
                    } else {
                        await chrome.storage.local.set({ tokenValid: false });
                        throw new Error('Token 已过期，请重新登录');
                    }
                }
                const data = await response.json();
                if (!response.ok) throw new Error(data.error_description || `HTTP ${response.status}`);
                await chrome.storage.local.set({ tokenValid: true });
                return data;
            }
            try {
                const data = await performRequest();
                safeSend({ success: true, data: data });
            } catch (error) {
                safeSend({ success: false, error: error.message });
            }
        })();
        return true;
    }

    console.warn('[后台] 未知操作:', request.action);
    sendResponse({ success: false, error: '未知操作' });
    return false;
});

// ===== 文件夹树工具（直接在扩展上下文请求 PikPak API） =====

/** 缓存 token 避免遍历时反复读存储 */
let _ppBgTokenCache = null;
async function ppEnsureBgToken(forceRefresh = false) {
    if (!forceRefresh && _ppBgTokenCache) return _ppBgTokenCache;
    const stored = await getPikPakTokenFromStorage();
    if (stored.token) { _ppBgTokenCache = stored; return stored; }
    if (stored.username && stored.password) {
        await loginWithPassword(stored.username, stored.password);
        const newStored = await getPikPakTokenFromStorage();
        if (newStored.token) { _ppBgTokenCache = newStored; return newStored; }
        throw new Error('自动登录后仍未获取到 Token');
    }
    throw new Error('未登录 PikPak，请先在扩展选项页登录');
}

async function ppApiFetchBg(url, options = {}, retryCount = 0) {
    const stored = await ppEnsureBgToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': stored.token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (stored.captchaToken) headers['x-captcha-token'] = stored.captchaToken;
    if (options.headers) Object.assign(headers, options.headers);

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
        if (retryCount === 0) {
            console.warn('[扩展] 文件夹请求 Token 无效，尝试刷新...');
            _ppBgTokenCache = null; // 清除缓存确保读到新 token
            const refreshed = await refreshTokenIfNeeded(true);
            if (refreshed) return ppApiFetchBg(url, options, retryCount + 1);
            throw new Error('Token 刷新失败');
        } else {
            await chrome.storage.local.set({ tokenValid: false });
            throw new Error('Token 已过期，请重新登录');
        }
    }
    return response;
}

async function ppFetchFolderChildrenBg(parentId = '', depth = 0, maxPages = 3) {
    if (depth > 2) return [];
    let all = [];
    let pageToken = null;
    let pageCount = 0;
    do {
        if (++pageCount > maxPages) {
            console.warn('[扩展] 分页超过上限', maxPages, '，停止');
            break;
        }
        let url = `https://api-drive.mypikpak.com/drive/v1/files?page_size=200`;
        if (parentId) url += `&parent_id=${encodeURIComponent(parentId)}`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;

        const resp = await ppApiFetchBg(url);
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${txt.substring(0,200)}`);
        }
        const data = await resp.json();
        const folders = (data.files || []).filter(f => f.kind === 'drive#folder' && !f.trashed);
        for (const f of folders) {
            const children = await ppFetchFolderChildrenBg(f.id, depth + 1);
            all.push({ id: f.id, name: f.name, parentId: parentId || '', children, depth });
        }
        pageToken = data.next_page_token || null;
    } while (pageToken);
    return all;
}

async function ppFetchAllFoldersBg() {
    const tree = await ppFetchFolderChildrenBg('');
    const flat = [];
    function flatten(items, d = 0) {
        for (const item of items) {
            flat.push({ id: item.id, name: item.name, parentId: item.parentId, depth: d });
            flatten(item.children, d + 1);
        }
    }
    flatten(tree);
    return flat;
}

/** 非递归：只获取指定 parentId 的直接子文件夹（用于按需加载） */
async function ppFetchDirectChildrenBg(parentId = '', maxPages = 3) {
    let all = [];
    let pageToken = null;
    let pageCount = 0;
    do {
        if (++pageCount > maxPages) break;
        let url = `https://api-drive.mypikpak.com/drive/v1/files?page_size=200`;
        if (parentId) url += `&parent_id=${encodeURIComponent(parentId)}`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        const resp = await ppApiFetchBg(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const folders = (data.files || []).filter(f => f.kind === 'drive#folder' && !f.trashed);
        for (const f of folders) all.push({ id: f.id, name: f.name, children: [], parentId: parentId || '' });
        pageToken = data.next_page_token || null;
    } while (pageToken);
    return all;
}

async function ppCreateFolderBg(name, parentId = '') {
    const payload = { kind: 'drive#folder', name };
    if (parentId) payload.parent_id = parentId;
    const resp = await ppApiFetchBg('https://api-drive.mypikpak.com/drive/v1/files', {
        method: 'POST', body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error_description || `HTTP ${resp.status}`);
    return data;
}

// ===== 工具函数 =====
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

console.log('[图片助手] 已使用内部登录模式启动');