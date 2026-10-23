import React, { useState } from 'react';
import { SlidersHorizontal, RotateCcw, Volume2, ShieldCheck, Check } from 'lucide-react';
import { useDesk } from './DeskContext';

const GEQ_FREQS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k'
];

const GEQ_PRESETS = [
  {
    name: 'Flat (Linear)',
    gains: new Array(31).fill(0)
  },
  {
    name: 'Corte Sub-Graves (80Hz HPF)',
    gains: [-12, -12, -12, -10, -6, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    name: 'Anti-Feedback Voz (Reduz 2.5k & 4k)',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, -3, -2, 0, 0, 0, 0, 0, 0, -2, -4, -4, -3, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    name: 'Smile Curve (Música / PA)',
    gains: [4, 4, 3.5, 3, 2.5, 1.5, 1, 0, -0.5, -1, -1.5, -1.5, -1, -0.5, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4, 3.5, 3, 2.5, 2, 1, 0]
  },
  {
    name: 'Clareza Vocal PA Igreja',
    gains: [-8, -6, -4, -2, 0, 0, 0, 0, -1, -2, -3, -3, -2, -1, 0, 0, 0.5, 1, 1.5, 2, 2.5, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0]
  }
];

export default function RealGeqPanel({ onToast }) {
  const { state, busy } = useDesk();
  const [gains, setGains] = useState(() => new Array(31).fill(0));
  const [bypass, setBypass] = useState(false);

  const setGain = (index, val) => {
    setGains(prev => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const applyPreset = p => {
    setGains([...p.gains]);
    onToast?.(`GEQ Preset aplicado: ${p.name}`);
  };

  const resetFlat = () => {
    setGains(new Array(31).fill(0));
    onToast?.('GEQ resetado para Flat (0 dB em todas as bandas)');
  };

  // Generate SVG curve points across 31 bands
  const curvePoints = () => {
    if (bypass) {
      return 'M 30 100 L 930 100';
    }
    const pts = gains.map((g, i) => {
      const x = 30 + (i / 30) * 900;
      const y = 100 - (g / 12) * 80;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return 'M ' + pts.join(' L ');
  };

  return (
    <div className="geq-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="section-toolbar">
        <div>
          <h2>Equalizador Gráfico GEQ · Saída Master LR / PA</h2>
          <p>Equalizador padrão ISO de 31 bandas de 1/3 de oitava com ajuste de ±12 dB por banda.</p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`ms-btn ${bypass ? 'muted' : ''}`}
            onClick={() => {
              setBypass(!bypass);
              onToast?.(`GEQ Master: ${!bypass ? 'BYPASS ATIVO' : 'ATIVO'}`);
            }}
          >
            {bypass ? 'GEQ BYPASS' : 'GEQ ATIVO'}
          </button>
          <button onClick={resetFlat}>
            <RotateCcw size={14} /> Zerar Tudo (Flat)
          </button>
        </div>
      </div>

      {/* Interactive SVG Curve */}
      <section className="panel" style={{ background: '#10151d', border: '1px solid #232d39', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8' }}>
            CURVA DE RESPOSTA DO GEQ {bypass ? '(EM BYPASS)' : ''}
          </span>
          <span style={{ fontSize: '12px', color: '#58bfa6' }}>
            31 Bandas ISO · 20Hz a 20kHz
          </span>
        </div>
        <svg viewBox="0 0 960 200" style={{ width: '100%', height: '140px' }} role="img" aria-label="Curva de resposta do GEQ">
          {[-12, -6, 0, 6, 12].map(v => (
            <g key={v}>
              <line
                x1="30"
                x2="930"
                y1={100 - (v / 12) * 80}
                y2={100 - (v / 12) * 80}
                stroke={v === 0 ? '#485867' : '#1e293b'}
                strokeDasharray={v === 0 ? 'none' : '3 3'}
              />
              <text x="5" y={104 - (v / 12) * 80} fill="#64748b" fontSize="10">
                {v > 0 ? `+${v}` : v} dB
              </text>
            </g>
          ))}
          <path
            d={curvePoints()}
            fill="none"
            stroke={bypass ? '#64748b' : '#58bfa6'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </section>

      {/* Presets */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {GEQ_PRESETS.map(p => (
          <button
            key={p.name}
            className="btn-preset"
            style={{ fontSize: '12px', padding: '6px 12px', background: '#1c242f', border: '1px solid #2c3a4a', color: '#c3d0dc', borderRadius: '4px', cursor: 'pointer' }}
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 31 Vertical Sliders Grid */}
      <section className="panel" style={{ overflowX: 'auto', padding: '16px 8px' }}>
        <div style={{ display: 'flex', gap: '4px', minWidth: '920px', justifyContent: 'space-between' }}>
          {GEQ_FREQS.map((freq, i) => {
            const gain = gains[i];
            return (
              <div
                key={freq}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  minWidth: '26px',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  borderRadius: '4px',
                  padding: '4px 0',
                }}
              >
                <span style={{ fontSize: '10px', color: gain !== 0 ? '#58bfa6' : '#64748b', fontWeight: gain !== 0 ? 'bold' : 'normal', height: '16px' }}>
                  {gain > 0 ? `+${gain.toFixed(1)}` : gain < 0 ? gain.toFixed(1) : '0'}
                </span>

                <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0' }}>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={gain}
                    disabled={bypass}
                    aria-label={`GEQ ${freq} Hz`}
                    onChange={e => setGain(i, +e.target.value)}
                    style={{
                      writingMode: 'bt-lr',
                      WebkitAppearance: 'slider-vertical',
                      height: '160px',
                      width: '24px',
                      accentColor: '#58bfa6',
                      cursor: 'pointer',
                    }}
                  />
                </div>

                <span style={{ fontSize: '9px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {freq}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
