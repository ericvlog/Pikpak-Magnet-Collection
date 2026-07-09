const path = require('path');
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });
console.log('[启动] .env 路径:', envPath);
console.log('[启动] API_ID:', process.env.API_ID ? '已设置(' + process.env.API_ID + ')' : '未设置');
console.log('[启动] API_HASH:', process.env.API_HASH ? '已设置' : '未设置');
console.log('[启动] BOT_TOKEN:', process.env.BOT_TOKEN ? '已设置' : '未设置');

const { Bot, Filter } = require('grammy');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');

// ===== 配置 =====
const PORT = parseInt(process.env.PORT) || 19876;
const BOT_TOKEN = process.env.BOT_TOKEN;
let BOT_USERNAME = process.env.BOT_USERNAME || '';
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID ? String(process.env.ALLOWED_USER_ID).trim() : '';
const API_ID = parseInt(process.env.API_ID) || 0;
const API_HASH = process.env.API_HASH || '';
const PENDING_FILE = path.join(__dirname, 'pending.json');
const IMAGES_DIR = path.join(__dirname, 'images');
const TARGET_BOT = process.env.TARGET_BOT_USERNAME || '@PikPak_Bot';
const DOC_MAP_FILE = path.join(__dirname, 'docMap.json');

if (!BOT_TOKEN) {
    console.error('❌ 缺少 BOT_TOKEN，请在 .env 中设置');
    process.exit(1);
}

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
cleanupOrphanImages();

// ===== Telethon 用户客户端（用于转发消息到 @PikPakBot） =====
let userClient = null;
let userClientPromise = null;
let pendingPhoneCode = null;
const FILE_MAP_FILE = path.join(__dirname, 'fileMap.json');
const USER_SESSION_FILE = path.join(__dirname, '.user_session');

function loadFileMap() {
    try {
        if (!fs.existsSync(FILE_MAP_FILE)) return {};
        return JSON.parse(fs.readFileSync(FILE_MAP_FILE, 'utf-8'));
    } catch { return {}; }
}

function saveFileMap(map) {
    fs.writeFileSync(FILE_MAP_FILE, JSON.stringify(map, null, 2), 'utf-8');
}
// ===== docMap: 存储从 t.me 链接获取的 MTProto 文档信息（按需转发用） =====

function loadDocMap() {
    try {
        if (!fs.existsSync(DOC_MAP_FILE)) return {};
        return JSON.parse(fs.readFileSync(DOC_MAP_FILE, 'utf-8'));
    } catch { return {}; }
}

function saveDocMap(map) {
    fs.writeFileSync(DOC_MAP_FILE, JSON.stringify(map, null, 2), 'utf-8');
}

function addDocEntry(doc, { peer = '', msgId = 0 } = {}) {
    const map = loadDocMap();
    const id = uuidv4();
    let fileName = '';
    if (doc.attributes) {
        for (const attr of doc.attributes) {
            if (attr instanceof Api.DocumentAttributeFilename) {
                fileName = attr.fileName;
                break;
            }
        }
    }
    map[id] = {
        id: String(doc.id),
        accessHash: String(doc.accessHash),
        fileReference: doc.fileReference ? doc.fileReference.toString('base64') : '',
        fileName,
        date: doc.date || 0,
        size: String(doc.size || 0),
        mimeType: doc.mimeType || '',
        dcId: doc.dcId || 0,
        peer,
        msgId,
    };
    saveDocMap(map);
    return id;
}

function removeDocEntry(id) {
    const map = loadDocMap();
    delete map[id];
    saveDocMap(map);
}

// seqCounter: 用于相册多文件的时间戳消歧（递增序号，每 ms 重置）
let seqCounter = 0;
let seqCounterTs = 0;

function addFileMapping(fileId, chatId, messageId, date) {
    const map = loadFileMap();
    const now = Date.now();
    if (now !== seqCounterTs) { seqCounter = 0; seqCounterTs = now; }
    // tsOrder = 时间戳 + 序号（同一毫秒内的多个文件通过序号区分）
    const tsOrder = now + '.' + (seqCounter++);
    map[fileId] = { chatId, messageId, date, tsOrder };
    saveFileMap(map);
}

