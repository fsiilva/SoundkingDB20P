import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from './transport.js';

test('permissão de leitura desativada impede requestSnapshot e startAutoRead', () => {
  const t = new Transport({ allowRead: false, allowChannel1Write: false });
  assert.equal(t.state.permissions.allowRead, false);
  assert.equal(t.state.permissions.writeEnabled, false);

  // Leitura pontual deve falhar explicitamente
  assert.throws(
    () => t.requestSnapshot(),
    /Leitura de rede desativada/
  );

  // Leitura automática deve falhar explicitamente
  assert.throws(
    () => t.startAutoRead(),
    /Leitura de rede desativada/
  );
});

test('permissão de leitura não habilita escrita física arbitrária', () => {
  const t = new Transport({ allowRead: true, allowChannel1Write: false });
  assert.equal(t.state.permissions.allowRead, true);
  assert.equal(t.state.permissions.writeEnabled, false);
  assert.equal(t.state.capabilities.faders, false);
  assert.equal(t.state.capabilities.channel1Fader, false);

  // Tentativa de arraste em tempo real sem permissão de escrita deve ser rejeitada
  assert.rejects(
    () => t.realtime.start({ key: 'in1Model.ch1Model', expectedRaw: 500 }),
    /Escrita não habilitada/
  );
});

test('permissões são relatadas com precisão no estado do transporte', () => {
  const tDefault = new Transport();
  assert.equal(typeof tDefault.state.permissions.allowRead, 'boolean');
  assert.equal(typeof tDefault.state.permissions.writeEnabled, 'boolean');
  assert.equal(tDefault.state.capabilities.maxLiveFaderRaw, 1000);
});
