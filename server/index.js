import http from 'node:http';
import { Transport } from './transport.js';
import { SEND_COMMANDS, SEND_PROTO_GUESS, RECEIVE_HANDLERS, ENM_COMMAND } from './commands.js';
import { eqCurve, simulatedSpectrum, suggestions } from './analyzer.js';

const transport = new Transport();

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const reply = (code, data) => {
    res.writeHead(code);
    res.end(JSON.stringify(data));
  };

  const origin = req.headers.origin;
  if (origin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) {
    return reply(403, { error: 'Origem não autorizada.' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return reply(403, { error: 'Origem não autorizada.' });
  }

  try {
    const url = new URL(req.url, 'http://127.0.0.1:8787');
    const pathname = url.pathname;

    if (req.method === 'GET') {
      if (pathname === '/api/transport') return reply(200, transport.state);
      if (pathname === '/api/meters') return reply(200, transport.state.meters || { channels: [] });

      if (pathname === '/api/meta') {
        return reply(200, {
          schema_checks: { eq_bands: true, gate: true, comp: true, output: true },
          confirmado: {
            tcp_port: 6400,
            meter_port: 6401,
            host_padrao: '192.168.18.162',
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
        if (body.length > 4096) return reply(413, { error: 'Corpo muito grande.' });
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

server.listen(8787, '127.0.0.1', () => console.log('Ponte TCP/UDP: http://127.0.0.1:8787'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    transport.disconnect();
    server.close(() => process.exit(0));
  });
}