// 从 fileMap 条目找到正确的 MTProto 消息
async function findMtprotoMessage(fileId, entry) {
    const client = await getUserClient();
    if (!client) throw new Error('用户未登录');
    if (!client.connected) await client.connect();
    if (!(await client.checkAuthorization())) throw new Error('session 已过期');

    const botPeer = await client.getInputEntity(BOT_USERNAME);
    const recent = await client.getMessages(botPeer, { limit: 200 });
    // 只保留 document 类消息（video/document），排除 photo
    const docMsgs = recent.filter(m => m.media && m.media.document).sort((a, b) => a.id - b.id);

    // 优先使用已缓存的 mtprotoId
    if (entry.mtprotoId) {
        const cached = docMsgs.find(m => m.id === entry.mtprotoId);
        if (cached) { console.log(`[查找] 缓存命中: MTProto ID=${cached.id}`); return cached; }
    }

    // 按 Bot API messageId 顺序匹配 MTProto messageId 顺序
    // pendingEntries[0] → docMsgs[docMsgs.length - pendingEntries.length + 0]
    // pendingEntries[N] → docMsgs[docMsgs.length - pendingEntries.length + N]
    const allMap = loadFileMap();
    const pendingEntries = Object.entries(allMap)
        .filter(([k, v]) => !v.mtprotoId && v.messageId)
        .sort((a, b) => a[1].messageId - b[1].messageId);

    const pendingIdx = pendingEntries.findIndex(([fid]) => fid === fileId);
    if (pendingIdx >= 0) {
        if (pendingEntries.length <= docMsgs.length) {
            const msgIdx = docMsgs.length - pendingEntries.length + pendingIdx;
            const msg = docMsgs[msgIdx];
            console.log(`[查找] 顺序匹配: pendingIdx=${pendingIdx} msgIdx=${msgIdx} total=${pendingEntries.length} docMsgs=${docMsgs.length} → MTProto ID=${msg.id}`);
            const map = loadFileMap();
            if (map[fileId]) { map[fileId].mtprotoId = msg.id; saveFileMap(map); }
            return msg;
        }
        // pending 比 docMsgs 多 → 用模运算分散
        const idx = pendingIdx % docMsgs.length;
        const msg = docMsgs[idx];
        console.log(`[查找] 顺序溢出: pendingIdx=${pendingIdx} docMsgs=${docMsgs.length} idx=${idx} → MTProto ID=${msg.id}`);
        const map = loadFileMap();
        if (map[fileId]) { map[fileId].mtprotoId = msg.id; saveFileMap(map); }
        return msg;
    }

    // 终极降级：取最新一条 document
    const fallback = docMsgs[docMsgs.length - 1];
    if (fallback) {
        console.log(`[查找] 终极降级取最新: MTProto ID=${fallback.id}`);
        const map3 = loadFileMap();
        if (map3[fileId]) { map3[fileId].mtprotoId = fallback.id; saveFileMap(map3); }
        return fallback;
    }

    throw new Error('未找到匹配的消息');
}

async function getUserClient() {
    if (userClient && userClient.connected) return userClient;
    if (userClientPromise) return userClientPromise;

    userClientPromise = (async () => {
        if (!API_ID || !API_HASH) {
            console.warn('[用户] 未配置 API_ID/API_HASH，转发功能不可用');
            return null;
        }
        let session = new StringSession('');
        if (fs.existsSync(USER_SESSION_FILE)) {
            try {
                const saved = fs.readFileSync(USER_SESSION_FILE, 'utf-8').trim();
                if (saved) session = new StringSession(saved);
            } catch {}
        }
        const client = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: false,
        });
        await client.connect();
        if (await client.checkAuthorization()) {
            console.log('[用户] 已登录（session 有效）');
            userClient = client;
            return client;
        }
        console.log('[用户] session 无效或未登录');
        // 保存 client 引用但不标记为已登录
        userClient = client;
        return client;
    })();

    return userClientPromise;
}

function saveUserSession(client) {
    const str = client.session.save();
    fs.writeFileSync(USER_SESSION_FILE, str, 'utf-8');
    console.log('[用户] session 已保存');
}

// ===== 队列持久化 =====
function loadPending() {
    try {
        if (!fs.existsSync(PENDING_FILE)) return [];
        return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8'));
    } catch { return []; }
}

function savePending(items) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function addPending(item) {
    const items = loadPending();
    items.push({ id: uuidv4(), ...item, timestamp: Date.now() });
    while (items.length > 50) items.shift();
    savePending(items);
}

function removePending(id) {
    const items = loadPending();
    const item = items.find(i => i.id === id);
    if (item) {
        const urls = [item.imageUrl, ...(item.extraImages || [])].filter(Boolean);
        console.log(`[removePending] 找到条目, imageUrl="${item.imageUrl}", extraImages=${item.extraImages?.length || 0}张, 待处理URL数=${urls.length}`);
        for (const url of urls) {
            try {
                const filename = path.basename(new URL(url).pathname);
                const filePath = path.join(IMAGES_DIR, filename);
                console.log(`[removePending] 处理URL: ${url.substring(0, 60)}... → filename=${filename}, filePath=${filePath}, exists=${fs.existsSync(filePath)}`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`[removePending] 已删除: ${filename}`);
                }
            } catch (e) {
                console.warn(`[removePending] 删除失败: ${e.message}`);
            }
        }
        // 清理关联的 docMap 条目
        const fIds = [...(item.fileIds || [])];
        if (item.fileId && !fIds.includes(item.fileId)) fIds.push(item.fileId);
        for (const fid of fIds) {
            if (fid.startsWith('doc:')) {
                removeDocEntry(fid.slice(4));
                console.log(`[removePending] 已清理 docMap: ${fid.slice(4).substring(0, 8)}...`);
            }
        }
    } else {
        console.warn(`[removePending] 未找到条目: ${id}`);
    }
    savePending(items.filter(i => i.id !== id));
    console.log(`[removePending] 完成, 剩余 ${loadPending().length} 条`);
}

