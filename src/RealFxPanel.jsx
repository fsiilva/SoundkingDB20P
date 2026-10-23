import React, { useState, useRef } from 'react';
import { Sparkles, Clock, Volume2, RotateCcw, Zap, Music, VolumeX, Check } from 'lucide-react';
import { useDesk } from './DeskContext';

const REVERB_PRESETS = [
  { name: 'Large Church Hall', decay: 3.2, preDelay: 35, hfCut: 6500, dryWet: 35 },
  { name: 'Vocal Plate Suave', decay: 2.1, preDelay: 20, hfCut: 8000, dryWet: 30 },
  { name: 'Ambiente Curto / Sala', decay: 1.2, preDelay: 10, hfCut: 10000, dryWet: 20 },
  { name: 'Catedral Espaçosa', decay: 5.5, preDelay: 50, hfCut: 5000, dryWet: 45 },
];

const DELAY_PRESETS = [
  { name: '1/4 Note (Semínima)', time: 500, bpm: 120, feedback: 30, dryWet: 25 },
  { name: 'Dotted Eighth (3/8)', time: 375, bpm: 120, feedback: 35, dryWet: 30 },
  { name: 'Slapback Vocal', time: 120, bpm: 120, feedback: 10, dryWet: 20 },
  { name: 'Echo Espacial Banda', time: 680, bpm: 88, feedback: 50, dryWet: 35 },
];

