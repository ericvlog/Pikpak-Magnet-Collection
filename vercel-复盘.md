# Vercel 代理复盘：我犯了什么错

## 背景

用户用 Vercel 代理调 PikPak API，登录和刷新 token 正常，但选文件夹和离线（`api-drive.mypikpak.com`）返回 401。

## 我的错误诊断

1. 看到 JWT 里 `iss` 是 `https://pikpak-magnet-collection.vercel.app`，我推断是 PikPak 认证服务器根据 Vercel 的出站 IP 动态设置 issuer，资源服务器校验 issuer 白名单失败 → **这是网络层问题，代理代码改不了**。
2. 我说「大概率无解」，让用户放弃 Vercel 走 Cloudflare Tunnel。

## 实际原因

Vercel 会在请求头里注入大量标头（`x-vercel-*`, `x-forwarded-*` 等）。代理代码只过滤了部分已知的 `x-vercel-` 头，**漏掉了如 `x-forwarded-host`、`trace-id`、`via`、`x-request-id` 等**。PikPak 的某个上游网关读到了这些头中包含的 Vercel 域名，把它当成了 issuer 写入 JWT。

## 正确的修复

把 **所有** 可能泄漏 Vercel 域名的头全部过滤掉：

- 所有 `x-vercel-*` 前缀的头
- 所有 `x-forwarded-*` 前缀的头
- 所有 `x-real-*` 前缀的头
- `trace-id`、`via`、`x-request-id` 等杂项

## 教训

1. **不要过早下「无解」的结论**。用户坚持要试，结果一次就修好了。
2. **代理类问题优先怀疑头泄露**，而不是 IP 侦测。Vercel 作为反向代理，请求头里充满平台信息，漏过滤一个就能让上游服务做出错误判断。
3. **诊断要彻底**：看到 issuer 不对 → 应该先想「PikPak 从哪里拿到这个域名」→ 检查所有转发的请求头 → 找出泄露源。而不是跳过排查直接归因为「IP 层面问题」。