function cleanupOrphanImages() {
    const items = loadPending();
    const referenced = new Set();
    const docRefs = new Set();
    for (const item of items) {
        const urls = [item.imageUrl, ...(item.extraImages || [])].filter(Boolean);
        for (const url of urls) {
            try { referenced.add(path.basename(new URL(url).pathname)); } catch (e) { /* ignore */ }
        }
        const fIds = [...(item.fileIds || [])];
        if (item.fileId && !fIds.includes(item.fileId)) fIds.push(item.fileId);
        for (const fid of fIds) {
            if (fid.startsWith('doc:')) docRefs.add(fid.slice(4));
        }
    }
    // 清理未被引用的 docMap 条目
    const docMap = loadDocMap();
    for (const key of Object.keys(docMap)) {
        if (!docRefs.has(key)) {
            delete docMap[key];
            console.log(`[Bot] 清理未引用 docMap: ${key.substring(0, 8)}...`);
        }
    }
    saveDocMap(docMap);
    // 清理未被引用的图片
    if (!fs.existsSync(IMAGES_DIR)) return;
    for (const file of fs.readdirSync(IMAGES_DIR)) {
        if (!referenced.has(file)) {
            try { fs.unlinkSync(path.join(IMAGES_DIR, file)); console.log(`[Bot] 清理未引用图片: ${file}`); } catch (e) { /* ignore */ }
        }
    }
}

// ===== 下载 Telegram 图片 =====
async function downloadTelegramImage(fileId) {
    try {
        const file = await bot.api.getFile(fileId);
        const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const buffer = Buffer.from(await resp.arrayBuffer());
        const ext = path.extname(file.file_path) || '.jpg';
        const filename = uuidv4() + ext;
        const filePath = path.join(IMAGES_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        return `http://localhost:${PORT}/images/${filename}`;
    } catch (err) {
        console.warn('[Bot] 图片下载失败:', err.message);
        return null;
    }
}

// ===== 解析 t.me 链接 =====
function parseTgLink(url) {
    if (!url) throw new Error('链接为空');
    // 去掉查询参数和末尾斜杠
    const clean = url.split('?')[0].replace(/\/+$/, '');
    const m = clean.match(/https?:\/\/(?:t\.me|telegram\.me)\/c\/(\d+)\/(\d+)/);
    if (m) return { peer: '-100' + m[1], msgId: parseInt(m[2]) };
    const m2 = clean.match(/https?:\/\/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)\/(\d+)/);
    if (m2) return { peer: m2[1], msgId: parseInt(m2[2]) };
    throw new Error('无法解析 t.me 链接: ' + url);
}

// ===== 通过 gramjs 下载媒体（图片/缩略图）=====
async function downloadMediaViaGramjs(client, msg, options = {}) {
    try {
        const data = await client.downloadMedia(msg, options);
        if (!data) return null;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buffer.length === 0) return null;
        const filename = uuidv4() + '.jpg';
        const filePath = path.join(IMAGES_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        return `http://localhost:${PORT}/images/${filename}`;
    } catch (err) {
        console.warn('[Bot] gramjs 媒体下载失败:', err.message);
        return null;
    }
}

// ===== 发送 Document 到 @PikPakBot（通过 MTProto，不重新上传）=====
async function sendDocumentToPikpak(client, doc, { retryAsUpload = true } = {}) {
    const targetPeer = await client.getInputEntity(TARGET_BOT);
    const sendId = BigInt(Math.floor(Math.random() * 1e15));
    console.log(`[转发] 发送 media: doc.id=${doc.id} randomId=${sendId}`);
    try {
        const inputMedia = new Api.InputMediaDocument({
            id: new Api.InputDocument({
                id: doc.id,
                accessHash: doc.accessHash,
                fileReference: doc.fileReference,
            }),
        });
        await client.invoke(new Api.messages.SendMedia({
            peer: targetPeer,
            media: inputMedia,
            message: '',
            randomId: sendId,
        }));
    } catch (err) {
        if (err.message && err.message.includes('CHAT_FORWARDS_RESTRICTED')) {
            const url = doc.peer.startsWith('-100') ? `https://t.me/c/${doc.peer.slice(4)}/${doc.msgId}` : `https://t.me/${doc.peer}/${doc.msgId}`;
            console.log(`[转发] 频道禁止转发，发送 t.me 链接到 ${TARGET_BOT}: ${url}`);
            await client.invoke(new Api.messages.SendMessage({
                peer: targetPeer,
                message: url,
                randomId: BigInt(Math.floor(Math.random() * 1e15)),
            }));
            console.log(`[转发] 链接已发送到 ${TARGET_BOT}`);
            return;
        }
        throw err;
    }
}

