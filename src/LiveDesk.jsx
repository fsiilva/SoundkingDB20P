import LiveFader from './LiveFader';
import { displayAppDb } from './faderScale';
import Channel1Fader from './Channel1Fader';
import React, { useState } from 'react';
import { Radio, RefreshCw, ShieldCheck, Volume2, SlidersHorizontal, Activity, AudioLines, Zap, Check } from 'lucide-react';
import { useDesk } from './DeskContext';
import { deskStatus } from './deskStatus';

const number = v => typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : v === null || v === undefined ? '—' : String(v);

export function DeskConnectionBar() {
  const { state, error, busy, action } = useDesk();
  const [host, setHost] = useState('192.168.18.162');
  const status = deskStatus(state);

  return (
    <section className="desk-connection">
      <div>
        <Radio size={20} />
        <div>
          <strong>{status.label}</strong>
          <small>
            {state?.snapshot
              ? `Última leitura: ${new Date(state.snapshot.receivedAt).toLocaleTimeString('pt-BR')} · ${state.autoRead ? 'atualização a cada 6 s' : 'leitura automática pausada'}`
              : 'Conecte para receber e controlar os canais da DB20P.'}
          </small>
        </div>
      </div>
      <div className="actions">
        <label>
          IP da mesa
          <input aria-label="IP da mesa para conexão" value={host} onChange={e => setHost(e.target.value)} />
        </label>
        <button disabled={busy || state?.writeInProgress} onClick={() => action('connect', { protocol: 'tcp', host, port: 6400, autoRead: true })}>
          {busy ? 'Aguarde…' : status.connected ? 'Reconectar' : 'Conectar à mesa'}
        </button>
        {status.connected && (
          <>
            <button disabled={busy || state.readPending || state.autoRead} onClick={() => action('start-sync')}>
              <RefreshCw size={14} />
              {state.autoRead ? 'Atualização ativa' : 'Atualizar automaticamente'}
            </button>
            <button disabled={busy || state?.writeInProgress} onClick={() => action('disconnect')}>
              Desconectar
            </button>
          </>
        )}
      </div>
      {(error || state?.error || state?.decodeError || state?.snapshotError) && (
        <p className="connection-error" role="alert">{error || state.error || state.decodeError || state.snapshotError}</p>
      )}
    </section>
  );
}

