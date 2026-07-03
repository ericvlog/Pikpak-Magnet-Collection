# PikPak CORS Proxy

Vercel 部署的 CORS 代理，用于在浏览器中直连 PikPak API。

> **推荐方案**：安装[浏览器扩展](https://github.com/ericvlog/magnettools)，扩展内置 PikPak 代理，无需自行部署，体验更好。

---

## 一键部署（免费）

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/ericvlog/pikpak-cors)

1. 点击上方按钮，用 GitHub 账号登录 Vercel
2. 仓库选择 `ericvlog/pikpak-cors`
3. 点击 **Deploy**，等待部署完成（约 1 分钟）
4. 部署后你会得到一个地址：`https://你的项目名.vercel.app`

## 手动部署

1. Fork 或 clone 本仓库
2. 在 [Vercel Dashboard](https://vercel.com/) 点击 **Add New → Project**
3. 导入本仓库，点击 **Deploy**
4. 部署完成后获得代理地址

## 如何使用

代理地址格式：

```
https://你的项目名.vercel.app/api/proxy?url=目标API地址
```

### 在磁力管理器中使用

1. 打开 `offlinedown.html`
2. 点击 **PikPak 登录**
3. 在弹窗底部的输入框填入你的代理地址（含 `?url=`）
4. 点击 **保存**，测试连通后登录即可

## API 白名单

本代理只转发以下域名：
- `user.mypikpak.com`
- `api-drive.mypikpak.com`
- `api.mypikpak.com`
- `mypikpak.com`

## 本地开发

```bash
node pikpak-proxy-server.js
```

默认监听 `http://localhost:3000`。

## 技术原理

PikPak 的 API 设置了 CORS 响应头，浏览器中无法直接调用。本代理通过 Vercel Serverless Function 中转请求，绕过浏览器 CORS 限制。