// ===== 从转发消息提取 t.me 永久链接 =====
function extractPostLink(ctx) {
    const msg = ctx.message;
    // 转发自频道/群组
    const chat = msg.forward_from_chat;
    const msgId = msg.forward_from_message_id;
    if (chat && msgId) {
        if (chat.username) {
            return `https://t.me/${chat.username}/${msgId}`;
        }
        // 私密频道/群组: t.me/c/id/msgId
        let chatId = chat.id;
        if (String(chatId).startsWith('-100')) {
            chatId = String(chatId).slice(4);
        } else if (String(chatId).startsWith('-')) {
            chatId = String(chatId).slice(1);
        }
        return `https://t.me/c/${chatId}/${msgId}`;
    }
    // 文本消息中的 t.me 链接
    if (msg.text) {
        const m = msg.text.match(/https?:\/\/t\.me\/[a-zA-Z0-9_\/-]+/);
        if (m) return m[0];
    }
    if (msg.caption) {
        const m = msg.caption.match(/https?:\/\/t\.me\/[a-zA-Z0-9_\/-]+/);
        if (m) return m[0];
    }
    return '';
}

// ===== 提取磁力链接和直链 =====
function extractMagnet(text) {
    if (!text) return null;
    const m = text.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^\s]*/i);
    return m ? m[0] : null;
}

function extractVideoUrl(text) {
    if (!text) return null;
    const re = /https?:\/\/[^\s]+\.(mp4|avi|mkv|mov|wmv|flv|webm|ts)(\?[^\s]*)?/i;
    const m = text.match(re);
    if (m) return m[0];
    // 也匹配无扩展名的常见视频域名
    const domains = ['t.me', 'telegram.dog', 'cdn.*'];
    return null;
}

// ===== 从消息/磁力提取标题 =====
function extractTitle(text, magnetLink) {
    if (!text && !magnetLink) return '';
    if (magnetLink) {
        const dn = magnetLink.match(/[?&]dn=([^&]+)/i);
        if (dn) {
            try { return decodeURIComponent(dn[1]); } catch { return dn[1]; }
        }
    }
    if (text) {
        // 去掉磁力链接本身
        let clean = text.replace(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^\s]*/gi, '').trim();
        clean = clean.replace(/https?:\/\/[^\s]+/gi, '').trim();
        // 取第一行有效文本
        const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) return lines[0];
    }
    return '';
}

// ===== 相册合并（media_group_id 缓冲） =====
const albumBuffer = new Map();
const ALBUM_TIMEOUT = 1500; // 1.5s 收集同组消息

async function finalizeAlbum(groupId) {
    const album = albumBuffer.get(groupId);
    if (!album) return;
    albumBuffer.delete(groupId);

    const images = [];
    for (const photo of album.photos) {
        const url = await downloadTelegramImage(photo.file_id);
        if (url) images.push(url);
    }

    // 用相册中的 caption（优先取视频 caption）
    const caption = album.videoCaption || album.caption || '';
    // 构建有意义的标题
    let title = caption || album.videoFileName || 'Telegram 相册';
    if (album.video && caption) {
        title = caption;
    } else if (album.video && !caption) {
        title = album.videoFileName || 'Telegram 视频';
    }

    let imageUrl = '';
    let extraImages = [];

    if (images.length > 0) {
        // 有图片：第一张做封面，其余做额外图，不要视频缩略图
        imageUrl = images[0];
        extraImages = images.slice(1);
    } else if (album.video && album.videoThumbnails.length > 0) {
        // 纯视频：取所有视频缩略图，最多 6 张
        const thumbs = [];
        for (const thumbId of album.videoThumbnails) {
            if (thumbs.length >= 6) break;
            const url = await downloadTelegramImage(thumbId);
            if (url) thumbs.push(url);
        }
        if (thumbs.length > 0) {
            imageUrl = thumbs[0];
            extraImages = thumbs.slice(1);
        }
    }

    const fIds = album.videoFileIds;
    addPending({
        type: 'video',
        url: '',
        title,
        imageUrl,
        extraImages,
        messageUrl: album.messageUrl,
        fileId: fIds[0] || '',
        fileIds: fIds.length > 1 ? fIds : []
    });
    console.log(`[Bot] 相册完成: ${title?.substring(0, 40)} | ${images.length + (album.video ? 1 : 0)} 个媒体`);
}