export default function LiveDesk({ tab }) {
  const { state, meters, busy, action } = useDesk();
  const [bank, setBank] = useState(0);
  const [selected, setSelected] = useState('in1Model.ch1Model');
  const [msg, setMsg] = useState('');
  const [panDraft, setPanDraft] = useState({});

  const status = deskStatus(state);
  const snapshot = state?.snapshot;
  const channels = snapshot?.channels || [];
  const channel = channels.find(ch => ch.key === selected) || channels[0];
  const parts = channel?.key?.split('.') || [];
  const rawChannel = channel ? snapshot?.raw?.[parts[0]]?.[parts[1]] : null;
  const masterOut = snapshot?.raw?.busModel?.outBusLRModel?.outputModel;

  const showMsg = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  if (!snapshot) {
    return (
      <section className="panel empty-live">
        <Radio size={36} />
        <h2>{status.connected ? 'Aguardando a primeira leitura…' : 'Conecte a DB20P para abrir o mixer real'}</h2>
        <p>Use “Conectar à mesa” acima. Os canais aparecerão quando o equipamento responder.</p>
        <p>Você pode testar e explorar os controles na opção Demonstração enquanto a mesa física não estiver conectada.</p>
      </section>
    );
  }

  const toggleMute = async ch => {
    const next = !ch.mute;
    await action('channel/control', { key: ch.key, moduleId: ch.moduleId, field: 'isMuteEnable', value: next });
    showMsg(`${ch.name}: Mute ${next ? 'LIGADO' : 'DESLIGADO'}`);
  };

  const toggleSolo = async ch => {
    const next = !ch.solo;
    await action('channel/control', { key: ch.key, moduleId: ch.moduleId, field: 'isSoloEnable', value: next });
    showMsg(`${ch.name}: Solo ${next ? 'LIGADO' : 'DESLIGADO'}`);
  };

  const toggleLR = async ch => {
    const next = !(ch.lr ?? true);
    await action('channel/control', { key: ch.key, moduleId: ch.moduleId, field: 'isLREnable', value: next });
    showMsg(`${ch.name}: Rota LR ${next ? 'LIGADA' : 'DESLIGADA'}`);
  };

  const onPanChange = (ch, val) => {
    setPanDraft(prev => ({ ...prev, [ch.key]: val }));
  };

  const onPanCommit = async (ch, val) => {
    await action('channel/control', { key: ch.key, moduleId: ch.moduleId, field: 'panValue', value: val });
    setPanDraft(prev => { const n = { ...prev }; delete n[ch.key]; return n; });
    showMsg(`${ch.name}: Pan ${val === 0 ? 'Centro (C)' : val < 0 ? `L ${Math.abs(val)}` : `R ${val}`}`);
  };

  const getPanVal = ch => panDraft[ch.key] !== undefined ? panDraft[ch.key] : (typeof ch.rawPan === 'number' ? Math.round(ch.rawPan) : 0);

  return (
    <>
      {!status.fresh && (
        <div className="stale-warning" role="status">
          {status.label}. Exibindo a última leitura de {new Date(snapshot.receivedAt).toLocaleTimeString('pt-BR')}; os dados podem ter mudado na mesa.
        </div>
      )}

      {msg && <div className="toast" role="status"><Check size={16} /> {msg}</div>}

      {tab === 'Mixer' ? (
        <>
          <div className="section-toolbar">
            <div>
              <h2>Mixer da mesa · {channels.length} entradas</h2>
              <p>Faders verticais com envio contínuo, Mute, Solo, Rota LR e Pan operacionais para todos os canais.</p>
            </div>
            <span className="pill">
              <ShieldCheck size={12} /> {state.capabilities?.channel1Fader ? 'Controle Físico Completo' : 'Somente leitura'}
            </span>
          </div>

          <div className="mixer real-mixer">
            <div className="mixer-top">
              <div className="banks">
                {[0, 1].map(i => (
                  <button key={i} className={bank === i ? 'on' : ''} onClick={() => setBank(i)}>
                    Entradas {i * 8 + 1}–{Math.min(i * 8 + 8, channels.length)}
                  </button>
                ))}
              </div>
              <span>
                <i className={'green-dot ' + (meters ? 'live-pulse' : '')} />
                {meters ? 'Medidores reais ativos · TCP 6401' : status.fresh ? 'Dados da mesa' : 'Última leitura preservada'}
              </span>
            </div>

            <div className="real-strips">
              {channels.slice(bank * 8, bank * 8 + 8).map(ch => (
                <section key={ch.key} className={'strip ' + (channel?.key === ch.key ? 'chosen' : '')}>
                  <button className="channel-name" onClick={() => setSelected(ch.key)}>
                    <small>ID {ch.moduleId}</small>
                    <strong title={ch.name}>{ch.name}</strong>
                    <span>{ch.key.split('.')[1].replace('Model', '').toUpperCase()}</span>
                  </button>

                  <div className="ms">
                    <button
                      type="button"
                      className={'ms-btn ' + (ch.mute ? 'muted' : '')}
                      title={ch.mute ? 'Canal mutado. Clique para desmutar' : 'Clique para mutar o canal na mesa'}
                      disabled={busy || state?.writeInProgress}
                      onClick={() => toggleMute(ch)}
                    >
                      M {ch.mute ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      className={'ms-btn ' + (ch.solo ? 'solo' : '')}
                      title={ch.solo ? 'Solo ativo. Clique para desativar' : 'Clique para ativar Solo na mesa'}
                      disabled={busy || state?.writeInProgress}
                      onClick={() => toggleSolo(ch)}
                    >
                      S {ch.solo ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      className={'ms-btn ' + (ch.lr !== false ? 'lr-active' : '')}
                      title={ch.lr !== false ? 'Roteado para LR. Clique para desconectar do Master' : 'Clique para conectar à saída Master LR'}
                      disabled={busy || state?.writeInProgress}
                      onClick={() => toggleLR(ch)}
                    >
                      LR
                    </button>
                  </div>

                  <LiveFader channel={ch} />

                  <div className="real-pan">
                    <small>PAN</small>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      aria-label={`Pan ${ch.name}`}
                      value={getPanVal(ch)}
                      disabled={busy || state?.writeInProgress}
                      onChange={e => onPanChange(ch, +e.target.value)}
                      onPointerUp={e => onPanCommit(ch, +e.target.value)}
                      onKeyUp={e => onPanCommit(ch, +e.target.value)}
                    />
                    <b>{getPanVal(ch) === 0 ? 'C' : getPanVal(ch) < 0 ? `L${Math.abs(getPanVal(ch))}` : `R${getPanVal(ch)}`}</b>
                  </div>

                  <button className="channel-select" onClick={() => setSelected(ch.key)}>
                    {channel?.key === ch.key ? 'Selecionado' : 'Ajustar canal'}
                  </button>
                </section>
              ))}

              <section className="master strip real-master">
                <div className="channel-name">
                  <small>STEREO OUT</small>
                  <strong>Master LR</strong>
                  <span>SAÍDA PRINCIPAL</span>
                </div>
                <div className="master-label">
                  <Volume2 size={17} /> LR
                  <span className="meter-badge">{meters ? '6 Hz' : 'Aguardando'}</span>
                </div>

                <div className="ms">
                  <button
                    type="button"
                    className={'ms-btn ' + (masterOut?.isMute ? 'muted' : '')}
                    title="Alternar Mute Master"
                    disabled={busy || state?.writeInProgress}
                    onClick={() => action('master', { field: 'isMute', value: !masterOut?.isMute })}
                  >
                    M {masterOut?.isMute ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="real-master-meters">
                  <div className="master-meter-pair">
                    <div className="master-meter-unit">
                      <span className="channel-sub">L</span>
                      <div className="meter live-meter" title={meters?.master ? `${meters.master.left} dBFS` : 'Master L'}>
                        <div style={{ height: `${meters?.master?.leftPct ?? 0}%` }} />
                      </div>
                      <small className="meter-val">{meters?.master ? (meters.master.left <= -90 ? '−∞' : meters.master.left) : '—'}</small>
                    </div>
                    <div className="master-meter-unit">
                      <span className="channel-sub">R</span>
                      <div className="meter live-meter" title={meters?.master ? `${meters.master.right} dBFS` : 'Master R'}>
                        <div style={{ height: `${meters?.master?.rightPct ?? 0}%` }} />
                      </div>
                      <small className="meter-val">{meters?.master ? (meters.master.right <= -90 ? '−∞' : meters.master.right) : '—'}</small>
                    </div>
                  </div>
                </div>

                <div className="fader-area" style={{ height: '170px' }}>
                  <input
                    className="fader master-live-vertical"
                    type="range"
                    min="0"
                    max="1000"
                    step="0.5"
                    aria-label="Fader Master LR"
                    value={masterOut?.gainValue ?? 500}
                    disabled={busy || state?.writeInProgress}
                    onChange={e => action('master', { field: 'gainValue', value: +e.target.value })}
                  />
                </div>

                <div className="db-value">
                  {meters?.master ? `${meters.master.left} / ${meters.master.right}` : '— / —'} <small>dBFS</small>
                </div>
                <span className="master-bottom">MESA REAL · PORTA 6401</span>
              </section>
            </div>

            <div className="mixer-foot">
              <span>Fonte: {state.host}:6400 · {new Date(snapshot.receivedAt).toLocaleTimeString('pt-BR')}</span>
              <span>Todos os botões operacionais · valores físicos confirmados por snapshot.</span>
            </div>
          </div>

          <Channel1Fader />

          {channel && rawChannel && (
            <section className="panel live-detail">
              <div className="section-toolbar">
                <div>
                  <h2>{channel.name} · Pré-amplificador e entrada</h2>
                  <p>Ajustes físicos de ganho, alimentação fantasma (+48V) e filtro passa-altas (HPF).</p>
                </div>
                <span className="pill">ID {channel.moduleId}</span>
              </div>

              <div className="physical-controls">
                <div>
                  <h3>Phantom +48V</h3>
                  <p>Alimentação para microfones condensadores no conector XLR.</p>
                  <button
                    disabled={busy || state?.writeInProgress}
                    className={rawChannel?.inputPartModel?.is48vEnable ? 'pill' : ''}
                    onClick={() => action('channel/input', { key: channel.key, moduleId: channel.moduleId, inputModel: { is48vEnable: !rawChannel?.inputPartModel?.is48vEnable } })}
                  >
                    <Zap size={14} /> +48V: {rawChannel?.inputPartModel?.is48vEnable ? 'LIGADO' : 'DESLIGADO'}
                  </button>
                </div>

                <div>
                  <h3>Inversão de Fase</h3>
                  <p>Inverte a polaridade elétrica do sinal de entrada.</p>
                  <button
                    disabled={busy || state?.writeInProgress}
                    className={rawChannel?.inputPartModel?.isRevEnable ? 'pill' : ''}
                    onClick={() => action('channel/input', { key: channel.key, moduleId: channel.moduleId, inputModel: { isRevEnable: !rawChannel?.inputPartModel?.isRevEnable } })}
                  >
                    Fase: {rawChannel?.inputPartModel?.isRevEnable ? '180° (Invertida)' : '0° (Normal)'}
                  </button>
                </div>

                <div>
                  <h3>Filtro Passa-Altas (HPF)</h3>
                  <p>Corta frequências subsônicas e ruídos mecânicos de baixa frequência.</p>
                  <label className="control">
                    <span>Frequência HPF: <b>{Math.round(rawChannel?.inputPartModel?.hpfValue ?? 16)} Hz</b></span>
                    <input
                      type="range"
                      min="16"
                      max="400"
                      step="1"
                      value={Math.round(rawChannel?.inputPartModel?.hpfValue ?? 16)}
                      disabled={busy || state?.writeInProgress}
                      onChange={e => action('channel/input', { key: channel.key, moduleId: channel.moduleId, inputModel: { isHPFEnable: true, hpfValue: +e.target.value } })}
                    />
                  </label>
                </div>
              </div>

              <details style={{ marginTop: '15px' }}>
                <summary>Consultar todos os parâmetros deste canal (árvore bruta)</summary>
                <ValueTree value={rawChannel} />
              </details>
            </section>
          )}
        </>
      ) : tab === 'Equalizador' ? (
        <RealEqPanel channel={channel} rawChannel={rawChannel} channels={channels} onSelect={setSelected} onToast={showMsg} />
      ) : tab === 'Dinâmica' ? (
        <RealDynPanel channel={channel} rawChannel={rawChannel} channels={channels} onSelect={setSelected} onToast={showMsg} />
      ) : tab === 'Buses' ? (
        <RealBusesPanel channel={channel} rawChannel={rawChannel} channels={channels} onSelect={setSelected} busModel={snapshot.raw?.busModel} onToast={showMsg} />
      ) : tab === 'Analisador' ? (
        <RealAnalyzerPanel channel={channel} rawChannel={rawChannel} channels={channels} onSelect={setSelected} onToast={showMsg} />
      ) : (
        <section className="panel">
          <div className="section-toolbar">
            <h2>{tab} · Parâmetros da mesa</h2>
          </div>
          <ValueTree value={rawChannel} />
        </section>
      )}
    </>
  );
}

/**
 * Gráfico SVG da curva de resposta de frequência do Equalizador Paramétrico (PEQ).
 */
function RealEqGraph({ bands, isBypass }) {
  const point = (i) => {
    const f = 20 * Math.pow(1000, i / 240);
    const value = isBypass ? 0 : bands.reduce((sum, b) => {
      return sum + (b.gain || 0) * Math.exp(-0.5 * Math.pow(Math.log2(f / (b.freq || 1000)) * (b.q || 1) * 1.7, 2));
    }, 0);
    const y = 140 - Math.max(-18, Math.min(18, value)) * 6.5;
    return `${60 + i * 3.6},${y.toFixed(1)}`;
  };
  const pathD = 'M ' + Array.from({ length: 241 }, (_, i) => point(i)).join(' L ');
  return (
    <div className="graph-panel" style={{ margin: '15px 0 20px', background: '#12171e', padding: '16px', borderRadius: '8px', border: '1px solid #28343f' }}>
      <svg viewBox="0 0 960 280" style={{ width: '100%', height: 'auto', maxHeight: '230px' }} role="img" aria-label="Curva de resposta do equalizador">
        {[-15, -10, -5, 0, 5, 10, 15].map(v => (
          <g key={v}>
            <line x1="60" x2="925" y1={140 - v * 6.5} y2={140 - v * 6.5} stroke={v === 0 ? '#485867' : '#202832'} strokeDasharray={v === 0 ? 'none' : '3 3'} />
            <text x="20" y={144 - v * 6.5} fill="#697a8d" fontSize="10">{v > 0 ? `+${v}` : v} dB</text>
          </g>
        ))}
        {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(f => {
          const x = 60 + (Math.log10(f / 20) / 3) * 864;
          return (
            <g key={f}>
              <line x1={x} x2={x} y1="30" y2="235" stroke="#202832" strokeDasharray="3 3" />
              <text x={x - 12} y="260" fill="#697a8d" fontSize="10">{f >= 1000 ? `${f / 1000}k` : f} Hz</text>
            </g>
          );
        })}
        <path d={pathD} fill="none" stroke={isBypass ? '#667788' : '#5ce0b8'} strokeWidth="3.5" />
        {bands.map((b, idx) => {
          const x = 60 + (Math.log10(Math.max(20, Math.min(20000, b.freq)) / 20) / 3) * 864;
          const y = 140 - (isBypass ? 0 : b.gain) * 6.5;
          return (
            <g key={idx}>
              <circle cx={x} cy={y} r="7" fill={b.color} stroke="#10141a" strokeWidth="2" />
              <text x={x + 10} y={y - 8} fill={b.color} fontSize="11" fontWeight="bold">B{idx + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Painel completo do Equalizador Paramétrico (PEQ) para a Mesa Real.
 */
function RealEqPanel({ channel, rawChannel, channels, onSelect, onToast }) {
  const { busy, action } = useDesk();
  const eq = rawChannel?.eqPartModel || {};
  const [draft, setDraft] = useState({});

  const getVal = (k, def) => draft[k] !== undefined ? draft[k] : (eq[k] ?? def);

  const lowFreq = getVal('lowFreqValue', 60);
  const lowGain = getVal('lowGainValue', 0);
  const lowQ = getVal('lowQValue', 3.0);

  const lowMidFreq = getVal('lowMidFreqValue', 200);
  const lowMidGain = getVal('lowMidGainValue', 0);
  const lowMidQ = getVal('lowMidQValue', 3.0);

  const highMidFreq = getVal('highMidFreqValue', 1000);
  const highMidGain = getVal('highMidGainValue', 0);
  const highMidQ = getVal('highMidQValue', 3.0);

  const highFreq = getVal('highFreqValue', 4000);
  const highGain = getVal('highGainValue', 0);
  const highQ = getVal('highQValue', 3.0);

  const isBypass = getVal('isByPass', false);

  const apply = async (customPayload) => {
    const payload = customPayload || {
      isByPass: isBypass,
      lowFreqValue: lowFreq,
      lowGainValue: lowGain,
      lowQValue: lowQ,
      lowMidFreqValue: lowMidFreq,
      lowMidGainValue: lowMidGain,
      lowMidQValue: lowMidQ,
      highMidFreqValue: highMidFreq,
      highMidGainValue: highMidGain,
      highMidQValue: highMidQ,
      highFreqValue: highFreq,
      highGainValue: highGain,
      highQValue: highQ,
    };
    await action('channel/eq', { key: channel.key, moduleId: channel.moduleId, eqModel: payload });
    setDraft({});
    if (onToast) onToast(`${channel.name}: Equalizador (Cmd 104) aplicado e confirmado na DB20P!`);
  };

  const bands = [
    { name: 'Graves', freqKey: 'lowFreqValue', gainKey: 'lowGainValue', qKey: 'lowQValue', freq: lowFreq, gain: lowGain, q: lowQ, minF: 20, maxF: 500, color: '#5cccae' },
    { name: 'Médios Graves', freqKey: 'lowMidFreqValue', gainKey: 'lowMidGainValue', qKey: 'lowMidQValue', freq: lowMidFreq, gain: lowMidGain, q: lowMidQ, minF: 100, maxF: 2000, color: '#e6b968' },
    { name: 'Médios Agudos', freqKey: 'highMidFreqValue', gainKey: 'highMidGainValue', qKey: 'highMidQValue', freq: highMidFreq, gain: highMidGain, q: highMidQ, minF: 500, maxF: 10000, color: '#8b9bff' },
    { name: 'Agudos', freqKey: 'highFreqValue', gainKey: 'highGainValue', qKey: 'highQValue', freq: highFreq, gain: highGain, q: highQ, minF: 2000, maxF: 20000, color: '#d492cf' },
  ];

  const presets = [
    { label: 'Curva Plana (0 dB)', values: { lowGainValue: 0, lowMidGainValue: 0, highMidGainValue: 0, highGainValue: 0 } },
    { label: 'Vocal Clareza', values: { lowFreqValue: 100, lowGainValue: -2, lowQValue: 1.2, lowMidFreqValue: 350, lowMidGainValue: -1.5, lowMidQValue: 1.5, highMidFreqValue: 2800, highMidGainValue: 3, highMidQValue: 1.8, highFreqValue: 10000, highGainValue: 2.5, highQValue: 1.0 } },
    { label: 'Bateria Punch', values: { lowFreqValue: 60, lowGainValue: 4, lowQValue: 2.0, lowMidFreqValue: 350, lowMidGainValue: -4.5, lowMidQValue: 2.2, highMidFreqValue: 2500, highMidGainValue: 2, highMidQValue: 2.0, highFreqValue: 6000, highGainValue: 1.5, highQValue: 1.2 } },
    { label: 'Violão / Acústico', values: { lowFreqValue: 100, lowGainValue: -2.5, lowQValue: 1.0, lowMidFreqValue: 800, lowMidGainValue: 1, lowMidQValue: 1.5, highMidFreqValue: 3200, highMidGainValue: 2.5, highMidQValue: 2.0, highFreqValue: 8000, highGainValue: 2, highQValue: 1.0 } },
    { label: 'Baixo Firme', values: { lowFreqValue: 80, lowGainValue: 3.5, lowQValue: 1.8, lowMidFreqValue: 250, lowMidGainValue: 1, lowMidQValue: 1.5, highMidFreqValue: 1200, highMidGainValue: -3, highMidQValue: 2.0, highFreqValue: 4000, highGainValue: -2, highQValue: 1.2 } },
  ];

  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Equalizador Paramétrico de 4 Bandas · {channel.name}</h2>
          <p>Valores reais da DB20P (Comando ID 104). Altere as bandas e aplique na mesa.</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className={isBypass ? 'muted' : ''}
            disabled={busy}
            onClick={() => setDraft(prev => ({ ...prev, isByPass: !isBypass }))}
          >
            EQ Bypass: {isBypass ? 'ATIVADO' : 'DESLIGADO'}
          </button>
          <button type="button" disabled={busy} onClick={() => apply()}>
            Aplicar EQ na Mesa
          </button>
        </div>
      </div>

      <div className="channel-pills">
        {channels.map(ch => (
          <button
            key={ch.key}
            type="button"
            className={channel.key === ch.key ? 'on' : ''}
            onClick={() => { onSelect(ch.key); setDraft({}); }}
          >
            ID {ch.moduleId}: {ch.name}
          </button>
        ))}
      </div>

      <div className="presets-row">
        <span style={{ fontSize: '10px', color: '#8899aa', alignSelf: 'center', marginRight: '4px' }}>Predefinições:</span>
        {presets.map(p => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => setDraft(prev => ({ ...prev, ...p.values }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <RealEqGraph bands={bands} isBypass={isBypass} />

      <div className="eq-controls">
        {bands.map((b, i) => (
          <section className="panel" key={i} style={{ padding: '15px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: b.color }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: b.color }} />
              {b.name}
            </h3>

            <label className="control">
              <span>Frequência: <b>{Math.round(b.freq)} Hz</b></span>
              <input
                type="range"
                min={b.minF}
                max={b.maxF}
                step="1"
                value={Math.round(b.freq)}
                disabled={busy}
                onChange={e => setDraft(prev => ({ ...prev, [b.freqKey]: +e.target.value }))}
              />
            </label>

            <label className="control">
              <span>Ganho: <b>{b.gain >= 0 ? `+${b.gain.toFixed(1)}` : b.gain.toFixed(1)} dB</b></span>
              <input
                type="range"
                min="-15"
                max="15"
                step="0.5"
                value={b.gain}
                disabled={busy}
                onChange={e => setDraft(prev => ({ ...prev, [b.gainKey]: +e.target.value }))}
              />
            </label>

            <label className="control">
              <span>Fator Q: <b>{b.q.toFixed(1)}</b></span>
              <input
                type="range"
                min="0.2"
                max="10"
                step="0.1"
                value={b.q}
                disabled={busy}
                onChange={e => setDraft(prev => ({ ...prev, [b.qKey]: +e.target.value }))}
              />
            </label>
          </section>
        ))}
      </div>
    </section>
  );
}

/**
 * Painel completo de Dinâmica (Gate e Compressor) para a Mesa Real.
 */
function RealDynPanel({ channel, rawChannel, channels, onSelect, onToast }) {
  const { busy, action } = useDesk();
  const dyn = rawChannel?.dymanicPartModel || {};
  const [draft, setDraft] = useState({});

  const getVal = (k, def) => draft[k] !== undefined ? draft[k] : (dyn[k] ?? def);

  const isGateEnable = getVal('isGateEnable', false);
  const gateThresh = getVal('gateThresholdValue', -80);
  const gateAttack = getVal('gateAttackValue', 3);
  const gateRelease = getVal('gateReleaseValue', 200);
  const gateDepth = getVal('gateDepthValue', -80);

  const isCompEnable = getVal('isCompressorEnable', false);
  const compThresh = getVal('compressorTresholdValue', -20);
  const compRatio = getVal('compressorRatioValue', 4);
  const compAttack = getVal('compressorAttackValue', 25);
  const compRelease = getVal('compressorReleaseValue', 350);
  const compGain = getVal('compressorGainValue', 0);

  const apply = async () => {
    const payload = {
      isGateEnable,
      gateThresholdValue: gateThresh,
      gateAttackValue: gateAttack,
      gateReleaseValue: gateRelease,
      gateDepthValue: gateDepth,
      isCompressorEnable: isCompEnable,
      compressorTresholdValue: compThresh,
      compressorRatioValue: compRatio,
      compressorAttackValue: compAttack,
      compressorReleaseValue: compRelease,
      compressorGainValue: compGain,
    };
    await action('channel/dynamic', { key: channel.key, moduleId: channel.moduleId, dynModel: payload });
    setDraft({});
    if (onToast) onToast(`${channel.name}: Dinâmica (Cmd 106) aplicada e confirmada na DB20P!`);
  };

  const gatePresets = [
    { label: 'Voz Leve', values: { isGateEnable: true, gateThresholdValue: -52, gateAttackValue: 3, gateReleaseValue: 200, gateDepthValue: -80 } },
    { label: 'Bumbo / Caixa', values: { isGateEnable: true, gateThresholdValue: -34, gateAttackValue: 1, gateReleaseValue: 90, gateDepthValue: -80 } },
    { label: 'Desligado', values: { isGateEnable: false } },
  ];

  const compPresets = [
    { label: 'Vocal Suave', values: { isCompressorEnable: true, compressorTresholdValue: -18, compressorRatioValue: 2.5, compressorAttackValue: 25, compressorReleaseValue: 300, compressorGainValue: 2 } },
    { label: 'Vocal Firme', values: { isCompressorEnable: true, compressorTresholdValue: -24, compressorRatioValue: 4.0, compressorAttackValue: 15, compressorReleaseValue: 180, compressorGainValue: 4 } },
    { label: 'Bateria Punch', values: { isCompressorEnable: true, compressorTresholdValue: -15, compressorRatioValue: 5.0, compressorAttackValue: 30, compressorReleaseValue: 120, compressorGainValue: 3 } },
    { label: 'Limitador', values: { isCompressorEnable: true, compressorTresholdValue: -6, compressorRatioValue: 12.0, compressorAttackValue: 2, compressorReleaseValue: 80, compressorGainValue: 0 } },
    { label: 'Desligado', values: { isCompressorEnable: false } },
  ];

  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Dinâmica (Noise Gate e Compressor) · {channel.name}</h2>
          <p>Valores reais da DB20P (Comando ID 106). Ajuste os processadores e aplique na mesa.</p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={apply}>
            Aplicar Dinâmica na Mesa
          </button>
        </div>
      </div>

      <div className="channel-pills">
        {channels.map(ch => (
          <button
            key={ch.key}
            type="button"
            className={channel.key === ch.key ? 'on' : ''}
            onClick={() => { onSelect(ch.key); setDraft({}); }}
          >
            ID {ch.moduleId}: {ch.name}
          </button>
        ))}
      </div>

      <div className="processing-grid" style={{ marginTop: '16px' }}>
        <section className="panel">
          <div className="section-toolbar">
            <h3>Noise Gate</h3>
            <button
              type="button"
              className={isGateEnable ? 'pill' : ''}
              disabled={busy}
              onClick={() => setDraft(prev => ({ ...prev, isGateEnable: !isGateEnable }))}
            >
              Gate: {isGateEnable ? 'LIGADO' : 'DESLIGADO'}
            </button>
          </div>

          <div className="presets-row">
            {gatePresets.map(p => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => setDraft(prev => ({ ...prev, ...p.values }))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="control">
            <span>Limiar (Threshold): <b>{Math.round(gateThresh)} dB</b></span>
            <input
              type="range"
              min="-80"
              max="0"
              step="1"
              value={Math.round(gateThresh)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, gateThresholdValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Ataque (Attack): <b>{Math.round(gateAttack)} ms</b></span>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={Math.round(gateAttack)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, gateAttackValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Liberação (Release): <b>{Math.round(gateRelease)} ms</b></span>
            <input
              type="range"
              min="20"
              max="1000"
              step="10"
              value={Math.round(gateRelease)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, gateReleaseValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Profundidade (Depth): <b>{Math.round(gateDepth)} dB</b></span>
            <input
              type="range"
              min="-80"
              max="0"
              step="1"
              value={Math.round(gateDepth)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, gateDepthValue: +e.target.value }))}
            />
          </label>
        </section>

        <section className="panel">
          <div className="section-toolbar">
            <h3>Compressor</h3>
            <button
              type="button"
              className={isCompEnable ? 'pill' : ''}
              disabled={busy}
              onClick={() => setDraft(prev => ({ ...prev, isCompressorEnable: !isCompEnable }))}
            >
              Comp: {isCompEnable ? 'LIGADO' : 'DESLIGADO'}
            </button>
          </div>

          <div className="presets-row">
            {compPresets.map(p => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => setDraft(prev => ({ ...prev, ...p.values }))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="control">
            <span>Limiar (Threshold): <b>{Math.round(compThresh)} dB</b></span>
            <input
              type="range"
              min="-60"
              max="0"
              step="1"
              value={Math.round(compThresh)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, compressorTresholdValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Proporção (Ratio): <b>{compRatio.toFixed(1)}:1</b></span>
            <input
              type="range"
              min="1"
              max="20"
              step="0.5"
              value={compRatio}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, compressorRatioValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Ataque (Attack): <b>{Math.round(compAttack)} ms</b></span>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={Math.round(compAttack)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, compressorAttackValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Liberação (Release): <b>{Math.round(compRelease)} ms</b></span>
            <input
              type="range"
              min="20"
              max="1000"
              step="10"
              value={Math.round(compRelease)}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, compressorReleaseValue: +e.target.value }))}
            />
          </label>

          <label className="control">
            <span>Ganho de Saída (Makeup): <b>{compGain >= 0 ? `+${compGain.toFixed(1)}` : compGain.toFixed(1)} dB</b></span>
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              value={compGain}
              disabled={busy}
              onChange={e => setDraft(prev => ({ ...prev, compressorGainValue: +e.target.value }))}
            />
          </label>
        </section>
      </div>
    </section>
  );
}

/**
 * Painel completo de Envio para Buses para a Mesa Real.
 */
function RealBusesPanel({ channel, rawChannel, channels, onSelect, onToast }) {
  const { busy, action } = useDesk();
  const rawBusSends = rawChannel?.micInBusSendModel || {};
  const [draft, setDraft] = useState({});

  const getBusData = (busNum) => {
    const raw = rawBusSends[`bus${busNum}`] || {};
    const d = draft[busNum] || {};
    return {
      gain: d.gain !== undefined ? d.gain : (raw.gainValue ?? 0),
      isPrefader: d.isPrefader !== undefined ? d.isPrefader : (raw.isPrefader ?? false),
      isBusEnable: d.isBusEnable !== undefined ? d.isBusEnable : (raw.isBusEnable ?? true),
    };
  };

  const updateDraft = (busNum, patch) => {
    setDraft(prev => ({
      ...prev,
      [busNum]: { ...getBusData(busNum), ...patch },
    }));
  };

  const handleSendBus = async (busNum) => {
    const data = getBusData(busNum);
    await action('bus-send', {
      moduleId: channel.moduleId,
      busParamId: busNum,
      busModel: {
        moduleId: channel.moduleId,
        busParamId: busNum,
        isBusEnable: data.isBusEnable,
        isPrefader: data.isPrefader,
        gainValue: data.gain,
      },
    });
    if (onToast) onToast(`${channel.name} → Bus ${busNum} (Cmd 108) atualizado na DB20P!`);
  };

  const handleApplyAll = async () => {
    for (let b = 1; b <= 8; b++) {
      const data = getBusData(b);
      await action('bus-send', {
        moduleId: channel.moduleId,
        busParamId: b,
        busModel: {
          moduleId: channel.moduleId,
          busParamId: b,
          isBusEnable: data.isBusEnable,
          isPrefader: data.isPrefader,
          gainValue: data.gain,
        },
      });
    }
    setDraft({});
    if (onToast) onToast(`${channel.name}: Todos os 8 envios de Bus aplicados na DB20P!`);
  };

  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Envio para Buses · {channel.name}</h2>
          <p>Ajuste os níveis de envio, pré/pós fader e ativação deste canal para os 8 barramentos auxiliares (Comando ID 108).</p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={handleApplyAll}>
            Aplicar Todos os 8 Buses
          </button>
        </div>
      </div>

      <div className="channel-pills">
        {channels.map(ch => (
          <button
            key={ch.key}
            type="button"
            className={channel.key === ch.key ? 'on' : ''}
            onClick={() => { onSelect(ch.key); setDraft({}); }}
          >
            ID {ch.moduleId}: {ch.name}
          </button>
        ))}
      </div>

      <div className="bus-grid">
        {Array.from({ length: 8 }, (_, i) => {
          const busNum = i + 1;
          const data = getBusData(busNum);
          return (
            <div className="bus" key={busNum}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Radio size={16} />
                <span className="pill" style={{ fontSize: '9px', padding: '3px 6px' }}>Bus {busNum}</span>
              </div>
              <h3 style={{ margin: '8px 0 2px' }}>Bus {busNum}</h3>
              <p style={{ margin: '0 0 12px' }}>{['Retorno palco', 'Retorno vocal', 'Retorno banda', 'In-ear', 'Efeito 1', 'Efeito 2', 'Streaming', 'Auxiliar'][i]}</p>

              <div className="bus-controls">
                <button
                  type="button"
                  className={data.isBusEnable ? 'active' : ''}
                  onClick={() => updateDraft(busNum, { isBusEnable: !data.isBusEnable })}
                >
                  {data.isBusEnable ? 'Ativo' : 'Mudo'}
                </button>
                <button
                  type="button"
                  className={data.isPrefader ? 'active' : ''}
                  onClick={() => updateDraft(busNum, { isPrefader: !data.isPrefader })}
                >
                  {data.isPrefader ? 'Pré-Fader' : 'Pós-Fader'}
                </button>
              </div>

              <label className="control">
                <span>Nível: <b>{Math.round(data.gain)}</b></span>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  value={Math.round(data.gain)}
                  disabled={busy}
                  onChange={e => updateDraft(busNum, { gain: +e.target.value })}
                />
              </label>

              <button
                type="button"
                style={{ width: '100%', marginTop: '8px', fontSize: '10px' }}
                disabled={busy}
                onClick={() => handleSendBus(busNum)}
              >
                Aplicar Bus {busNum}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Painel completo de Análise Espectral (RTA) e Assistente DSP para a Mesa Real.
 */
function RealAnalyzerPanel({ channel, rawChannel, channels, onSelect, onToast }) {
  const { busy, action } = useDesk();
  const eq = rawChannel?.eqPartModel || {};

  const bands = [
    { freq: eq.lowFreqValue ?? 60, gain: eq.isByPass ? 0 : (eq.lowGainValue ?? 0), q: eq.lowQValue ?? 3.0, color: '#5cccae' },
    { freq: eq.lowMidFreqValue ?? 200, gain: eq.isByPass ? 0 : (eq.lowMidGainValue ?? 0), q: eq.lowMidQValue ?? 3.0, color: '#e6b968' },
    { freq: eq.highMidFreqValue ?? 1000, gain: eq.isByPass ? 0 : (eq.highMidGainValue ?? 0), q: eq.highMidQValue ?? 3.0, color: '#8b9bff' },
    { freq: eq.highFreqValue ?? 4000, gain: eq.isByPass ? 0 : (eq.highGainValue ?? 0), q: eq.highQValue ?? 3.0, color: '#d492cf' },
  ];

  const applySuggestion = async (recipe) => {
    const payload = {
      ...eq,
      isByPass: false,
      ...recipe,
    };
    await action('channel/eq', { key: channel.key, moduleId: channel.moduleId, eqModel: payload });
    if (onToast) onToast(`${channel.name}: Sugestão DSP aplicada e confirmada na DB20P!`);
  };

  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>Analisador RTA & Assistente DSP · {channel.name}</h2>
          <p>Espectro sintetizado combinado à curva do equalizador da DB20P com recomendações consultivas de mixagem.</p>
        </div>
      </div>

      <div className="channel-pills">
        {channels.map(ch => (
          <button
            key={ch.key}
            type="button"
            className={channel.key === ch.key ? 'on' : ''}
            onClick={() => onSelect(ch.key)}
          >
            ID {ch.moduleId}: {ch.name}
          </button>
        ))}
      </div>

      <RealEqGraph bands={bands} isBypass={eq.isByPass ?? false} />

      <div className="energy-grid">
        <div className="energy-card">
          <small>GRAVES (20 – 250 Hz)</small>
          <strong>{((eq.lowGainValue ?? 0) >= 0 ? `+${(eq.lowGainValue ?? 0).toFixed(1)}` : (eq.lowGainValue ?? 0).toFixed(1))} dB</strong>
          <span>{eq.lowGainValue > 2 ? 'Realce pronunciado' : eq.lowGainValue < -2 ? 'Atenuação' : 'Equilibrado'}</span>
        </div>
        <div className="energy-card">
          <small>MÉDIOS (250 Hz – 4 kHz)</small>
          <strong>{(((eq.lowMidGainValue ?? 0) + (eq.highMidGainValue ?? 0)) / 2 >= 0 ? `+${(((eq.lowMidGainValue ?? 0) + (eq.highMidGainValue ?? 0)) / 2).toFixed(1)}` : (((eq.lowMidGainValue ?? 0) + (eq.highMidGainValue ?? 0)) / 2).toFixed(1))} dB</strong>
          <span>Região vocal e instrumentos</span>
        </div>
        <div className="energy-card">
          <small>AGUDOS (4 – 20 kHz)</small>
          <strong>{((eq.highGainValue ?? 0) >= 0 ? `+${(eq.highGainValue ?? 0).toFixed(1)}` : (eq.highGainValue ?? 0).toFixed(1))} dB</strong>
          <span>{eq.highGainValue > 2 ? 'Brilho e ar' : 'Natural'}</span>
        </div>
      </div>

      <div style={{ marginTop: '24px' }}>
        <h3>Recomendações Consultivas para este canal</h3>
        <p>Ações acústicas rápidas calibradas para o perfil Soundking DB20P:</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '15px', marginTop: '14px' }}>
          <div className="panel" style={{ padding: '16px', background: '#19232a' }}>
            <strong style={{ display: 'block', fontSize: '13px', color: '#7fe2be' }}>Clareza Vocal</strong>
            <p style={{ margin: '8px 0 12px' }}>Atenua acúmulo em 350 Hz (-2.5 dB) e adiciona inteligibilidade em 2.8 kHz (+3.0 dB).</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => applySuggestion({ lowMidFreqValue: 350, lowMidGainValue: -2.5, lowMidQValue: 1.8, highMidFreqValue: 2800, highMidGainValue: 3.0, highMidQValue: 1.8 })}
            >
              Aplicar ao Canal na Mesa
            </button>
          </div>

          <div className="panel" style={{ padding: '16px', background: '#19232a' }}>
            <strong style={{ display: 'block', fontSize: '13px', color: '#e6b968' }}>Menos Graves (Anti-Rumble)</strong>
            <p style={{ margin: '8px 0 12px' }}>Limpa ressonâncias e subgraves indesejados (-3.5 dB em 80 Hz).</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => applySuggestion({ lowFreqValue: 80, lowGainValue: -3.5, lowQValue: 1.5 })}
            >
              Aplicar ao Canal na Mesa
            </button>
          </div>

          <div className="panel" style={{ padding: '16px', background: '#19232a' }}>
            <strong style={{ display: 'block', fontSize: '13px', color: '#8b9bff' }}>Mais Presença & Brilho</strong>
            <p style={{ margin: '8px 0 12px' }}>Destaca o som na mixagem geral (+2.5 dB em 3 kHz e +2 dB em 10 kHz).</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => applySuggestion({ highMidFreqValue: 3000, highMidGainValue: 2.5, highMidQValue: 1.5, highFreqValue: 10000, highGainValue: 2.0, highQValue: 1.0 })}
            >
              Aplicar ao Canal na Mesa
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ValueTree({ value }) {
  if (!value) return <p>Parâmetros ausentes nesta leitura.</p>;
  return (
    <div className="value-tree">
      {Object.entries(value).map(([key, v]) =>
        v && typeof v === 'object' ? (
          <details key={key}>
            <summary>{key}</summary>
            <ValueTree value={v} />
          </details>
        ) : (
          <div className="value-row" key={key}>
            <span>{key}</span>
            <strong>{typeof v === 'boolean' ? (v ? 'Ligado' : 'Desligado') : number(v)}</strong>
          </div>
        )
      )}
    </div>
  );
}

