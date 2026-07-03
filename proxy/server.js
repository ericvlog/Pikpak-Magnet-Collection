// PikPak 全合一服务器 — 同时提供静态页面 + CORS 代理
// 用法: node pikpak-proxy-server.js
// 打开 http://localhost:3000 即可使用

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const WEB_ROOT = path.join(__dirname, '..'); // 项目根目录
const ALLOWED_HOSTS = ['user.mypikpak.com', 'api-drive.mypikpak.com', 'api.mypikpak.com', 'mypikpak.com'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const MIME_TYPES = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ======= 1. CORS 预检 =======
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // ======= 2. 代理请求（带 ?url= 参数） =======
  if (parsed.query.url) {
    const targetUrl = parsed.query.url;
    let hostname;
    try {
      hostname = new url.URL(targetUrl).hostname;
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Bad target URL');
    }
    if (!ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden host');
    }

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const t = new url.URL(targetUrl);
      const opts = {
        hostname: t.hostname,
        port: t.port || 443,
        path: t.pathname + t.search,
        method: req.method,
        headers: { ...req.headers, host: t.hostname },
      };
      delete opts.headers['origin'];
      delete opts.headers['referer'];

      const proxyReq = https.request(opts, (proxyRes) => {
        const h = { ...proxyRes.headers, ...CORS_HEADERS };
        res.writeHead(proxyRes.statusCode, h);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => {
        res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + e.message);
      });
      if (body.length) proxyReq.write(Buffer.concat(body));
      proxyReq.end();
    });
    return;
  }

  // ======= 3. 静态文件服务 =======
  let filePath = parsed.pathname === '/' ? '/page/index.html' : parsed.pathname;
  filePath = path.join(WEB_ROOT, filePath);

  // 安全：禁止跳出当前目录
  if (!filePath.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  // 获取局域网 IP
  let lanIP = '127.0.0.1';
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIP = net.address;
        break;
      }
    }
    if (lanIP !== '127.0.0.1') break;
  }

  console.log(`✅ PikPak 服务器已启动`);
  console.log(`   本机:   http://localhost:${PORT}`);
  console.log(`   手机:   http://${lanIP}:${PORT}（同一 WiFi）`);
  console.log(`   代理和内嵌页面同源，无需 CORS`);
  console.log(`   手机打开后点 PikPak 登入 → 在「CORS 代理地址」填 http://${lanIP}:${PORT}/?url= → 保存`);
});