function bufferToAlbum(ctx, type, data) {
    const groupId = ctx.message.media_group_id;
    const msg = ctx.message;

    if (!albumBuffer.has(groupId)) {
        albumBuffer.set(groupId, {
            video: false,
            videoThumbnails: [],
            videoFileName: '',
            videoCaption: '',
            videoFileIds: [],
            photos: [],
            caption: msg.caption || '',
            messageUrl: extractPostLink(ctx),
            timer: null
        });
    }

    const album = albumBuffer.get(groupId);
    // 刷新 timer
    if (album.timer) clearTimeout(album.timer);
    album.timer = setTimeout(() => finalizeAlbum(groupId), ALBUM_TIMEOUT);

    if (type === 'video') {
        album.video = true;
        if (data.thumbnail) album.videoThumbnails.push(data.thumbnail.file_id);
        if (data.file_name) album.videoFileName = data.file_name;
        if (data.fileId) album.videoFileIds.push(data.fileId);
        if (msg.caption) album.videoCaption = msg.caption;
    } else if (type === 'photo') {
        // 取最大尺寸
        const best = msg.photo.reduce((a, b) => (a.width * a.height > b.width * b.height) ? a : b);
        album.photos.push({ file_id: best.file_id });
    }

    // 合并 caption（优先取已存在的）
    if (msg.caption && !album.caption) album.caption = msg.caption;
    if (!album.messageUrl) album.messageUrl = extractPostLink(ctx);
}

// ===== Telegram Bot =====
const bot = new Bot(BOT_TOKEN);

bot.on(':text', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
        console.log(`[Bot] 忽略用户 ${userId} 的消息`);
        return;
    }

    const text = ctx.message.text;
    console.log(`[Bot] 收到消息: ${text?.substring(0, 60)}...`);

    const magnetLink = extractMagnet(text);
    const videoUrl = extractVideoUrl(text);

    if (!magnetLink && !videoUrl) {
        console.log('[Bot] 未找到磁力或视频链接，忽略');
        return;
    }

    const title = extractTitle(text, magnetLink);
    const url = magnetLink || videoUrl;
    const type = magnetLink ? 'magnet' : 'video';

    // 处理消息中的图片
    const msg = ctx.message;
    const imageUrls = [];
    if (msg.photo && msg.photo.length > 0) {
        // 取最大尺寸的图片
        const best = msg.photo.reduce((a, b) => (a.width * a.height > b.width * b.height) ? a : b);
        const imgUrl = await downloadTelegramImage(best.file_id);
        if (imgUrl) imageUrls.push(imgUrl);
    }

    // 处理相册中的其他图片
    const mediaGroupId = msg.media_group_id;
    if (mediaGroupId) {
        // 实际 grammy 需要 album middleware 才能捕获同组媒体
        // 这里暂不处理相册，先只取单条消息的图片
    }

    const entry = {
        type,
        url: url,
        title: title,
        imageUrl: imageUrls[0] || '',
        extraImages: imageUrls.slice(1),
        messageUrl: extractPostLink(ctx)
    };

    addPending(entry);
    console.log(`[Bot] 已加入队列: ${type} | ${title?.substring(0, 40)} | ${imageUrls.length} 张图`);
});

bot.on(':photo', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    const msg = ctx.message;

    // 属于相册的图片由缓冲处理
    if (msg.media_group_id) {
        console.log(`[Bot] 相册图片加入缓冲: ${msg.media_group_id}`);
        bufferToAlbum(ctx, 'photo');
        return;
    }

    // 单张图片（无相册）→ 创建 pending 条目
    const best = msg.photo.reduce((a, b) => (a.width * a.height > b.width * b.height) ? a : b);
    const imageUrl = await downloadTelegramImage(best.file_id);
    const title = msg.caption || 'Telegram 图片';
    const messageUrl = extractPostLink(ctx);
    addPending({ type: 'video', url: '', title, imageUrl, extraImages: [], messageUrl });
    console.log(`[Bot] 已加入队列: image | ${title?.substring(0, 40)}${messageUrl ? ' | t.me' : ''}`);
});

bot.on(':video', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;

    const video = ctx.message.video;
    const msg = ctx.message;

    // 属于相册的视频由缓冲处理
    if (msg.media_group_id) {
        console.log(`[Bot] 相册视频加入缓冲: ${msg.media_group_id}`);
        const fileId = video.file_id;
        console.log('[Bot] 相册视频 file_id:', fileId.substring(0, 20) + '...');
        addFileMapping(fileId, msg.chat.id, msg.message_id, msg.date);
        bufferToAlbum(ctx, 'video', { thumbnail: video.thumbnail, file_name: video.file_name, fileId });
        return;
    }

    console.log(`[Bot] 收到视频: ${video.file_name || '无文件名'} ${video.file_size ? '(' + (video.file_size / 1024 / 1024).toFixed(1) + ' MB)' : ''}`);

    const fileId = video.file_id;
    addFileMapping(fileId, msg.chat.id, msg.message_id, msg.date);
    let title = (msg.caption || '').trim() || video.file_name || 'Telegram 视频';
    const captionMagnet = extractMagnet(msg.caption || '');
    if (captionMagnet) {
        const imageUrl = video.thumbnail ? (await downloadTelegramImage(video.thumbnail.file_id)) || '' : '';
        addPending({ type: 'magnet', url: captionMagnet, title, imageUrl, extraImages: [], messageUrl: extractPostLink(ctx), fileId: fileId || '', fileIds: fileId ? [fileId] : [] });
        console.log(`[Bot] 已加入队列: magnet | ${title}`);
        return;
    }

    let imageUrl = '';
    if (video.thumbnail) {
        imageUrl = await downloadTelegramImage(video.thumbnail.file_id);
    }

    const messageUrl = extractPostLink(ctx);
    addPending({ type: 'video', url: '', title, imageUrl, extraImages: [], messageUrl, fileId: fileId || '', fileIds: fileId ? [fileId] : [] });
    console.log(`[Bot] 已加入队列: video | ${title}${messageUrl ? ' | t.me' : ''}${fileId ? ' | fileId' : ''}`);
});

