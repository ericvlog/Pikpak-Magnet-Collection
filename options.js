console.log('options.js 已加载（扩展内部登录模式）');

document.addEventListener('DOMContentLoaded', () => {
    console.log('[选项页] DOM 已加载');

    // ===== DOM 元素 =====
    const listDiv = document.getElementById('domainList');
    const newDomainInput = document.getElementById('newDomain');
    const addBtn = document.getElementById('addBtn');
    const pendingList = document.getElementById('pendingList');
    const refreshPendingBtn = document.getElementById('refreshPendingBtn');
    const clearPendingBtn = document.getElementById('clearPendingBtn');
    const importAllBtn = document.getElementById('importAllBtn');
    const pendingStatus = document.getElementById('pendingStatus');
    const tokenInfoContent = document.getElementById('tokenInfoContent');
    const tokenStatus = document.getElementById('tokenStatus');
    const refreshTokenBtn = document.getElementById('refreshTokenBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const emergencyClearBtn = document.getElementById('emergencyClearBtn');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const logoutPikPakBtn = document.getElementById('logoutBtn');
    const loginStatus = document.getElementById('loginStatus');

    // ===== 1. 登录状态加载 =====
    async function loadLoginStatus() {
        try {
            const result = await new Promise(resolve => chrome.storage.local.get('pikpakUsername', resolve));
            const username = result.pikpakUsername || '';
            if (username) {
                loginUsername.value = username;
                loginPassword.value = '';
                loginStatus.textContent = `✅ 已登录：${username}`;
                loginStatus.style.color = '#28a745';
            } else {
                loginUsername.value = '';
                loginPassword.value = '';
                loginStatus.textContent = '未登录';
                loginStatus.style.color = '#6c757d';
            }
        } catch (err) {
            console.warn('[选项页] 加载登录状态失败:', err);
        }
    }

    // ===== 2. 登录功能 =====
    async function loginPikPak() {
        const username = loginUsername.value.trim();
        const password = loginPassword.value.trim();
        if (!username || !password) {
            loginStatus.textContent = '❌ 请输入账号和密码';
            loginStatus.style.color = '#dc3545';
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';
        loginStatus.textContent = '⏳ 正在登录...';
        loginStatus.style.color = '#306eff';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'loginPikPak',
                username: username,
                password: password
            });

            if (response && response.success) {
                loginStatus.textContent = `✅ 登录成功！用户：${username}`;
                loginStatus.style.color = '#28a745';
                loginUsername.value = username;
                loginPassword.value = '';
                loadTokenStatus();
                loadLoginStatus();
            } else {
                loginStatus.textContent = '❌ 登录失败: ' + (response?.error || '未知错误');
                loginStatus.style.color = '#dc3545';
            }
        } catch (err) {
            loginStatus.textContent = '❌ 登录失败: ' + err.message;
            loginStatus.style.color = '#dc3545';
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = '登录 PikPak';
        }
    }

    // ===== 3. 退出登录 =====
    async function logoutPikPak() {
        console.log('[选项页] 退出登录函数被调用');
        if (!confirm('确定退出登录吗？')) {
            console.log('[选项页] 用户取消退出');
            return;
        }

        try {
            console.log('[选项页] 发送 logoutPikPak 消息...');
            const response = await chrome.runtime.sendMessage({ action: 'logoutPikPak' });
            console.log('[选项页] 收到后台响应:', response);

            if (response && response.success) {
                loginStatus.textContent = '✅ 已退出登录';
                loginStatus.style.color = '#28a745';
                loginUsername.value = '';
                loginPassword.value = '';
                loadTokenStatus();
                loadLoginStatus();
                console.log('[选项页] 退出完成');
            } else {
                loginStatus.textContent = '❌ 退出失败: ' + (response?.error || '未知错误');
                loginStatus.style.color = '#dc3545';
            }
        } catch (err) {
            console.error('[选项页] 退出异常:', err);
            loginStatus.textContent = '❌ 退出失败: ' + err.message;
            loginStatus.style.color = '#dc3545';
        }
    }

    // ---- 绑定事件 ----
    loginBtn.addEventListener('click', loginPikPak);
    if (logoutBtn) logoutBtn.addEventListener('click', logoutPikPak);
    loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginPikPak(); });
    loginUsername.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginPikPak(); });

    // ===== 4. 白名单功能 =====
    async function loadList() {
        const result = await chrome.storage.sync.get('whitelist');
        const whitelist = result.whitelist || [];
        renderList(whitelist);
    }

    function renderList(whitelist) {
        listDiv.innerHTML = '';
        if (whitelist.length === 0) {
            listDiv.innerHTML = '<p style="color:#999;">暂无域名，请添加</p>';
            return;
        }
        whitelist.forEach((domain, index) => {
            const div = document.createElement('div');
            div.className = 'domain-item';
            const span = document.createElement('span');
            span.textContent = domain;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '移除';
            removeBtn.className = 'remove-btn';
            removeBtn.onclick = () => removeDomain(index);
            div.appendChild(span);
            div.appendChild(removeBtn);
            listDiv.appendChild(div);
        });
    }

    async function removeDomain(index) {
        const result = await chrome.storage.sync.get('whitelist');
        const whitelist = result.whitelist || [];
        if (index >= 0 && index < whitelist.length) {
            whitelist.splice(index, 1);
            await chrome.storage.sync.set({ whitelist });
            renderList(whitelist);
        }
    }

    async function addDomain() {
        const domain = newDomainInput.value.trim().toLowerCase();
        if (!domain) return;
        if (domain.includes('/') || domain.includes('http')) {
            alert('请输入纯域名，例如：imagetwist.com');
            return;
        }
        const result = await chrome.storage.sync.get('whitelist');
        const whitelist = result.whitelist || [];
        if (whitelist.includes(domain)) {
            alert('该域名已在白名单中');
            return;
        }
        whitelist.push(domain);
        await chrome.storage.sync.set({ whitelist });
        renderList(whitelist);
        newDomainInput.value = '';
    }

    addBtn.addEventListener('click', addDomain);
    newDomainInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addDomain(); });

    // ===== 5. 待导入队列 =====
    async function loadPendingMagnets() {
        try {
            console.log('[选项页] 直接读取存储');
            const result = await new Promise(resolve => chrome.storage.local.get('pendingMagnets', resolve));
            const pending = result.pendingMagnets || [];
            const total = pending.length;
            const recent = pending.slice(-10);
            renderPendingList(recent, total);
            pendingStatus.textContent = `共 ${total} 条待导入`;
        } catch (err) {
            console.error('[选项页] 加载失败:', err);
            pendingStatus.textContent = '❌ 加载失败: ' + err.message;
            pendingList.innerHTML = '<span style="color:#999;">加载失败</span>';
        }
    }

    function renderPendingList(data, total) {
        if (!data || data.length === 0) {
            pendingList.innerHTML = '<span style="color:#999;">暂无待导入的磁力</span>';
            return;
        }
        pendingList.innerHTML = data.map((item, idx) => `
            <div class="pending-item">
                <span><strong>${escapeHtml(item.title || '未知标题')}</strong></span>
                <span class="pending-magnet">${escapeHtml(item.magnet ? item.magnet.substring(0, 60) + '...' : '')}</span>
            </div>
        `).join('');
    }

    refreshPendingBtn.addEventListener('click', loadPendingMagnets);

    if (clearPendingBtn) {
        clearPendingBtn.onclick = function() {
            if (!confirm('确定清空队列？')) return;
            chrome.storage.local.remove('pendingMagnets', function() {
                pendingStatus.textContent = '✅ 已清空';
                loadPendingMagnets();
            });
        };
    }

    if (emergencyClearBtn) {
        emergencyClearBtn.onclick = function() {
            if (confirm('确定直接清除？')) {
                chrome.storage.local.remove('pendingMagnets', function() {
                    alert('已清空，页面将刷新');
                    location.reload();
                });
            }
        };
    }

    importAllBtn.addEventListener('click', async () => {
        try {
            const result = await new Promise(resolve => chrome.storage.local.get('pendingMagnets', resolve));
            const pending = result.pendingMagnets || [];
            if (pending.length === 0) {
                pendingStatus.textContent = '没有待导入的磁力';
                return;
            }
            pendingStatus.textContent = `📥 请打开磁力管理器页面 (https://ericvlog.github.io/MagnetManager/ttt.html) 自动导入`;
            window.open('https://ericvlog.github.io/MagnetManager/ttt.html', '_blank');
        } catch (err) {
            pendingStatus.textContent = '❌ 操作失败: ' + err.message;
        }
    });

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    }

    // ===== 6. Token 状态（核心函数） =====
    async function loadTokenStatus() {
        try {
            const result = await new Promise(resolve => chrome.storage.local.get([
                'pikpakToken', 'refreshToken', 'captchaToken',
                'deviceId', 'tokenCapturedAt', 'tokenValid', 'expires_at'
            ], resolve));
            
            const token = result.pikpakToken || '';
            const refreshToken = result.refreshToken || '';
            const capturedAt = result.tokenCapturedAt ? new Date(result.tokenCapturedAt).toLocaleString() : '未知';
            const now = Date.now();
            const expiresAtValue = Number(result.expires_at) || 0;
            const isValid = expiresAtValue > now;  // 只认 expires_at
            const expiresAt = expiresAtValue ? new Date(expiresAtValue).toLocaleString() : '无';

            // 更新状态标签
            tokenStatus.className = 'status-badge ' + (token ? (isValid ? 'status-ok' : 'status-expired') : 'status-unknown');
            tokenStatus.textContent = token ? (isValid ? '✅ Token 有效' : '⚠️ Token 已过期') : '❌ 未登录';

            let html = '';
            if (token) {
                const tokenDisplay = token.substring(0, 30) + (token.length > 30 ? '...' : '');
                html += `<div><span class="label">Access Token:</span> ${tokenDisplay}</div>`;
                html += `<div><span class="label">Refresh Token:</span> ${refreshToken ? '已获取 (长度 ' + refreshToken.length + ')' : '未获取'}</div>`;
                html += `<div><span class="label">过期时间:</span> ${expiresAt}</div>`;
                html += `<div><span class="label">捕获时间:</span> ${capturedAt}</div>`;
                html += `<div><span class="label">状态:</span> ${isValid ? '✅ 有效' : '⚠️ 已过期'}</div>`;
                if (!isValid) {
                    html += `<div style="margin-top:8px;color:#dc3545;">💡 点击「刷新 Token」按钮尝试自动刷新。</div>`;
                }
            } else {
                html = `<div style="color: #dc3545;">⚠️ 未找到存储的 Token，请点击「刷新 Token」获取。</div>`;
            }
            tokenInfoContent.innerHTML = html;
        } catch (err) {
            tokenInfoContent.innerHTML = `<div style="color: #dc3545;">❌ 获取失败: ${err.message}</div>`;
        }
    }

    // ===== 7. 监听存储变化，自动更新 UI =====
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            const relevantKeys = ['pikpakToken', 'refreshToken', 'captchaToken', 'deviceId', 'tokenValid', 'expires_at', 'tokenCapturedAt'];
            const hasChange = relevantKeys.some(key => changes[key]);
            if (hasChange) {
                console.log('[选项页] 🔔 检测到 Token 存储变化，自动刷新状态');
                loadTokenStatus();
            }
        }
    });

    // ===== 8. 刷新 Token 按钮（关键：立即反馈） =====
    refreshTokenBtn.addEventListener('click', async () => {
        const originalText = refreshTokenBtn.textContent;
        refreshTokenBtn.textContent = '⏳ 刷新中...';
        refreshTokenBtn.disabled = true;
        console.log('[选项页] 👆 点击刷新 Token 按钮');

        try {
            const response = await chrome.runtime.sendMessage({ action: 'refreshToken' });
            console.log('[选项页] 📨 后台响应:', response);

            if (response && response.success) {
                console.log('[选项页] ✅ 刷新成功，等待存储更新...');
                // 立即重新加载状态（存储监听也会触发，但这里主动调用确保即时）
                await loadTokenStatus();
                refreshTokenBtn.textContent = '✅ 已刷新';
                setTimeout(() => {
                    refreshTokenBtn.textContent = originalText;
                    refreshTokenBtn.disabled = false;
                }, 2000);
            } else {
                const errorMsg = response?.error || '未知错误';
                console.error('[选项页] ❌ 刷新失败:', errorMsg);
                alert('刷新失败: ' + errorMsg);
                refreshTokenBtn.textContent = originalText;
                refreshTokenBtn.disabled = false;
            }
        } catch (err) {
            console.error('[选项页] ❌ 刷新异常:', err);
            alert('刷新失败: ' + err.message);
            refreshTokenBtn.textContent = originalText;
            refreshTokenBtn.disabled = false;
        }
    });

    // ===== 9. 初始化 =====
    loadList();
    loadPendingMagnets();
    loadTokenStatus();
    loadLoginStatus();

    console.log('[选项页] 初始化完成');
});