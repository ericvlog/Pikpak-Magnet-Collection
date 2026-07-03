// Cloudflare Worker — PikPak transparent CORS Proxy
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '*';

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response('Missing ?url=', { status: 400, headers: corsHeaders });
  }

  // Whitelist PikPak domains
  const allowedHosts = ['user.mypikpak.com', 'api-drive.mypikpak.com', 'api.mypikpak.com', 'mypikpak.com'];
  let targetHost;
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch (e) {
    return new Response('Bad target URL', { status: 400, headers: corsHeaders });
  }
  if (!allowedHosts.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
    return new Response('Forbidden host: ' + targetHost, { status: 403, headers: corsHeaders });
  }

  // Forward all headers; add real client IP, strip proxy-identifying ones
  const headers = new Headers(request.headers);
  headers.delete('Origin');
  headers.delete('Referer');
  headers.delete('CF-Ray');
  headers.delete('CF-Visitor');
  headers.delete('CDN-Loop');
  // Pass real user IP so PikPak sees the browser's IP, not Cloudflare's
  const clientIP = request.headers.get('CF-Connecting-IP');
  if (clientIP) {
    headers.set('X-Forwarded-For', clientIP);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  let resp;
  try {
    resp = await fetch(targetUrl, init);
  } catch (e) {
    return new Response('Proxy fetch error: ' + e.message, { status: 502, headers: corsHeaders });
  }

  // Add CORS headers to the response
  const respHeaders = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    respHeaders.set(k, v);
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
  });
}
