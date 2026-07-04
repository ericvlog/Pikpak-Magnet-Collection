# PikPak 磁力管理器

一站式磁力管理工具，支持磁力预览、离线下载到 PikPak、图片管理、标签分类、云备份。

---

## 组件

| 组件 | 目录 | 说明 |
|------|------|------|
| **📄 静态页面** | `page/` | 磁力管理器主界面，完整功能，可部署到 GitHub Pages 或任意静态托管 |
| **🔌 浏览器扩展** | `extension/` | 增强功能：任意网页磁力嗅探、图片代理下载、PikPak 直连（无需 CORS 代理） |
| **🌐 CORS 代理** | `api/` | Vercel Serverless，浏览器直调 PikPak API 的中转（扩展方案的备选） |
| **🖥️ 本地代理** | `proxy/` | 本地 Node.js 服务器，同时提供 API 代理和静态页面服务 |

## 流程总览

```
用户 → 部署网页 (GitHub Pages / 本地)
       ├── 安装扩展 → 扩展桥接 PikPak API（推荐，无需 CORS 代理）
       │                 │
       │          ┌──────┴──────┐
       │          │  离线下载    │  任意网页嗅探磁力
       │          │  图片代理    │  预览窗口 → 保存/离线下载
       │          │  Token刷新   │  待导入队列
       │          └─────────────┘
       │
       └── 无扩展 → 自行部署 Vercel CORS 代理
                    → 在页面配置代理地址
                    → 页面直连 PikPak API
```

## 快速开始

### 方式一：只用网页（推荐配合扩展）

1. 将 `page/index.html` 部署到 GitHub Pages 或任意静态托管
2. 安装浏览器扩展（下方 "安装扩展"）
3. 页面会自动通过扩展桥接 PikPak，无需配置任何代理
4. 登录 PikPak 即可使用离线下载

> 网页也可以不装扩展独立使用，但需要自行部署 CORS 代理（见 "部署 CORS 代理"）。

### 方式二：完整体验（网页 + 扩展 + 代理）

这是最推荐的方案，覆盖所有功能。

---

## 安装扩展

1. 打开 Chrome/Edge 扩展管理页面：`chrome://extensions`
2. 开启 **开发者模式**（右上角）
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库的 `extension/` 目录
5. 安装完成，扩展会自动注入到所有网页

### 扩展功能

| 功能 | 说明 |
|------|------|
| **磁力嗅探** | 自动扫描任意网页上的 magnet: 链接，在链接旁显示「预览」按钮 |
| **预览弹窗** | 点击「预览」弹出磁力详情（标题、截图、大小），支持保存到管理器或发送到 PikPak |
| **图片代理下载** | 绕过图片热链限制，将网页图片保存到管理器本地 |
| **PikPak 内部登录** | 直接在扩展设置页输入账号密码登录，自动管理 Token 和自动刷新 |
| **Token 捕获** | 访问 mypikpak.com 时自动捕获已登录的 Token |
| **待导入队列** | 从任意网页「保存到管理器」的磁力暂存队列，打开管理器页面时自动导入 |
| **白名单配置** | 在扩展设置页配置图片代理白名单域名 |

### 扩展设置

打开扩展设置：右键扩展图标 → **选项**，或点击 `chrome://extensions` 中扩展的 **详情 → 扩展选项**。

设置项：
- **PikPak 登录**：直接输入账号密码登录，扩展自动维护 Token
- **Token 状态**：查看当前 Token 有效性，手动刷新
- **待导入队列**：查看和管理从网页保存的磁力
- **图片白名单**：添加图片源站域名（如 `imagetwist.com`），扩展才能代理下载

---

## 部署网页（GitHub Pages）

1. Fork 本仓库
2. 进入仓库 **Settings → Pages**
3. Source 选择 **GitHub Actions** 或 **Deploy from a branch**
4. 选择 `main/master` 分支，目录选择 `/page/`
5. 保存后等待部署完成
6. 访问 `https://你的用户名.github.io/仓库名/`

也可以任意静态托管（Vercel、Netlify、Cloudflare Pages 等），只需托管 `page/index.html` 一个文件。

---

## 部署 CORS 代理

> 仅当不使用扩展时需要。扩展用户无需部署代理。

### 一键部署到 Vercel

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ericvlog/Pikpak-Magnet-Collection)

1. 点上方按钮
2. 用 GitHub 登录 Vercel
3. 仓库选择本仓库
4. 点击 **Deploy**
5. 部署完成后获得地址：`https://你的项目名.vercel.app`

### 手动部署

