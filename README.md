# PikPak 磁力管理器

一站式磁力管理工具，支持磁力预览、离线下载到 PikPak、图片管理、标签分类、云备份。

---

## 🚀 快速开始

### 只用网页（推荐配合扩展）

1. 部署 `page/index.html` 到 GitHub Pages 或任意静态托管
2. 安装下方浏览器扩展
3. 页面自动通过扩展桥接 PikPak，无需配置
4. 登录 PikPak 即可离线下载

> 也可以不装扩展独立使用，需自行部署 CORS 代理（见下方）。

### 安装浏览器扩展

1. 打开 `chrome://extensions` → 开启 **开发者模式**
2. **加载已解压的扩展程序** → 选择本仓库 `extension/` 目录
3. 扩展会自动注入到所有网页，安装后在任意网页的磁力链接旁会出现「预览」按钮

> 扩展功能：磁力嗅探、预览弹窗、图片代理下载、PikPak 内部登录、待导入队列

扩展设置：右键扩展图标 → **选项**，可登录 PikPak、管理待导入队列、配置图片白名单。

---

## 📖 功能使用指南

### 添加磁力

| 方式 | 操作 |
|------|------|
| **➕ 添加磁力** | 点顶部工具栏按钮，手动输入磁力链接和标题 |
| **📋 从剪贴板导入** | 复制 JSON 格式的磁力数据，点菜单项导入 |
| **🔗 粘贴磁力链接** | 复制磁力链接，页面自动检测剪贴板并提示导入 |
| **📥 批量添加** | 点「添加磁力」→ 粘贴多个磁力链接（每行一个）→ 解析 → 可预览/离线/保存 |

> 批量添加时点击「保存」会自动从 whatslink.info 获取标题、截图、文件大小，无需手动填写。

### 从 Telegram 导入视频

需要部署 Telegram Bot（见下方「部署 Telegram Bot」）。

1. 复制 t.me 链接（如 `https://t.me/xxx/123`）
2. 页面或扩展自动检测，解析视频信息
3. 卡片自动出现在列表中，点「离线」即可转发到 @PikPak_Bot

**卡片上的按钮说明：**

| 按钮 | 功能 |
|------|------|
| 📥 离线 | 将视频转发到 @PikPak_Bot 离线下载 |
| 🖼 预览 | 查看卡片大图和管理标签 |
| 🔄 更新 | 重新从 Telegram 获取文件元数据（文件引用过期时使用） |
| ✏ 编辑 | 修改标题、大小、图片、标签 |
| 💾 存本地 | 将网络图片下载到浏览器本地存储 |
| 🗑 删除 | 删除卡片 |

### 标签系统

- **创建标签**：菜单 → 管理标签 → 添加
- **拖拽排序**：在标签栏拖拽标签可调整顺序
- **自动标签**：菜单 → 自动标签规则 → 添加规则（如标题含 "4K" 自动打标签）
- **批量应用**：菜单 → 批量应用规则 → 对所有卡片执行自动标签规则
- **筛选**：点击标签可筛选该标签的卡片

### 批量操作

进入选择模式（勾选卡片右上角复选框），底部工具栏出现：

| 按钮 | 功能 |
|------|------|
| 🏷️ 批量添加标签 | 给选中卡片统一加标签 |
| 🔗 批量复制链接 | 复制所有选中卡片的磁力链接 |
| 💾 批量存本地 | 将选中卡片的网络图片下载到本地 |
| 📥 批量离线 | 将选中卡片发送到 PikPak（可选文件夹） |
| 🗑 批量删除 | 删除选中卡片 |
| 🔄 重新获取 | 按 TG 链接重新获取卡片（会删除原卡片再创建新的） |
| 🔄 更新元数据 | 批量刷新 Telegram 视频文件的 fileMeta |

> Shift+点击可连续多选，Ctrl+点击跳选。

### 筛选与搜索

| 方式 | 说明 |
|------|------|
| 🔍 搜索框 | 按标题或标签名搜索 |
| ⭐ 评分筛选 | 按 1-5 星过滤 |
| 📋 全部 / 🏷 无标签 / 🌐 网络图 / 🚫 无图片 / 📱 电报卡片 | 快速筛选 |
| 点击标签 | 筛选该标签的卡片 |

### Telegram Bot（部署后可用）

