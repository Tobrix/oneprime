'use strict';
const fastify = require('fastify')({ logger: false });
const axios   = require('axios');
const xml2js  = require('xml2js');
const path    = require('path');

fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, ''),
    prefix: '/',
});

// ── EPG ───────────────────────────────────
let cachedEpg = [];
const EPG_URL = 'http://193.109.193.16:4300/xml/sejviczthoms/SejviCZthoms1122@/epg.xml';

async function updateEpg() {
    try {
        console.log('⏳ Stahuji EPG...');
        const res = await axios.get(EPG_URL, { timeout: 30000 });
        const result = await new xml2js.Parser().parseStringPromise(res.data);
        if (result.tv?.programme) {
            cachedEpg = result.tv.programme;
            console.log(`✅ EPG: ${cachedEpg.length} pořadů`);
        }
    } catch (err) {
        console.error('❌ EPG:', err.message);
    }
}
updateEpg();
setInterval(updateEpg, 60 * 60 * 1000);

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
        timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
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

// ── PLAYLIST ENDPOINT ─────────────────────
// Stahuje živě z poskytovatele a vrací klientovi
fastify.get('/get-playlist', async (request, reply) => {
    try {
        const res = await axios.get(
            'http://mojetv.blogsite.org:4300/get.php?username=sejviczthoms&password=SejviCZthoms1122@&type=m3u_plus&output=ts',
            { timeout: 20000, responseType: 'text' }
        );
        reply.header('Content-Type', 'application/x-mpegurl');
        reply.header('Cache-Control', 'no-store');
        return reply.send(res.data);
    } catch (err) {
        console.error('Playlist error:', err.message);
        return reply.code(502).send('Nelze načíst playlist');
    }
});

// ── STREAM PROXY ─────────────────────────
// Proxuje streamy z 193.109.193.16:3000 (raw MPEG-TS)
// Bez proxy by prohlížeč dostal CORS chybu
const STREAM_HOST = 'http://193.109.193.16:3000';

fastify.all('/stream/*', async (request, reply) => {
    const downstream = request.url.slice('/stream'.length);
    const upstreamUrl = STREAM_HOST + downstream;
    try {
        const upRes = await axios({
            method: 'GET',
            url: upstreamUrl,
            responseType: 'stream',
            timeout: 0,
            headers: {
                'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
                'Connection': 'keep-alive',
                'Accept': '*/*',
                ...(request.headers.range ? { 'Range': request.headers.range } : {}),
            },
            maxRedirects: 5,
        });
        reply.code(upRes.status);
        const skip = new Set(['transfer-encoding', 'connection', 'host']);
        for (const [k, v] of Object.entries(upRes.headers)) {
            if (!skip.has(k.toLowerCase())) reply.header(k, v);
        }
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Content-Type', 'video/mp2t');
        return reply.send(upRes.data);
    } catch (err) {
        const code = err.response?.status || 502;
        console.error(`[stream] ${upstreamUrl} → ${code}: ${err.message}`);
        return reply.code(code).send({ error: err.message });
    }
});

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
