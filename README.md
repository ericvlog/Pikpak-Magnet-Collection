# PikPak 磁力管理器

一站式磁力管理：预览 → 保存 → 离线下载到 PikPak。

---

## 快速开始

### 方案 A：装扩展 + GitHub Pages（推荐，免代理）

1. Fork 本仓库 → GitHub Pages 部署（Settings → Pages → GitHub Actions）
2. 打开 `chrome://extensions` → 开发者模式 → **加载已解压的扩展** → 选择 `extension/` 目录
3. 访问 `https://你的用户名.github.io/Pikpak-Magnet-Collection`
4. 扩展自动桥接 PikPak API，**无需配置任何代理地址**
5. 点 **PikPak 登录** → 输入账号密码 → 使用

> 扩展还支持磁力嗅探、图片代理下载、Token 自动刷新。

### 方案 B：本地运行（免代理、免扩展）

Windows 双击 `proxy/start-server.bat`，或命令行：

```bash
node proxy/server.js
# 浏览器打开 http://localhost:3000
```

同源访问，无需任何代理配置。

### 方案 C：GitHub Pages + 自建代理（无扩展）

1. Fork 本仓库
2. **[一键部署 Vercel 代理](https://vercel.com/new/clone?repository-url=https://github.com/ericvlog/Pikpak-Magnet-Collection)** → 获得 `https://你的项目名.vercel.app`
3. GitHub Pages 部署同上
4. 访问页面 → 点 **PikPak 登录** → 底部填入 `https://你的项目名.vercel.app/api/proxy?url=` → 保存 → 测试连通 → 登录

---

## 目录结构

```
extension/             ← Chrome 扩展（推荐方案）
page/index.html        ← 主页面（GitHub Pages 入口）
api/proxy/index.js     ← Vercel CORS 代理
proxy/
  server.js            ← 本地 Node.js 代理
  start-server.bat     ← Windows 一键启动（含 Cloudflare Tunnel）
```

## 功能一览

磁力管理、标签/评分、批量操作、离线到 PikPak（选文件夹）、完整备份（ZIP/JSON/Google Drive）、预览（whatslink.info）、429 重试、剪贴板检测、暗色模式。
