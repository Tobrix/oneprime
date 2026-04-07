'use strict';
const fastify = require('fastify')({ logger: false });
const axios   = require('axios');
const xml2js  = require('xml2js');
const path    = require('path');
const http    = require('http');
const https   = require('https');

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
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(res.data);
        if (result.tv && result.tv.programme) {
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

    if (!queryId || cachedEpg.length === 0) {
        return isFull ? [] : { title: 'Program není k dispozici' };
    }

    const progs = cachedEpg.filter(p => p.$.channel === queryId);

    const fmt = (p) => ({
        title: (typeof p.title[0] === 'object') ? p.title[0]._ : p.title[0],
        desc:  p.desc  ? ((typeof p.desc[0]  === 'object') ? p.desc[0]._  : p.desc[0])  : '',
        start: p.$.start,
        stop:  p.$.stop,
        image: (p.icon && p.icon[0].$) ? p.icon[0].$.src : '',
    });

    if (isFull) {
        const list = queryDate
            ? progs.filter(p => p.$.start.startsWith(queryDate) || p.$.stop.startsWith(queryDate))
            : progs;
        return list.map(fmt);
    }

    // Aktuální pořad
    const czParts = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,
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

// ── MANUAL PROXY — správně forwarduje query string ──
// @fastify/http-proxy v10 má problém s query params při prefix strippingu.
// Tato implementace explicitně přenáší celou URL včetně query stringu.

const UPSTREAM = 'http://94.241.90.115:8889';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0';

function makeProxy(prefix) {
    // Wildcard route zachytí vše včetně query stringů
    fastify.all(`${prefix}/*`, { config: { rawBody: true } }, async (request, reply) => {
        // Strip prefix a zachovat zbytek URL + query string
        const stripped = request.url.slice(prefix.length);
        const upstreamUrl = UPSTREAM + stripped;

        try {
            const agent = new http.Agent({ keepAlive: true });
            const upRes = await axios({
                method: request.method,
                url: upstreamUrl,
                headers: {
                    ...request.headers,
                    'host': '94.241.90.115:8889',
                    'User-Agent': UA,
                    'connection': 'keep-alive',
                },
                responseType: 'stream',
                timeout: 0,   // bez timeoutu pro streamy
                httpAgent: agent,
                maxRedirects: 5,
            });

            // Forward response headers
            const skipHeaders = ['transfer-encoding', 'content-encoding'];
            Object.entries(upRes.headers).forEach(([k, v]) => {
                if (!skipHeaders.includes(k.toLowerCase())) reply.header(k, v);
            });
            reply.code(upRes.status);

            // CORS pro HLS
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Access-Control-Allow-Headers', '*');

            return reply.send(upRes.data);
        } catch (err) {
            const status = err.response?.status || 502;
            console.error(`Proxy error [${prefix}]: ${upstreamUrl} → ${status} ${err.message}`);
            return reply.code(status).send({ error: err.message });
        }
    });
}

makeProxy('/oneplay');
makeProxy('/play');

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
