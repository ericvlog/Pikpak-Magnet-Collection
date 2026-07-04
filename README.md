# PikPak 磁力管理器

一站式磁力管理：预览 → 保存 → 离线下载到 PikPak，支持标签、评分、图片、云备份。

---

## 快速开始（3 分钟）

### 方案 A：GitHub Pages（推荐，无需本地）

1. Fork 本仓库 → 进入 **Settings → Pages** → Source 选 **GitHub Actions**
2. 等几分钟部署完成，访问 `https://你的用户名.github.io/Pikpak-Magnet-Collection`
3. 点 **PikPak 登录** → 输入账号密码 → 登录

> 页面自带 Vercel CORS 代理，无需额外配置。选文件夹和离线下载直接可用。

### 方案 B：本地运行

```bash
node proxy/server.js
# 浏览器打开 http://localhost:3000
```

---

## 可选：安装浏览器扩展（增强功能）

1. 打开 `chrome://extensions` → 开启**开发者模式**
2. 点击**加载已解压的扩展程序** → 选择 `extension/` 目录
3. 扩展自动注入到所有网页，支持磁力嗅探、图片代理下载、PikPak 直连（无需 CORS 代理）

---

## 可选：自建 CORS 代理

如果不用扩展，页面默认用公共 Vercel 代理（已可用）。也可以自建：

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ericvlog/Pikpak-Magnet-Collection)

部署后在 PikPak 登录弹窗填入 `https://你的项目名.vercel.app/api/proxy?url=` 并保存。

---

## 目录结构

```
api/proxy/index.js    ← Vercel CORS 代理（部署入口）
extension/            ← Chrome 扩展
page/index.html       ← 主页面（GitHub Pages 入口）
proxy/
  server.js           ← 本地 Node.js 代理
  start-server.bat    ← Windows 一键启动（含 Cloudflare Tunnel）
```

完整目录见仓库文件。

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 磁力管理 | 添加、编辑、删除，标题/标签/评分/预览图 |
| 标签系统 | 创建标签、拖拽排序、筛选、自动规则 |
| 批量操作 | 批量标签、复制链接、保存图片、离线、删除 |
| 预览 | whatslink.info 磁力截图预览（429 自动重试） |
| 离线到 PikPak | 单条或批量离线，可选目标文件夹 |
| 完整备份/恢复 | ZIP 含图片、JSON 元数据、Google Drive 云备份 |
| 剪贴板检测 | 自动检测磁力链接 |
| 暗色模式 | 白天/夜晚切换 |