1. 在 [Vercel Dashboard](https://vercel.com/) 点击 **Add New → Project**
2. 导入本仓库
3. 确保 Root Directory 设置为仓库根目录（默认即可）
4. 点击 **Deploy**

### 在页面中配置

1. 打开 `page/index.html`
2. 点击 **PikPak 登录**
3. 在弹窗底部填入代理地址：`https://你的项目名.vercel.app/api/proxy?url=`
4. 点击 **保存**，待提示「代理连通 ✓」
5. 输入账号密码登录

> ✅ Vercel 代理对所有 PikPak API 可用（包括选文件夹和离线下载）。

### 本地代理

Windows 双击 `proxy/start-server.bat`，或命令行：

```bash
node proxy/server.js
```

默认监听 `http://localhost:3000`，同时提供 API 代理和页面服务。

#### 配合 GitHub Pages 使用

本地代理可跨域给 `https://你的用户名.github.io/Pikpak-Magnet-Collection/` 使用：

1. 双击 `proxy/start-server.bat` 或运行 `node proxy/server.js`
2. 打开 GitHub Pages 页面
3. 点击 **PikPak 登录** → 在弹窗底部 CORS 代理输入框填入：
   ```
   http://你电脑的局域网IP:3000/?url=
   ```
   （IP 见启动时终端打印的提示，例如 `http://192.168.1.100:3000/?url=`）
4. 保存 → 测试连通 → 登录 PikPak 即可

> 手机访问 GitHub Pages 时，手机必须和电脑在同一 WiFi。

#### 配合 GitHub Pages 使用（通过 HTTPS 隧道）

> ⚠️ 浏览器禁止 HTTPS 页面请求 HTTP 地址。GitHub Pages 是 HTTPS，本地代理是 HTTP，直接配置无效。

**方法一（推荐）：Cloudflare Tunnel（免注册，无需下载）**

双击 `proxy/start-server.bat`，脚本会自动启动本地服务器 + Cloudflare Tunnel，终端会输出类似：

```
Cloudflare Tunnel URL: https://xxxx.trycloudflare.com
```

将此地址填入页面弹窗的 CORS 代理输入框（末尾加 `/?url=`）：

```
https://xxxx.trycloudflare.com/?url=
```

保存 → 测试连通 → 登录 PikPak。

> 隧道地址每次启动都会变化，脚本启动时会自动打印在终端。`cloudflared.exe` 会在首次运行时自动下载。

**方法二：Chrome 允许不安全源（仅本机用）**

1. 打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. 添加 `http://127.0.0.1:3000` 和 `http://10.151.76.88:3000`
3. 重启浏览器
4. 在 GitHub Pages 的 PikPak 弹窗填入 `http://127.0.0.1:3000/?url=`

#### 本地直接访问（最简单）

浏览器打开 `http://localhost:3000` 即是完整页面，同源访问无需任何代理配置。数据存在本机 IndexedDB，与 GitHub Pages 隔离。

> 💡 建议日常使用 `http://localhost:3000`，只在需要从 GitHub Pages 调 PikPak API 时才用 Cloudflare Tunnel。

### Cloudflare Worker

`proxy/worker.js` 是 Cloudflare Worker 版本，可在 Cloudflare Dashboard 中创建 Worker 使用。

---

## PikPak 登录

扩展和页面各自独立维护 Token（不共享），可以都登录、互不影响。

### 扩展登录（推荐）

在扩展设置页输入账号密码 → 点「登录 PikPak」→ 扩展自动完成登录、Token 刷新。

### 页面登录

页面有两种方式调 PikPak API（按优先级）：
1. **扩展桥接**（优先）：页面通过 `postMessage` 发给扩展，扩展在后台直接调 API
2. **CORS 代理**（备选）：页面通过你部署的 CORS 代理调 API

无论哪种方式，页面登录的凭证存储在浏览器 `localStorage` 中。

---

## 使用教程

### 完整工作流：发现磁力 → 预览 → 保存

1. **发现磁力**：任意网页上点击磁力链接 → 扩展弹出「预览」按钮；或复制磁力链接 → 管理器页面自动检测剪贴板
2. **预览**：查看标题、截图、文件大小、类型
3. **编辑**：预览弹窗中**直接点击标题即可编辑**（contenteditable）
4. **操作**：选择「保存到管理器」「离线下载到 PikPak」「保存并离线」
5. **整理**：在管理器中添加标签、评分、分类

### 批量选择与操作

1. 卡片右上角勾选复选框（或直接点击卡片进入选择模式）
2. 底部浮动工具栏出现，支持：
   - 🏷️ 批量添加标签
   - 🔗 批量复制磁力链接
   - 💾 批量保存图片到本地
   - 📥 **批量离线到 PikPak**（可选目标文件夹）
   - 🗑️ 批量删除
3. Shift + 点击可连续多选，Ctrl + 点击可跳选

### 429 预览失败处理流程

预览服务（whatslink.info）有频率限制，返回 429 时：

1. **自动记录**：失败的磁力自动保存到「⚠️ 预览失败 (429)」列表（侧边栏入口，最多 50 条）
2. **存储位置**：装了扩展 → 存扩展 `chrome.storage` | 无扩展 → 存 `localStorage`
3. **重试**：在失败列表中点击「🔍 预览」重新拉取；预览成功并保存后状态自动更新为「✅ 完成」
4. **批量导入**：点击「📥 导入全部」将全部失败磁力导入管理器（跳过已存在的）；或逐条「📥 导入」
5. **清空**：导入确认无误后点击「🗑️ 清空全部」

> 429 记录的磁力仅包含磁力链接和标题（无截图），导入后可在卡片上手动补图片。

### 备份策略说明

| 备份方式 | 位置 | 包含图片 | 增量/全量 | 适用场景 |
|---------|------|---------|----------|---------|
| 导出单文件 | 侧边栏 → 导出数据(单文件) | ❌ 不含 | 全量 | 快速备份元数据 |
| 完整备份 ZIP | 侧边栏 → 完整备份（含图片） | ✅ 含 | 全量 | 迁移/换设备 |
| Google Drive 云备份 | 侧边栏 → 云端管理 → 备份 | ✅ 含 | **增量** | 日常自动备份 |

#### Google Drive 增量备份原理

1. 首次备份：上传所有卡片 + 图片到云端
2. 后续备份：对比本地 `updatedAt` 和云端记录，只上传新增或修改过的卡片/图片
3. 已备份的 ID 记录在备份元数据中，避免重复上传
4. 恢复同理：只下载本地没有的卡片/图片

#### 注意事项

- 增量备份不会删除云端数据，手动清理需用「🧹 清理云端孤儿图片」
- ZIP 恢复会覆盖本地所有数据，请谨慎操作
- Google Drive 有配额限制（免费用户约 15GB），备份时会显示已用/总量

---

| 功能 | 说明 |
|------|------|
| **磁力管理** | 添加、编辑、删除磁力链接，支持标题、标签、评分、预览图 |
| **标签系统** | 创建标签、拖拽排序、按标签筛选、自动标签规则 |
| **评分筛选** | 1-5 星评分，支持按评分过滤 |
| **搜索** | 按标题或标签关键词搜索 |
| **分页加载** | 可配置每页加载数量（20/50/100/200） |
| **批量操作** | 批量添加标签、复制链接、保存图片、删除 |
| **预览图管理** | 上传图片、粘贴网络图片链接、转换网络图片为本地存储 |
| **暗色模式** | 白天/夜晚模式切换 |
| **数据导入导出** | 单文件 JSON 导出/导入（不含图片） |
| **完整备份/恢复** | ZIP 包导出（含图片二进制），支持从文件夹导入图片 |
| **剪贴板监视** | 自动检测剪贴板中的磁力链接并导入 |
| **自动导入** | 定时从扩展待导入队列拉取磁力 |
| **重复检测** | 检测并清理重复磁力（支持精确/模糊匹配） |
| **标题过滤词** | 管理自动清理标题中的广告词 |
| **429 失败管理** | 预览失败的磁力可稍后重试、批量导入 |
| **失败列表** | 图片转换失败的磁力列表，支持重试 |

---

## 备份与还原

### 本地备份

- **导出单文件**（不含图片）：侧边栏 → 导出数据(单文件)
- **完整备份**（含图片 ZIP）：侧边栏 → 完整备份（含图片）
- **恢复完整备份**：侧边栏 → 恢复完整备份，选择 `.zip` 文件

### Google Drive 云备份（实验性）

> 需要 Google 账号授权。Token 存储在 `localStorage`。

- **云端备份**：侧边栏 → 云端管理 → "☁️ 上传备份" 按钮
  - 增量备份，只上传新增和变化的卡片/图片
  - 备份元数据记录已备份的 ID，避免重复
- **云端恢复**：侧边栏 → 云端管理 → "从云端恢复"
  - 增量恢复，只下载本地没有的卡片/图片
  - 支持覆盖本地数据
- **图片清理**：清除云端孤立图片（无卡片引用的）

---

## 目录结构

```
/
├── api/
│   └── proxy/index.js    ← Vercel Serverless CORS 代理（部署入口）
├── extension/             ← Chrome 扩展
│   ├── background.js      ← 后台 Service Worker
│   ├── content.js          ← 内容脚本（页面桥接通信）
│   ├── inject.js           ← 主世界注入标志
│   ├── magnet-detector.js  ← 磁力嗅探与预览弹窗
│   ├── pikpak-token.js     ← PikPak 页面 Token 捕获
│   ├── manifest.json       ← 扩展清单
│   ├── options.html        ← 扩展设置页
│   └── options.js          ← 设置页逻辑
├── page/
│   └── index.html          ← 磁力管理器静态页面（GitHub Pages 入口）
├── proxy/
│   ├── server.js           ← 本地 Node.js 代理服务器
│   ├── worker.js           ← Cloudflare Worker 代理
│   ├── start-server.bat    ← Windows 一键启动脚本（含 Cloudflare Tunnel）
│   └── cloudflared.exe     ← Cloudflare Tunnel 客户端（首次自动下载）
├── .gitignore              ← 排除 *.exe、node_modules/
├── package.json            ← Vercel Node.js 项目配置
└── README.md
```

## 开发说明

### 本地启动

```bash
# 启动本地代理（同时提供 API 和页面）
node proxy/server.js

# 浏览器打开
open http://localhost:3000
```

### 加载未打包扩展

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `extension/` 目录。

---

## 技术栈

- **页面**：原生 JavaScript + IndexedDB + CSS Variables
- **扩展**：Chrome Extension Manifest V3
- **代理**：Vercel Serverless (Node.js) / Cloudflare Worker
- **云备份**：Google Drive API (REST v3)
- **图片压缩**：JSZip + IndexedDB Blob Storage
