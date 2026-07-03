// Vercel Serverless — PikPak CORS Proxy
// 部署后地址: https://你的项目名.vercel.app/api/proxy?url=...
// 改进：修复登入失败问题，对齐本地 Node.js 代理的行为

const ALLOWED_HOSTS = [
  'user.mypikpak.com',
  'api-drive.mypikpak.com',
  'api.mypikpak.com',
  'mypikpak.com',
];

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const { url: targetUrl } = req.query;
  if (!targetUrl) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'Missing ?url=' });
  }

  // Whitelist
  let targetHost;
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'Bad target URL' });
  }
  if (!ALLOWED_HOSTS.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(403).json({ error: 'Forbidden host: ' + targetHost });
  }

  // Read raw body
  const chunks = [];
  await new Promise((resolve) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
  });
  const rawBody = Buffer.concat(chunks);

  // Build outgoing headers — forward browser's headers except proxy ones
  const outHeaders = {};
  const skip = new Set([
    'host', 'origin', 'referer', 'x-forwarded-for', 'x-forwarded-proto',
    'x-vercel-deployment-url', 'x-vercel-id', 'x-vercel-proxy-signature',
    'x-vercel-skip', 'connection', 'upgrade', 'content-length',
  ]);
  for (const [k, v] of Object.entries(req.headers)) {
    if (!skip.has(k.toLowerCase())) outHeaders[k] = v;
  }

  // 关键修复：设置正确的 Host 头（本地代理也是这样做的）
  const targetUrlObj = new URL(targetUrl);
  outHeaders['host'] = targetUrlObj.host;

  // 删除 Origin 和 Referer（对齐本地代理行为）
  delete outHeaders['origin'];
  delete outHeaders['referer'];

  // 让 PikPak 看到真实的 X-Forwarded-For（Vercel 环境用 remoteAddress）
  outHeaders['x-forwarded-for'] = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 关键修复：设置 User-Agent（如果浏览器没发，就用默认的）
  if (!outHeaders['user-agent']) {
    outHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  }

  // 关键修复：设置 Accept 头
  if (!outHeaders['accept']) {
    outHeaders['accept'] = 'application/json, text/plain, */*';
  }

  try {
    // 关键修复：使用 stream 而不是 buffer 中转，避免 Content-Type 丢失
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: outHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
    });

    // CORS headers on response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Forward response headers (except hop-by-hop)
    const hopByHop = new Set(['transfer-encoding', 'connection', 'keep-alive', 'te', 'trailers', 'upgrade']);
    for (const [k, v] of resp.headers) {
      if (!hopByHop.has(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }

    // 关键修复：设置正确的 Content-Type（如果 PikPak 返回了的话）
    const contentType = resp.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // 关键修复：读取 body 并发送（使用 pipe 方式的替代方案）
    const bodyBuffer = Buffer.from(await resp.arrayBuffer());
    res.status(resp.status).send(bodyBuffer);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: 'Proxy error: ' + e.message });
  }
}
