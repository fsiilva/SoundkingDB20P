import test from 'node:test';
import assert from 'node:assert/strict';
import { server, isOriginAllowed } from './index.js';

test('isOriginAllowed valida origens locais, same-host e bloqueia invasores', () => {
  // Sem header origin (acesso direto ou same-origin GET)
  assert.equal(isOriginAllowed({ headers: {} }), true);

  // Localhost em portas variadas
  assert.equal(isOriginAllowed({ headers: { origin: 'http://localhost:5173' } }), true);
  assert.equal(isOriginAllowed({ headers: { origin: 'http://127.0.0.1:8787' } }), true);

  // IP de rede local
  assert.equal(isOriginAllowed({ headers: { origin: 'http://192.168.1.100:8787' } }), true);
  assert.equal(isOriginAllowed({ headers: { origin: 'http://10.0.0.5:3000' } }), true);

  // Same-host via Host ou X-Forwarded-Host (ex: Easypanel Traefik)
  assert.equal(
    isOriginAllowed({
      headers: {
        origin: 'https://mesa.easypanel.host',
        'x-forwarded-host': 'mesa.easypanel.host',
      },
    }),
    true
  );

  // Terceiro não autorizado
  assert.equal(isOriginAllowed({ headers: { origin: 'https://site-malicioso.com' } }), false);
});

test('servidor HTTP responde healthcheck e rotas estáticas/API', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Healthcheck
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.ok(typeof healthData.uptime === 'number');

    // 2. API meta
    const metaRes = await fetch(`${baseUrl}/api/meta`);
    assert.equal(metaRes.status, 200);
    const metaData = await metaRes.json();
    assert.equal(metaData.confirmado.tcp_port, 6400);

    // 3. Servir frontend (index.html)
    const frontRes = await fetch(`${baseUrl}/`);
    assert.equal(frontRes.status, 200);
    const contentType = frontRes.headers.get('content-type');
    assert.ok(contentType?.includes('text/html'));
    const html = await frontRes.text();
    assert.ok(html.includes('<html') || html.includes('<!DOCTYPE html>'));

    // 4. Rota inexistente da API retorna 404 JSON
    const notFoundApi = await fetch(`${baseUrl}/api/rota-inexistente`);
    assert.equal(notFoundApi.status, 404);
    const notFoundData = await notFoundApi.json();
    assert.ok(notFoundData.error);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