| 功能 | 操作 |
|------|------|
| **Telegram 登录** | 点「TG 登录」→ 输入手机号 → 输入验证码 → 完成登录 |
| **解析 TG 链接** | 自动检测剪贴板中的 t.me 链接，创建卡片 |
| **转发到 PikPak** | 卡片点「离线」通过 Bot 转发视频 |
| **文件引用过期** | 自动重新解析 TG 链接并重试转发 |
| **元数据迁移** | 菜单 → 迁移旧卡片元数据 → 将旧卡片从 Bot docMap 迁移到卡片本地（备份前执行一次） |

### 数据备份与恢复

| 方式 | 位置 | 含图片 | 说明 |
|------|------|--------|------|
| 💾 导出单文件 | 侧边栏菜单 | ❌ 不含 | 快速备份元数据 |
| 💾 完整备份（含图片） | 侧边栏菜单 | ✅ 含 ZIP | 迁移换设备用 |
| ☁️ 云端管理 | 顶部工具栏 | ✅ 增量 | Google Drive 增量备份 |

> 建议流程：迁移旧卡片元数据 → 完整备份（含图片）→ 存到云端。

---

## 🛠 部署指南

### 部署网页（GitHub Pages）

1. Fork 本仓库
2. 仓库 **Settings → Pages** → Source 选 **GitHub Actions** 或 **Deploy from a branch**
3. 目录选 `/page/`，部署完成访问 `https://你的用户名.github.io/仓库名/`

### 部署 Telegram Bot

```bash
cd telegram-bot
npm install
```

复制 `.env.example` 为 `.env`，填入：

```env
API_ID=你的API_ID              # https://my.telegram.org/apps
API_HASH=你的API_HASH
BOT_TOKEN=你的Bot_Token        # @BotFather 创建
BOT_USERNAME=你的Bot用户名
ALLOWED_USER_ID=你的TG用户ID   # 可选，限制 Bot 只接受你的命令
TARGET_BOT_USERNAME=@PikPak_Bot
PORT=19876
```

启动：双击 `start_bot.bat` 或 `node telegram-bot/index.js`

首次启动需要扫码或手机号登录 Telegram 账号。

**Bot API 端点：**

| 端点 | 用途 |
|------|------|
| `POST /api/resolve-tg-link` | 解析 t.me 链接，下载图片，创建 pending 卡片 |
| `POST /api/resolve-tg-file` | 轻量解析，仅返回文件元数据（不下图不入队列） |
| `POST /api/forward-to-pikpak/:fileId` | 转发文件到 @PikPak_Bot |
| `GET /api/pending` | 获取待导入卡片列表 |
| `DELETE /api/pending/:id` | 删除指定待导入卡片 |
| `GET /api/doc-map` | 获取全量文件映射（旧卡片迁移用） |
| `GET /api/doc-map-entry/:docId` | 获取单个映射条目 |
| `POST /api/telethon/send-code` | 发送 Telegram 登录验证码 |
| `POST /api/telethon/sign-in` | 验证码登录 |
| `POST /api/telethon/check-2fa` | 检查是否需要两步验证 |

### 部署 CORS 代理（仅无扩展时需要）

一键部署到 Vercel：[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ericvlog/Pikpak-Magnet-Collection)

部署后在页面「PikPak 登录」弹窗底部填入代理地址。

### 本地直接访问

```bash
node proxy/server.js
# 浏览器打开 http://localhost:3000
```

同源访问，无需任何代理配置。

---

## 📁 目录结构

```
/
├── page/index.html            ← 磁力管理器页面（GitHub Pages 入口）
├── extension/                  ← Chrome 扩展
│   ├── manifest.json
│   ├── content.js              ← 页面桥接通信
│   ├── background.js           ← 后台 Service Worker
│   ├── magnet-detector.js      ← 磁力嗅探与预览弹窗
│   ├── options.html / .js      ← 扩展设置页
│   └── pikpak-token.js         ← PikPak Token 捕获
├── telegram-bot/               ← Telegram Bot（gramjs MTProto）
│   ├── index.js                ← Express 服务器 + gramjs 客户端
│   ├── .env.example
│   └── start_bot.bat
├── proxy/                      ← CORS 代理
│   ├── server.js               ← 本地 Node.js 代理
│   ├── worker.js               ← Cloudflare Worker
│   └── start-server.bat
├── api/proxy/index.js          ← Vercel Serverless 代理
└── README.md
```