bot.on(':document', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;

    const doc = ctx.message.document;
    const fileName = (doc.file_name || '').toLowerCase();

    if (!/\.(mp4|avi|mkv|mov|wmv|flv|webm|ts)$/i.test(fileName)) {
        console.log(`[Bot] 文件 ${doc.file_name} 不是视频格式，忽略`);
        return;
    }

    console.log(`[Bot] 收到视频文件: ${doc.file_name} ${doc.file_size ? '(' + (doc.file_size / 1024 / 1024).toFixed(1) + ' MB)' : ''}`);

    const fileId = doc.file_id;
    addFileMapping(fileId, ctx.message.chat.id, ctx.message.message_id, ctx.message.date);
    const title = ctx.message.caption || doc.file_name || 'Telegram 视频文件';
    const messageUrl = extractPostLink(ctx);

    addPending({ type: 'video', url: '', title, imageUrl: '', extraImages: [], messageUrl, fileId: fileId || '', fileIds: fileId ? [fileId] : [] });
    console.log(`[Bot] 已加入队列: video | ${title}${messageUrl ? ' | t.me' : ''}`);
});

bot.catch((err) => {
    console.error('[Bot] 错误:', err.message);
});

// 启动 Bot（长轮询）
bot.start({
    onStart: async () => {
        const me = await bot.api.getMe();
        BOT_USERNAME = me.username || BOT_USERNAME;
        console.log(`[Bot] Telegram Bot 已启动，允许用户 ID: ${ALLOWED_USER_ID || '所有人'}${BOT_USERNAME ? ', bot: @' + BOT_USERNAME : ''}`);
    }
});

// ===== Express HTTP API =====
const app = express();
app.use(express.json());

// 静态资源（卡片缩略图）
app.use('/images', express.static(IMAGES_DIR));

// 获取待消费队列
app.get('/api/pending', (req, res) => {
    const items = loadPending();
    res.json(items);
});

// 消费后删除
app.delete('/api/pending/:id', (req, res) => {
    removePending(req.params.id);
    res.json({ success: true });
});

// 解析 fileId 为可下载 URL（仅限 ≤20MB 的小文件）
app.get('/api/resolve-file/:fileId', async (req, res) => {
    try {
        const file = await bot.api.getFile(req.params.fileId);
        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        res.json({ success: true, downloadUrl, method: 'botapi' });
    } catch (err) {
        if (err.message.includes('file is too big')) {
            res.json({ success: false, error: 'file_too_big', needsTgFallback: true });
        } else {
            res.json({ success: false, error: err.message });
        }
    }
});

// 手动添加条目（供扩展或其他工具调用）
app.post('/api/add', (req, res) => {
    const { type, url, title, imageUrl, extraImages } = req.body;
    if (!type || !url) {
        return res.status(400).json({ error: '缺少 type 或 url' });
    }
    addPending({ type, url, title: title || '未知资源', imageUrl: imageUrl || '', extraImages: extraImages || [] });
    res.json({ success: true });
});

// ===== Telethon 用户登录 =====

