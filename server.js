'use strict';
const fastify  = require('fastify')({ logger: false });
const axios    = require('axios');
const xml2js   = require('xml2js');
const path     = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, ''),
    prefix: '/',
});

// ── EPG CACHE ─────────────────────────────
let cachedEpg = [];

async function updateEpg() {
    try {
        console.log('⏳ Stahuji EPG...');
        const res = await axios.get('http://94.241.90.115:8889/epg', { timeout: 30000 });
        const result = await new xml2js.Parser().parseStringPromise(res.data);
        if (result.tv?.programme) {
            cachedEpg = result.tv.programme;
            console.log(`✅ EPG: ${cachedEpg.length} pořadů`);
        }
    } catch (err) {
        console.error('❌ EPG chyba:', err.message);
    }
}
updateEpg();
setInterval(updateEpg, 60 * 60 * 1000);

// ── EPG ENDPOINT ──────────────────────────
fastify.get('/epg-data', async (request, reply) => {
    const queryId   = decodeURIComponent(request.query.id || '');
    const isFull    = request.query.full === 'true';
    const queryDate = request.query.date;

    if (!queryId || !cachedEpg.length)
        return isFull ? [] : { title: 'Program není k dispozici' };

    const progs = cachedEpg.filter(p => p.$.channel === queryId);
    const fmt = p => ({
        title: typeof p.title[0] === 'object' ? p.title[0]._ : p.title[0],
        desc:  p.desc ? (typeof p.desc[0] === 'object' ? p.desc[0]._ : p.desc[0]) : '',
        start: p.$.start, stop: p.$.stop,
        image: p.icon?.[0]?.$?.src || '',
    });

    if (isFull) {
        const list = queryDate
            ? progs.filter(p => p.$.start.startsWith(queryDate) || p.$.stop.startsWith(queryDate))
            : progs;
        return list.map(fmt);
    }

    const czParts = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
    }).formatToParts(new Date());
    const t = {};
    czParts.forEach(({ type, value }) => t[type] = value);
    const nowStr = `${t.year}${t.month}${t.day}${t.hour}${t.minute}${t.second}`;

    reply.header('Cache-Control', 'no-store');
    const current = progs.find(p => {
        const s = p.$.start.split(' ')[0], e = p.$.stop.split(' ')[0];
        return nowStr >= s && nowStr <= e;
    });
    if (current) return fmt(current);
    const upcoming = progs.find(p => p.$.start.split(' ')[0] > nowStr);
    return upcoming ? fmt(upcoming) : { title: 'Program není k dispozici' };
});

// ── STREAM PROXY ──────────────────────────
// Přímé pipe upstream → client, bez bufferování do paměti.
// Zachovává query string (utc=, lutc=) který @fastify/http-proxy někdy zahazuje.

const UPSTREAM = 'http://94.241.90.115:8889';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0';

function registerProxy(prefix) {
    fastify.all(`${prefix}/*`, async (request, reply) => {
        // Zachovat celou cestu + query string, odebrat jen prefix
        const downstream = request.url.slice(prefix.length); // napr. /play/Nova%20HD.m3u8?utc=...
        const upstreamUrl = UPSTREAM + downstream;

        try {
            const upRes = await axios({
                method:       request.method || 'GET',
                url:          upstreamUrl,
                responseType: 'stream',           // ← klíčové: nefBufferovat
                timeout:      0,                  // bez timeoutu pro HLS segmenty
                headers: {
                    'host':        '94.241.90.115:8889',
                    'user-agent':  UA,
                    'accept':      '*/*',
                    'connection':  'keep-alive',
                    // Přenést range header pokud existuje (pro HTTP range requests)
                    ...(request.headers.range ? { range: request.headers.range } : {}),
                },
                maxRedirects: 5,
            });

            // Přenést status a headers
            reply.code(upRes.status);
            const skip = new Set(['transfer-encoding', 'content-encoding', 'host', 'connection']);
            for (const [k, v] of Object.entries(upRes.headers)) {
                if (!skip.has(k.toLowerCase())) reply.header(k, v);
            }
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'no-store');

            // Pipe stream přímo na response — bez bufferování
            return reply.send(upRes.data);

        } catch (err) {
            const code = err.response?.status || 502;
            console.error(`[proxy ${prefix}] ${upstreamUrl} → ${code}: ${err.message}`);
            return reply.code(code).send({ error: err.message, url: upstreamUrl });
        }
    });
}

registerProxy('/oneplay');
registerProxy('/play');

// Start
const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await fastify.listen({ port: parseInt(port), host: '0.0.0.0' });
        console.log(`🚀 Server běží na portu ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
