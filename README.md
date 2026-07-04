# PikPak 磁力管理器

一站式磁力管理：预览 → 保存 → 离线下载到 PikPak，支持标签、评分、图片、云备份。

---

## 快速开始

### 方案 A：GitHub Pages + 自建 Vercel 代理（推荐）

1. Fork 本仓库
2. **[一键部署 Vercel 代理](https://vercel.com/new/clone?repository-url=https://github.com/ericvlog/Pikpak-Magnet-Collection)** → 获得地址 `https://你的项目名.vercel.app`
3. **GitHub Pages**：进入仓库 **Settings → Pages** → Source 选 **GitHub Actions** → 等待部署
4. 访问 `https://你的用户名.github.io/Pikpak-Magnet-Collection`
5. 点 **PikPak 登录** → 底部填入 `https://你的项目名.vercel.app/api/proxy?url=` → 保存 → 测试连通 → 登录

### 方案 B：本地运行（最简单）

```bash
node proxy/server.js
# 浏览器打开 http://localhost:3000
```

无需配置代理，同源访问。

### 方案 C：GitHub Pages + 本地隧道

1. GitHub Pages 部署同上
2. 双击 `proxy/start-server.bat` → 终端输出 Cloudflare Tunnel 地址 `https://xxxx.trycloudflare.com`
3. 在 PikPak 登录弹窗填入 `https://xxxx.trycloudflare.com/?url=` → 保存 → 测试连通 → 登录

---

## 可选：安装浏览器扩展

1. 打开 `chrome://extensions` → 开启**开发者模式**
2. **加载已解压的扩展程序** → 选择 `extension/` 目录
3. 扩展自动桥接 PikPak API，无需配置 CORS 代理；还支持磁力嗅探、图片代理下载

---

## 目录结构

```
api/proxy/index.js     ← Vercel CORS 代理
extension/             ← Chrome 扩展
page/index.html        ← 主页面（GitHub Pages 入口）
proxy/
  server.js            ← 本地 Node.js 代理
  start-server.bat     ← Windows 一键启动（含 Cloudflare Tunnel）
```

---

## 功能一览

磁力管理（添加/编辑/删除/标签/评分/预览）、批量操作（标签/复制/保存图片/离线/删除）、离线到 PikPak（单条或批量选文件夹）、完整备份（ZIP + JSON + Google Drive）、429 失败重试、剪贴板检测、暗色模式。