// 发送验证码
app.post('/api/telethon/send-code', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: '缺少 phoneNumber' });

    try {
        const client = await getUserClient();
        if (!client) return res.status(503).json({ error: 'API_ID/API_HASH 未配置' });
        if (!client.connected) await client.connect();

        // 检查是否已登录
        if (await client.checkAuthorization()) {
            return res.json({ success: true, alreadyLoggedIn: true });
        }

        const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phoneNumber);
        pendingPhoneCode = { phoneNumber, phoneCodeHash: result.phoneCodeHash };
        console.log(`[用户] 验证码已发送到 ${phoneNumber}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[用户] 发送验证码失败:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// 验证登录
app.post('/api/telethon/sign-in', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少 code' });
    if (!pendingPhoneCode) return res.status(400).json({ error: '请先发送验证码' });

    try {
        const client = await getUserClient();
        if (!client) return res.status(503).json({ error: 'API_ID/API_HASH 未配置' });
        if (!client.connected) await client.connect();

        try {
            const signInResult = await client.invoke(new Api.auth.SignIn({
                phoneNumber: pendingPhoneCode.phoneNumber,
                phoneCodeHash: pendingPhoneCode.phoneCodeHash,
                phoneCode: code,
            }));
            saveUserSession(client);
            pendingPhoneCode = null;
            console.log('[用户] 登录成功');
            res.json({ success: true });
        } catch (signInErr) {
            if (signInErr.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                // 需要两步验证
                pendingPhoneCode = { ...pendingPhoneCode, needs2fa: true };
                res.json({ success: false, error: '2FA 需要密码', needs2fa: true });
            } else {
                throw signInErr;
            }
        }
    } catch (err) {
        console.error('[用户] 登录失败:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// 2FA 密码验证
app.post('/api/telethon/2fa', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '缺少 password' });

    try {
        const client = await getUserClient();
        if (!client) return res.status(503).json({ error: 'API_ID/API_HASH 未配置' });
        if (!client.connected) await client.connect();

        const pwdResult = await client.invoke(new Api.account.GetPassword());
        const pwdCheck = await computeCheck(pwdResult, password);
        await client.invoke(new Api.auth.CheckPassword({ password: pwdCheck }));
        saveUserSession(client);
        console.log('[用户] 2FA 登录成功');
        res.json({ success: true });
    } catch (err) {
        console.error('[用户] 2FA 失败:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// 检查登录状态
app.get('/api/telethon/status', async (req, res) => {
    try {
        const client = await getUserClient();
        if (!client) return res.json({ loggedIn: false });
        const ok = await client.checkAuthorization();
        res.json({ loggedIn: ok });
    } catch {
        res.json({ loggedIn: false });
    }
});

// 注销
app.post('/api/telethon/logout', async (req, res) => {
    try {
        const client = await getUserClient();
        if (client) await client.disconnect();
        if (fs.existsSync(USER_SESSION_FILE)) fs.unlinkSync(USER_SESSION_FILE);
        userClient = null;
        userClientPromise = null;
        console.log('[用户] 已注销');
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ===== 转发消息到 @PikPakBot =====
// 支持两种 fileId:
//   - 普通 Bot API file_id（查 fileMap → findMtprotoMessage）
//   - doc:uuid（查 docMap → 直接用存储的 MTProto 文档信息）
app.post('/api/forward-to-pikpak/:fileId', async (req, res) => {
    const fileId = req.params.fileId;

    let client;
    try {
        client = await getUserClient();
        if (!client) return res.status(503).json({ error: '用户未登录，请先在 Telegram 页面登录' });
        if (!client.connected) await client.connect();
        if (!(await client.checkAuthorization())) {
            return res.status(401).json({ error: '用户 session 已过期，请重新登录' });
        }

        if (fileId.startsWith('doc:')) {
            const docId = fileId.slice(4);
            const docMap = loadDocMap();
            const docEntry = docMap[docId];
            if (!docEntry) {
                console.log(`[转发] ❌ doc:${docId.substring(0, 8)}... 不存在`);
                return res.status(404).json({ error: '文档信息已过期或不存在（请重新解析 t.me 链接）' });
            }
            console.log(`[转发] 处理 doc:${docId.substring(0, 8)}... id=${docEntry.id} file=${docEntry.fileName} msgId=${docEntry.msgId}`);
            await sendDocumentToPikpak(client, {
                id: BigInt(docEntry.id),
                accessHash: BigInt(docEntry.accessHash),
                fileReference: Buffer.from(docEntry.fileReference, 'base64'),
                fileName: docEntry.fileName || '',
                peer: docEntry.peer || '',
                msgId: docEntry.msgId || 0,
                date: docEntry.date || 0,
                mimeType: docEntry.mimeType || 'video/mp4',
                size: docEntry.size || '0',
                dcId: docEntry.dcId || 1,
            });
            removeDocEntry(docId);
            console.log(`[转发] ✅ doc:${docId.substring(0, 8)}... id=${docEntry.id} → ${TARGET_BOT} 成功`);
            res.json({ success: true });
            return;
        }

        // 普通 Bot API file_id
        const map = loadFileMap();
        const entry = map[fileId];
        if (!entry) {
            return res.status(404).json({ error: '找不到该 file_id 对应的消息信息（Bot 重启后需重新发送视频）' });
        }

        console.log(`[转发] ${fileId.substring(0, 20)}... → ${TARGET_BOT} (chatId=${entry.chatId}, msgId=${entry.messageId})`);

        // 通过时间戳查找正确的 MTProto 消息（Bot API msgId 和 MTProto msgId 不同）
        const msg = await findMtprotoMessage(fileId, entry);

        // 使用 InputMediaDocument 直接发送视频文件（跨对话，不重新上传）
        await sendDocumentToPikpak(client, msg.media.document);

        console.log(`[转发] 成功: ${fileId.substring(0, 20)}...`);
        res.json({ success: true });
    } catch (err) {
        console.error(`[转发] 失败: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
});