export default function RealFxPanel({ onToast }) {
  const { state, busy, action } = useDesk();
  const fxModel = state?.snapshot?.raw?.setupModel?.fxModel;

  // Reverb local state
  const [revDecay, setRevDecay] = useState(2.4);
  const [revPreDelay, setRevPreDelay] = useState(25);
  const [revHfCut, setRevHfCut] = useState(7500);
  const [revDryWet, setRevDryWet] = useState(30);
  const [revReturn, setRevReturn] = useState(500);
  const [revMute, setRevMute] = useState(false);

  // Delay local state
  const [delTime, setDelTime] = useState(400);
  const [delFeedback, setDelFeedback] = useState(30);
  const [delDryWet, setDelDryWet] = useState(25);
  const [delReturn, setDelReturn] = useState(500);
  const [delMute, setDelMute] = useState(false);
  const [delBpm, setDelBpm] = useState(120);

  // Tap tempo state
  const tapTimes = useRef([]);
  const [tapFlash, setTapFlash] = useState(false);

  const handleTap = () => {
    const now = Date.now();
    tapTimes.current.push(now);
    if (tapTimes.current.length > 4) tapTimes.current.shift();
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 150);

    if (tapTimes.current.length >= 2) {
      const diffs = [];
      for (let i = 1; i < tapTimes.current.length; i++) {
        diffs.push(tapTimes.current[i] - tapTimes.current[i - 1]);
      }
      const avgMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      if (avgMs >= 200 && avgMs <= 1500) {
        const calculatedBpm = Math.round(60000 / avgMs);
        const roundedMs = Math.round(avgMs);
        setDelBpm(calculatedBpm);
        setDelTime(roundedMs);
        onToast?.(`Tap Tempo: ${calculatedBpm} BPM (${roundedMs} ms)`);
      }
    }
  };

  const applyRevPreset = p => {
    setRevDecay(p.decay);
    setRevPreDelay(p.preDelay);
    setRevHfCut(p.hfCut);
    setRevDryWet(p.dryWet);
    onToast?.(`Preset Reverb aplicado: ${p.name}`);
  };

  const applyDelPreset = p => {
    setDelTime(p.time);
    setDelBpm(p.bpm);
    setDelFeedback(p.feedback);
    setDelDryWet(p.dryWet);
    onToast?.(`Preset Delay aplicado: ${p.name}`);
  };

  return (
    <div className="fx-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="section-toolbar">
        <div>
          <h2>Processadores de Efeitos FX · DB20P</h2>
          <p>Controles de Reverb e Delay com Tap Tempo para ambiência e voz.</p>
        </div>
        <span className="pill">
          <Sparkles size={13} /> DSP 48kHz Estéreo
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* REVERB PROCESSOR */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="#58bfa6" /> FX 1: Reverb Estéreo (Hall / Plate)
              </h3>
              <small style={{ color: '#8b9caa' }}>Simulação de acústica de sala e igreja</small>
            </div>
            <button
              className={`ms-btn ${revMute ? 'muted' : ''}`}
              onClick={() => {
                const next = !revMute;
                setRevMute(next);
                onToast?.(`FX 1 Reverb: ${next ? 'MUTADO' : 'ATIVO'}`);
              }}
            >
              {revMute ? 'FX MUTE ON' : 'MUTE OFF'}
            </button>
          </div>

          {/* SVG Reverb Decay Curve */}
          <div style={{ background: '#10151d', padding: '12px', borderRadius: '8px', border: '1px solid #232d39' }}>
            <svg viewBox="0 0 400 100" style={{ width: '100%', height: '80px' }}>
              <defs>
                <linearGradient id="revGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#58bfa6" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#58bfa6" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              <line x1="20" y1="80" x2="380" y2="80" stroke="#2a3644" />
              <line x1="20" y1="20" x2="20" y2="80" stroke="#2a3644" />
              {/* Exponential decay curve based on decay time */}
              <path
                d={`M 20 20 Q ${40 + revPreDelay * 0.4} 20, ${60 + revDecay * 30} 80 L 380 80`}
                fill="none"
                stroke="#58bfa6"
                strokeWidth="2.5"
              />
              <text x="25" y="32" fill="#58bfa6" fontSize="10">Decaimento: {revDecay}s</text>
              <text x="300" y="75" fill="#8b9caa" fontSize="10">Pre-delay: {revPreDelay}ms</text>
            </svg>
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {REVERB_PRESETS.map(p => (
              <button
                key={p.name}
                className="btn-preset"
                style={{ fontSize: '11px', padding: '5px 10px', background: '#1c242f', border: '1px solid #2c3a4a', color: '#c3d0dc', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => applyRevPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label className="control">
              <span>Tempo de Decaimento (Decay)<b>{revDecay.toFixed(1)} s</b></span>
              <input type="range" min="0.4" max="8.0" step="0.1" value={revDecay} onChange={e => setRevDecay(+e.target.value)} />
            </label>

            <label className="control">
              <span>Pré-Delay<b>{revPreDelay} ms</b></span>
              <input type="range" min="0" max="150" step="5" value={revPreDelay} onChange={e => setRevPreDelay(+e.target.value)} />
            </label>

            <label className="control">
              <span>Amortecimento de Agudos (HF Cut)<b>{(revHfCut / 1000).toFixed(1)} kHz</b></span>
              <input type="range" min="1000" max="16000" step="500" value={revHfCut} onChange={e => setRevHfCut(+e.target.value)} />
            </label>

            <label className="control">
              <span>Mix Dry / Wet<b>{revDryWet}%</b></span>
              <input type="range" min="0" max="100" step="1" value={revDryWet} onChange={e => setRevDryWet(+e.target.value)} />
            </label>

            <label className="control">
              <span>Fader de Retorno FX 1<b>{revReturn} bruto</b></span>
              <input type="range" min="0" max="1000" step="5" value={revReturn} onChange={e => setRevReturn(+e.target.value)} />
            </label>
          </div>
        </section>

        {/* DELAY PROCESSOR */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={18} color="#759af6" /> FX 2: Stereo / BPM Delay
              </h3>
              <small style={{ color: '#8b9caa' }}>Repetição rítmica sincronizada com Tap Tempo</small>
            </div>
            <button
              className={`ms-btn ${delMute ? 'muted' : ''}`}
              onClick={() => {
                const next = !delMute;
                setDelMute(next);
                onToast?.(`FX 2 Delay: ${next ? 'MUTADO' : 'ATIVO'}`);
              }}
            >
              {delMute ? 'FX MUTE ON' : 'MUTE OFF'}
            </button>
          </div>

          {/* Tap Tempo & Visual Echo Repeats */}
          <div style={{ background: '#10151d', padding: '12px', borderRadius: '8px', border: '1px solid #232d39', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={handleTap}
              style={{
                background: tapFlash ? '#759af6' : '#1e293b',
                color: tapFlash ? '#000' : '#759af6',
                border: '2px solid #759af6',
                padding: '14px 22px',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '15px',
                cursor: 'pointer',
                transition: 'all 0.1s',
                minWidth: '100px',
                textAlign: 'center',
              }}
            >
              TAP TEMPO
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#e2e8f0' }}>
                {delBpm} <span style={{ fontSize: '13px', color: '#94a3b8' }}>BPM</span>
              </div>
              <div style={{ fontSize: '12px', color: '#759af6' }}>
                Tempo de Delay: <b>{delTime} ms</b>
              </div>
            </div>
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DELAY_PRESETS.map(p => (
              <button
                key={p.name}
                className="btn-preset"
                style={{ fontSize: '11px', padding: '5px 10px', background: '#1c242f', border: '1px solid #2c3a4a', color: '#c3d0dc', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => applyDelPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label className="control">
              <span>Tempo de Delay (ms)<b>{delTime} ms</b></span>
              <input
                type="range"
                min="50"
                max="1200"
                step="5"
                value={delTime}
                onChange={e => {
                  const ms = +e.target.value;
                  setDelTime(ms);
                  setDelBpm(Math.round(60000 / ms));
                }}
              />
            </label>

            <label className="control">
              <span>Feedback (Repetições)<b>{delFeedback}%</b></span>
              <input type="range" min="0" max="85" step="1" value={delFeedback} onChange={e => setDelFeedback(+e.target.value)} />
            </label>

            <label className="control">
              <span>Mix Dry / Wet<b>{delDryWet}%</b></span>
              <input type="range" min="0" max="100" step="1" value={delDryWet} onChange={e => setDelDryWet(+e.target.value)} />
            </label>

            <label className="control">
              <span>Fader de Retorno FX 2<b>{delReturn} bruto</b></span>
              <input type="range" min="0" max="1000" step="5" value={delReturn} onChange={e => setDelReturn(+e.target.value)} />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
