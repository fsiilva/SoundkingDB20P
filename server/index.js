import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transport } from './transport.js';
import { SEND_COMMANDS, SEND_PROTO_GUESS, RECEIVE_HANDLERS, ENM_COMMAND } from './commands.js';
import { eqCurve, simulatedSpectrum, suggestions } from './analyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const envAllowed = process.env.ALLOWED_ORIGINS;
  if (envAllowed) {
    if (envAllowed === '*') return true;
    const origins = envAllowed.split(',').map(s => s.trim().toLowerCase());
    if (origins.includes(origin.toLowerCase())) return true;
  }

  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (hostHeader && originUrl.host.toLowerCase() === hostHeader.toLowerCase()) {
      return true;
    }
  } catch {}

  try {
    const originUrl = new URL(origin);
    const hostname = originUrl.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
    ) {
      return true;
    }
  } catch {}

  return false;
}

function serveStaticFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Método não permitido.');
  }

  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Frontend ainda não foi compilado. Execute "npm run build".');
  }

  let decodedPath = '/';
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Caminho inválido.');
  }

  let safeRelative = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, '');
  if (safeRelative.startsWith('/') || safeRelative.startsWith('\\')) {
    safeRelative = safeRelative.slice(1);
  }

  let filePath = path.join(DIST_DIR, safeRelative);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Acesso negado.');
  }

  let stat = null;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
  } catch {
    const hasExt = path.extname(decodedPath).length > 0;
    if (!hasExt) {
      filePath = path.join(DIST_DIR, 'index.html');
      try {
        stat = fs.statSync(filePath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Frontend não encontrado.');
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Arquivo não encontrado.');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isImmutable = decodedPath.startsWith('/assets/');
  const cacheControl = isImmutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro ao ler arquivo.');
    }
  });
  stream.pipe(res);
}

const transport = new Transport();
try { transport.simulateOffline(); } catch (e) { console.warn('Simulação offline inicial não carregada:', e.message); }

const server = http.createServer(async (req, res) => {
  const reply = (code, data) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(code);
    res.end(JSON.stringify(data));
  };

  if (!isOriginAllowed(req)) {
    return reply(403, { error: 'Origem não autorizada.' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site' && !isOriginAllowed(req)) {
    return reply(403, { error: 'Origem não autorizada.' });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    if (req.headers.origin && isOriginAllowed(req)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    // Healthcheck endpoint (ideal for Docker & Easypanel)
    if (pathname === '/api/health' || pathname === '/health') {
      return reply(200, {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        transport: transport.state.status,
        meterStatus: transport.state.meterStatus,
        timestamp: new Date().toISOString(),
      });
    }

    // Static assets & frontend serving for any non-API request
    if (!pathname.startsWith('/api/')) {
      return serveStaticFile(req, res, pathname);
    }

    if (req.method === 'GET') {
      if (pathname === '/api/transport') return reply(200, transport.state);
      if (pathname === '/api/meters') return reply(200, transport.state.meters || { channels: [] });

      if (pathname === '/api/meta') {
        return reply(200, {
          schema_checks: { eq_bands: true, gate: true, comp: true, output: true },
          confirmado: {
            tcp_port: 6400,
            meter_port: 6401,
            host_padrao: process.env.DEFAULT_MIXER_HOST || '192.168.18.162',
            sync: '0x5A',
            cmd_id: 'int32 big-endian',
            header_size: 14,
          },
          flags: {
            write_enabled: transport.allowChannel1Write,
            allow_network: transport.allowChannel1Write,
            allow_read: transport.allowRead,
            meters_real: transport.state.meterStatus === 'connected',
          },
          permissions: transport.state.permissions,
          capabilities: transport.state.capabilities,
          commands: SEND_COMMANDS,
          receive_handlers: RECEIVE_HANDLERS,
          enm_command: ENM_COMMAND,
          status: transport.state.status,
          aviso: `Leitura real ${transport.allowRead ? 'HABILITADA' : 'desativada'}; faders autorizados ${transport.allowChannel1Write ? 'ATIVOS' : 'bloqueados'}.`,
        });
      }

      if (pathname === '/api/eqcurve') {
        let bands = [];
        try {
          bands = JSON.parse(url.searchParams.get('bands') || '[]');
        } catch {}
        return reply(200, { curve: eqCurve(bands) });
      }

      if (pathname === '/api/spectrum') {
        const seed = parseInt(url.searchParams.get('seed') || '0', 10);
        return reply(200, simulatedSpectrum(seed));
      }

      if (pathname === '/api/suggest') {
        const obj = url.searchParams.get('obj');
        const seed = parseInt(url.searchParams.get('seed') || '0', 10);
        const spec = simulatedSpectrum(seed);
        return reply(200, suggestions(spec.pontos, obj));
      }

      if (pathname === '/api/meters/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        if (transport.state.meters) {
          res.write(`data: ${JSON.stringify(transport.state.meters)}\n\n`);
        }
        const onMeters = d => {
          try {
            res.write(`data: ${JSON.stringify(d)}\n\n`);
          } catch {}
        };
        transport.on('meters', onMeters);
        req.on('close', () => {
          transport.off('meters', onMeters);
        });
        return;
      }
    }

    if (req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/json') {
        return reply(415, { error: 'Use application/json.' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536) return reply(413, { error: 'Corpo muito grande.' });
      }
      const parsed = body ? JSON.parse(body) : {};

      if (pathname === '/api/connect') return reply(200, await transport.connect(parsed));
      if (pathname === '/api/fader/start') return reply(200, await transport.realtime.start(parsed));
      if (pathname === '/api/fader/move') return reply(200, transport.realtime.move(parsed));
      if (pathname === '/api/fader/end') return reply(200, await transport.realtime.end(parsed));
      if (pathname === '/api/channel/control') return reply(200, await transport.applyChannelControl(parsed));
      if (pathname === '/api/channel/eq') return reply(200, await transport.applyChannelEq(parsed));
      if (pathname === '/api/channel/dynamic') return reply(200, await transport.applyChannelDynamic(parsed));
      if (pathname === '/api/channel/input') return reply(200, await transport.applyChannelInput(parsed));
      if (pathname === '/api/master') return reply(200, await transport.applyMaster(parsed));
      if (pathname === '/api/bus-send') return reply(200, await transport.applyBusSend(parsed));
      if (pathname === '/api/channel1-control') return reply(200, await transport.applyChannel1(parsed));
      if (pathname === '/api/channel1-fader') return reply(200, await transport.stepChannel1(parsed));
      if (pathname === '/api/mute-group') return reply(200, await transport.applyMuteGroup(parsed));
      if (pathname === '/api/apply-scene') return reply(200, await transport.applyScene(parsed));
      if (pathname === '/api/simulate-snapshot') return reply(200, transport.simulateOffline());
      if (pathname === '/api/start-sync') return reply(200, transport.startAutoRead());
      if (pathname === '/api/read-snapshot') return reply(200, transport.requestSnapshot());
      if (pathname === '/api/disconnect') {
        transport.disconnect();
        return reply(200, transport.state);
      }
    }

    reply(404, { error: 'Rota indisponível. Envio de comandos não implementado.' });
  } catch (e) {
    reply(400, { error: e.message });
  }
});

export { server, transport, isOriginAllowed };

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT);

if (!isTest) {

  const PORT = parseInt(process.env.PORT || '8787', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  server.listen(PORT, HOST, () => {
    console.log(`Ponte TCP/UDP Soundking DB20P e Web App ativos: http://${HOST}:${PORT}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      transport.disconnect();
      server.close(() => process.exit(0));
    });
  }
}


