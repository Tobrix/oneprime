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
        console.error('❌ EPG:', err.message);
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

// ── PLAYLIST PROXY ────────────────────────
fastify.get('/get-playlist', async (request, reply) => {
    try {
        const res = await axios.get('http://94.241.90.115:8889/playlist', {
            timeout: 10000,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
            }
        });
        reply.header('Content-Type', 'application/x-mpegurl; charset=utf-8');
        reply.header('Cache-Control', 'no-store');
        return reply.send(res.data);
    } catch (err) {
        console.warn('Playlist live fetch failed, using local fallback:', err.message);
        try {
            const fs = require('fs');
            const local = fs.readFileSync(path.join(__dirname, 'playlist.m3u'), 'utf-8');
            reply.header('Content-Type', 'application/x-mpegurl; charset=utf-8');
            return reply.send(local);
        } catch (e) {
            return reply.code(502).send('Playlist nedostupný');
        }
    }
});

// ── STREAM PROXY (stabilní @fastify/http-proxy) ───────────
// Klíčové pro iOS a dlouhé HLS streamy — undici s neomezeným timeoutem
const UPSTREAM = 'http://94.241.90.115:8889';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0';

const proxyOpts = {
    upstream: UPSTREAM,
    replyOptions: {
        rewriteRequestHeaders: (req, headers) => ({
            ...headers,
            'User-Agent': UA,
            'host': '94.241.90.115:8889',
            'connection': 'keep-alive',
        }),
        undici: {
            bodyTimeout: 0,
            headersTimeout: 0,
            keepAliveTimeout: 60000,
        }
    }
};

fastify.register(require('@fastify/http-proxy'), {
    ...proxyOpts,
    prefix: '/oneplay',
});

fastify.register(require('@fastify/http-proxy'), {
    ...proxyOpts,
    prefix: '/play',
});

// ── START ─────────────────────────────────
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
