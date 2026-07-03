// pikpak-token.js - 在 PikPak 页面捕获 Token 并存储到扩展
console.log('[PikPak Token] Content script 已注入');

(function captureToken() {
    try {
        let token = '';
        let refreshToken = '';
        let expiresIn = 0;
        let captchaToken = '';
        let deviceId = '';
        let tokenType = 'Bearer';

        // 1. 从 localStorage 中查找 credentials 开头的键
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('credentials')) {
                try {
                    const cred = JSON.parse(localStorage.getItem(key));
                    if (cred && cred.access_token) {
                        tokenType = cred.token_type || 'Bearer';
                        token = tokenType + ' ' + cred.access_token;
                        refreshToken = cred.refresh_token || '';
                        expiresIn = cred.expires_in || 7200;
                        console.log('[PikPak Token] 成功解析 credentials');
                        console.log('[PikPak Token] refresh_token 长度:', refreshToken.length);
                        break;
                    }
                } catch (e) {
                    console.warn('[PikPak Token] 解析 credentials 失败:', e);
                }
            }
        }

        // 2. 如果上面没找到，尝试直接从 localStorage 读取 refresh_token（兜底）
        if (!refreshToken) {
            const rawRefresh = localStorage.getItem('refresh_token');
            if (rawRefresh) {
                refreshToken = rawRefresh;
                console.log('[PikPak Token] 从 refresh_token 键直接读取到 token');
            }
        }

        // 3. 获取 captcha_token（可选）
        let raw = localStorage.getItem('pk_captured_captcha');
        if (raw) {
            try {
                const obj = JSON.parse(raw);
                captchaToken = obj.captcha_token || obj.token || raw;
            } catch(e) {
                captchaToken = raw;
            }
        }
        if (!captchaToken) {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.toLowerCase().includes('captcha')) {
                    try {
                        const val = localStorage.getItem(key);
                        const obj = JSON.parse(val);
                        if (obj && obj.captcha_token) {
                            captchaToken = obj.captcha_token;
                            break;
                        }
                    } catch(e) {}
                }
            }
        }

        // 4. deviceId
        deviceId = localStorage.getItem('deviceid') || '';

        // 5. 如果获取到 token，保存到 chrome.storage.local（格式与内部登录一致）
        if (token) {
            const expiresAt = Date.now() + expiresIn * 1000;
            const dataToStore = {
                pikpakToken: token,
                refreshToken: refreshToken,
                expires_at: expiresAt,
                captchaToken: captchaToken || '',
                deviceId: deviceId,
                tokenCapturedAt: Date.now(),
                tokenValid: true
            };

            console.log('[PikPak Token] 准备存储的数据:');
            console.log('  - pikpakToken:', token.substring(0, 30) + '...');
            console.log('  - refreshToken:', refreshToken ? refreshToken.substring(0, 20) + '... (长度 ' + refreshToken.length + ')' : '❌ 未获取到');
            console.log('  - expires_at:', new Date(expiresAt).toLocaleString());
            console.log('  - deviceId:', deviceId || '未获取');

            chrome.storage.local.set(dataToStore, () => {
                if (chrome.runtime.lastError) {
                    console.warn('[PikPak Token] 存储失败:', chrome.runtime.lastError.message);
                } else {
                    console.log('[PikPak Token] ✅ 已保存到扩展存储');
                    chrome.runtime.sendMessage({ 
                        action: 'tokenUpdated',
                        data: {
                            hasRefreshToken: !!refreshToken,
                            refreshTokenLength: refreshToken.length
                        }
                    }).catch(() => {});
                }
            });
        } else {
            console.warn('[PikPak Token] ❌ 未找到有效的 Token，请确保已登录 PikPak');
        }
    } catch (err) {
        console.error('[PikPak Token] 捕获失败:', err);
    }
})();