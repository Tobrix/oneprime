const fastify = require('fastify')({ logger: false });
const axios   = require('axios');
const xml2js  = require('xml2js');
const path    = require('path');

fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, ''),
    prefix: '/',
});

// ══════════════════════════════════════════
// EPG CACHE — dvě TV, dva zdroje
// ══════════════════════════════════════════
const epgCache = {
    oneprime: [],  // z 94.241.90.115:8889/epg
    sejvi:    [],  // z mojetv.xyz:4000 (XMLTV URL z playlistu)
};

const ONEPRIME_EPG_URL = 'http://94.241.90.115:8889/epg';
const SEJVI_EPG_URL    = 'http://mojetv.xyz:4000/xmltv.php?username=sejviczthoms&password=SejviCZthoms1122@';

async function loadEPG(tv) {
    const url = tv === 'oneprime' ? ONEPRIME_EPG_URL : SEJVI_EPG_URL;
    try {
        console.log(`⏳ EPG [${tv}] načítám z ${url}`);
        const res    = await axios.get(url, { timeout: 30000 });
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(res.data);
        if (result.tv && result.tv.programme) {
            epgCache[tv] = result.tv.programme;
            console.log(`✅ EPG [${tv}] — ${epgCache[tv].length} pořadů`);
        }
    } catch (err) {
        console.error(`❌ EPG [${tv}] chyba:`, err.message);
    }
}

// Načíst EPG při startu a pak každou hodinu
loadEPG('oneprime');
loadEPG('sejvi');
setInterval(() => loadEPG('oneprime'), 60 * 60 * 1000);
setInterval(() => loadEPG('sejvi'),    60 * 60 * 1000);

// ══════════════════════════════════════════
// EPG ENDPOINT — ?id=&tv=oneprime|sejvi
// ══════════════════════════════════════════
fastify.get('/epg-data', async (request, reply) => {
    const queryId  = decodeURIComponent(request.query.id || '');
    const tv       = request.query.tv || 'oneprime';
    const isFull   = request.query.full === 'true';
    const queryDate= request.query.date;

    const programmes = epgCache[tv] || [];

    if (!queryId || programmes.length === 0) {
        return isFull ? [] : { title: 'Program není k dispozici' };
    }

    const channelProgs = programmes.filter(p => p.$.channel === queryId);

    const formatProg = (p) => ({
        title: (typeof p.title[0] === 'object') ? p.title[0]._ : p.title[0],
        desc:  p.desc  ? ((typeof p.desc[0]  === 'object') ? p.desc[0]._  : p.desc[0])  : '',
        start: p.$.start,
        stop:  p.$.stop,
        image: (p.icon && p.icon[0].$) ? p.icon[0].$.src : '',
    });

    if (isFull) {
        if (queryDate) {
            return channelProgs.filter(p =>
                p.$.start.startsWith(queryDate) || p.$.stop.startsWith(queryDate)
            ).map(formatProg);
        }
        return channelProgs.map(formatProg);
    }

    // Current program
    const now = new Date();
    const czTime = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const t = {};
    czTime.forEach(({ type, value }) => t[type] = value);
    const nowStr = `${t.year}${t.month}${t.day}${t.hour}${t.minute}${t.second}`;

    reply.header('Cache-Control', 'no-store');

    const current = channelProgs.find(p => {
        const s = p.$.start.split(' ')[0];
        const e = p.$.stop.split(' ')[0];
        return nowStr >= s && nowStr <= e;
    });
    if (current) return formatProg(current);

    const upcoming = channelProgs.find(p => p.$.start.split(' ')[0] > nowStr);
    return upcoming ? formatProg(upcoming) : { title: 'Program není k dispozici' };
});

// ══════════════════════════════════════════
// PROXY — OnePrime (94.241.90.115:8889)
// ══════════════════════════════════════════
const oneprime_opts = {
    rewriteRequestHeaders: (req, headers) => ({
        ...headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
        'host': '94.241.90.115:8889',
        'connection': 'keep-alive',
    }),
    getUpstream: (req, base) => base,
    undici: { bodyTimeout: 0, headersTimeout: 0, keepAliveTimeout: 60000 },
};

fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/oneplay',
    replyOptions: oneprime_opts,
});
fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/play',
    replyOptions: oneprime_opts,
});

// ══════════════════════════════════════════
// PROXY — Sejvi (mojetv.xyz:4000)
// ══════════════════════════════════════════
const sejvi_opts = {
    rewriteRequestHeaders: (req, headers) => ({
        ...headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
        'host': 'mojetv.xyz:4000',
        'connection': 'keep-alive',
    }),
    undici: { bodyTimeout: 0, headersTimeout: 0, keepAliveTimeout: 60000 },
};

fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://mojetv.xyz:4000',
    prefix: '/sejvi',
    replyOptions: sejvi_opts,
});

// ══════════════════════════════════════════
// PLAYLIST ENDPOINT — vrátí playlist pro danou TV
// Sejvi playlist se stahuje dynamicky (vždy čerstvý)
// ══════════════════════════════════════════
fastify.get('/playlist/:tv', async (request, reply) => {
    const tv = request.params.tv;
    if (tv === 'oneprime') {
        // Vrátit lokální playlist.m3u (přes static files)
        return reply.redirect('/playlist.m3u');
    }
    if (tv === 'sejvi') {
        try {
            const res = await axios.get(
                'http://mojetv.xyz:4000/get.php?username=sejviczthoms&password=SejviCZthoms1122@&type=m3u_plus&output=ts',
                { timeout: 15000, responseType: 'text' }
            );
            reply.header('Content-Type', 'application/x-mpegurl');
            return reply.send(res.data);
        } catch (err) {
            reply.status(502).send({ error: 'Nelze načíst Sejvi playlist: ' + err.message });
        }
    }
    reply.status(404).send({ error: 'Neznámá TV' });
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