// ===== 解析 t.me 链接，抓取原文媒体并创建 pending =====
app.post('/api/resolve-tg-link', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少 url' });

    try {
        const { peer, msgId } = parseTgLink(url);
        console.log(`[解析TG] ${url} → peer="${peer}", msgId=${msgId}`);

        const client = await getUserClient();
        if (!client) return res.status(503).json({ error: '用户未登录，请先在 Telegram 页面登录' });
        if (!client.connected) await client.connect();
        if (!(await client.checkAuthorization())) {
            return res.status(401).json({ error: '用户 session 已过期，请重新登录' });
        }

        const entity = await client.getInputEntity(peer);
        const msgs = await client.getMessages(entity, { ids: [msgId] });
        const msg = msgs[0];
        if (!msg) return res.json({ success: false, error: '未找到消息' });

        const restricted = !!(msg.noforwards || (msg._chat && msg._chat.noforwards));
        console.log(`[解析TG] noforwards=${restricted} msg.noforwards=${!!msg.noforwards} chat.noforwards=${!!(msg._chat && msg._chat.noforwards)}`);

        // 收集要处理的消息列表（支持相册）
        let messages = [msg];
        if (msg.groupedId) {
            // 有相册组 ID，取附近消息找出同组所有成员
            // 用 offsetId 获取目标消息前后共 30 条（确保包含同相册其他成员）
            const msgIds = [];
            for (let i = Math.max(1, msgId - 15); i <= msgId + 15; i++) msgIds.push(i);
            const recent = await client.getMessages(entity, { ids: msgIds });
            messages = recent.filter(m => m && String(m.groupedId) === String(msg.groupedId))
                .sort((a, b) => Number(a.id) - Number(b.id));
            console.log(`[解析TG] 检测到相册，共 ${messages.length} 条` + (messages.length > 1 ? ` (${messages[0].id}~${messages[messages.length-1].id})` : ''));
        }

        // 从所有相册消息中找文字
        let text = '';
        for (const m of messages) {
            if (m.message) { text = m.message; break; }
        }
        text ||= msg.message || '';
        const magnetLink = extractMagnet(text);
        const title = extractTitle(text, magnetLink) || 'Telegram 消息';
        const messageUrl = url;

        let imageUrl = '';
        let extraImages = [];
        let videoCount = 0;
        let fileIds = [];

        for (const m of messages) {
            if (!m.media) continue;

            if (m.media.photo) {
                const imgUrl = await downloadMediaViaGramjs(client, m);
                if (imgUrl) {
                    if (!imageUrl) imageUrl = imgUrl;
                    else if (extraImages.length < 6) extraImages.push(imgUrl);
                }
            } else if (m.media.document) {
                const doc = m.media.document;
                if (!doc.mimeType?.startsWith('video/')) continue;

                videoCount++;
                const docId = addDocEntry(doc, { peer: String(peer), msgId: m.id });
                fileIds.push('doc:' + docId);
                // 下载最大尺寸缩略图
                const thumbCount = (doc.thumbs || []).length;
                for (let idx = thumbCount - 1; idx >= 0; idx--) {
                    const thumbUrl = await downloadMediaViaGramjs(client, m, { thumb: idx });
                    if (thumbUrl) {
                        if (!imageUrl) { imageUrl = thumbUrl; }
                        else if (extraImages.length < 6) extraImages.push(thumbUrl);
                        break;
                    }
                }
            }
        }

        // 如果已存在同 groupedId 的 pending card，跳过创建
        const groupedId = msg.groupedId ? String(msg.groupedId) : '';
        if (groupedId) {
            const existing = loadPending().find(p => p.groupedId && String(p.groupedId) === groupedId);
            if (existing) {
                const vc = (existing.fileIds || []).length;
                return res.json({ success: true, pendingCreated: false, message: `该相册已在列表中（${vc} 个视频）` });
            }
        }

        const pendingMessage = videoCount > 0
            ? `检测到 ${videoCount} 个视频，可点击离线按钮转发到 PikPak`
            : (imageUrl ? '已获取图片' : '');
        const type = magnetLink ? 'magnet' : 'video';

        addPending({
            type,
            url: magnetLink || '',
            title,
            imageUrl,
            extraImages,
            messageUrl,
            fileId: fileIds[0] || '',
            fileIds,
            groupedId,
            restricted
        });

        console.log(`[解析TG] 成功: ${url} → ${title}${videoCount ? ' (转发' + videoCount + '视频)' : ''}${restricted ? ' [私密频道]' : ''}`);
        res.json({ success: true, pendingCreated: true, message: pendingMessage, restricted });

    } catch (err) {
        console.error('[解析TG] 失败:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

const server = app.listen(PORT, () => {
    console.log(`[Bot] HTTP API 运行在 http://localhost:${PORT}`);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n[Bot] 正在关闭...');
    bot.stop();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    bot.stop();
    server.close(() => process.exit(0));
});
