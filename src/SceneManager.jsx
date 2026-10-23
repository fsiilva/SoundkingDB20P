import React, { useState, useEffect } from 'react';
import { Disc3, Save, Download, Upload, Trash2, Play, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { useDesk } from './DeskContext';

const DEFAULT_CHURCH_SCENES = [
  {
    id: 'culto-principal',
    name: 'Culto Principal · Banda Completa',
    description: 'Vocais principais equilibrados em 0 dB, bateria, baixo, guitarra e teclado ativos.',
    builtIn: true,
    master: { fader: 750, mute: false },
    channels: [
      { moduleId: 0, faderRaw: 680, mute: false, pan: 0 },
      { moduleId: 1, faderRaw: 720, mute: false, pan: 0 },
      { moduleId: 2, faderRaw: 700, mute: false, pan: 15 },
      { moduleId: 3, faderRaw: 710, mute: false, pan: -20 },
      { moduleId: 4, faderRaw: 730, mute: false, pan: 0 },
      { moduleId: 5, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 6, faderRaw: 760, mute: false, pan: 0 },
      { moduleId: 7, faderRaw: 740, mute: false, pan: 0 },
      { moduleId: 8, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 9, faderRaw: 750, mute: false, pan: -10 },
      { moduleId: 10, faderRaw: 750, mute: false, pan: 10 },
      { moduleId: 11, faderRaw: 740, mute: false, pan: 0 },
      { moduleId: 12, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 13, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 14, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 15, faderRaw: 650, mute: false, pan: 0 },
    ]
  },
  {
    id: 'momento-palavra',
    name: 'Momento da Palavra · Apenas Pastor / Pregador',
    description: 'Microfone do Pastor / Voz Principal ativo em 0 dB. Todos os instrumentos da banda mutados imediatamente.',
    builtIn: true,
    master: { fader: 750, mute: false },
    channels: [
      { moduleId: 0, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 1, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 2, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 3, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 4, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 5, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 6, faderRaw: 760, mute: false, pan: 0 },
      { moduleId: 7, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 8, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 9, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 10, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 11, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 12, faderRaw: 600, mute: false, pan: 0 }, // PC / Fundo musical suave
      { moduleId: 13, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 14, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 15, faderRaw: 0, mute: true, pan: 0 },
    ]
  },
  {
    id: 'acustico',
    name: 'Culto Acústico · Voz e Violão',
    description: 'Voz Principal, Voz Apoio, Violão e Teclado/Piano ativos. Bateria e guitarras mutados.',
    builtIn: true,
    master: { fader: 750, mute: false },
    channels: [
      { moduleId: 0, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 1, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 2, faderRaw: 720, mute: false, pan: 0 },
      { moduleId: 3, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 4, faderRaw: 740, mute: false, pan: 0 },
      { moduleId: 5, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 6, faderRaw: 760, mute: false, pan: 0 },
      { moduleId: 7, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 8, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 9, faderRaw: 750, mute: false, pan: 0 },
      { moduleId: 10, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 11, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 12, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 13, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 14, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 15, faderRaw: 0, mute: true, pan: 0 },
    ]
  },
  {
    id: 'ensaio-banda',
    name: 'Ensaio da Banda · Níveis Moderados',
    description: 'Todos os canais ativos em nível confortável (-5 dB) para passagem de som.',
    builtIn: true,
    master: { fader: 680, mute: false },
    channels: [
      { moduleId: 0, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 1, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 2, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 3, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 4, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 5, faderRaw: 600, mute: false, pan: 0 },
      { moduleId: 6, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 7, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 8, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 9, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 10, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 11, faderRaw: 700, mute: false, pan: 0 },
      { moduleId: 12, faderRaw: 650, mute: false, pan: 0 },
      { moduleId: 13, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 14, faderRaw: 0, mute: true, pan: 0 },
      { moduleId: 15, faderRaw: 600, mute: false, pan: 0 },
    ]
  }
];

export default function SceneManager({ onToast }) {
  const { state, busy, action } = useDesk();
  const [scenes, setScenes] = useState(() => {
    try {
      const saved = localStorage.getItem('db20p.custom_scenes');
      if (saved) return [...DEFAULT_CHURCH_SCENES, ...JSON.parse(saved)];
    } catch {}
    return DEFAULT_CHURCH_SCENES;
  });

  const [sceneName, setSceneName] = useState('');
  const [activeSceneId, setActiveSceneId] = useState('');

  const saveCustomScenes = list => {
    const customOnly = list.filter(s => !s.builtIn);
    try {
      localStorage.setItem('db20p.custom_scenes', JSON.stringify(customOnly));
    } catch {}
  };

  const handleSaveCurrent = () => {
    if (!sceneName.trim()) {
      alert('Digite um nome para a cena.');
      return;
    }
    const currentChannels = (state?.snapshot?.channels || []).map(ch => ({
      moduleId: ch.moduleId,
      faderRaw: ch.faderRaw ?? ch.outFaderValue ?? 0,
      mute: ch.mute ?? false,
      pan: ch.pan ?? ch.rawPan ?? 0,
      solo: ch.solo ?? false,
      lr: ch.lr ?? true,
    }));

    const currentMaster = {
      fader: state?.snapshot?.master?.fader ?? 500,
      mute: state?.snapshot?.master?.mute ?? false,
    };

    const newScene = {
      id: 'custom-' + Date.now(),
      name: sceneName.trim(),
      description: `Salva em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`,
      builtIn: false,
      master: currentMaster,
      channels: currentChannels,
    };

    const nextList = [...scenes, newScene];
    setScenes(nextList);
    saveCustomScenes(nextList);
    setSceneName('');
    setActiveSceneId(newScene.id);
    onToast?.(`Cena "${newScene.name}" salva com sucesso!`);
  };

  const handleApplyScene = async scene => {
    setActiveSceneId(scene.id);
    await action('apply-scene', scene);
    onToast?.(`Cena "${scene.name}" aplicada na mesa!`);
  };

  const handleDeleteScene = id => {
    if (!confirm('Deseja excluir esta cena salva?')) return;
    const nextList = scenes.filter(s => s.id !== id);
    setScenes(nextList);
    saveCustomScenes(nextList);
    onToast?.('Cena excluída.');
  };

  const handleExportAll = () => {
    const blob = new Blob([JSON.stringify(scenes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cenas-db20p-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Arquivo de cenas exportado com sucesso.');
  };

  const handleImportFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (Array.isArray(imported)) {
          const custom = imported.filter(s => !s.builtIn);
          const merged = [...DEFAULT_CHURCH_SCENES, ...custom];
          setScenes(merged);
          saveCustomScenes(merged);
          onToast?.(`${custom.length} cenas importadas com sucesso!`);
        }
      } catch (err) {
        alert('Arquivo de cenas inválido: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="scene-manager" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="section-toolbar">
        <div>
          <h2>Gerenciador de Cenas e Snapshots · Soundking DB20P</h2>
          <p>Salve e recupere configurações completas do mixer para diferentes momentos da igreja.</p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleExportAll}>
            <Download size={14} /> Exportar Todas as Cenas (JSON)
          </button>
          <label className="icon-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: '#1c242f', border: '1px solid #2c3a4a', padding: '6px 12px', borderRadius: '6px', fontSize: '13px' }}>
            <Upload size={14} /> Importar Cenas
            <input type="file" accept=".json" onChange={handleImportFile} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* Save current state card */}
      <section className="panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <Disc3 size={24} color="#58bfa6" />
        <div style={{ flex: 1, minWidth: '240px' }}>
          <strong style={{ fontSize: '15px' }}>Salvar Estado Atual da Mesa como Nova Cena</strong>
          <p style={{ margin: '2px 0 0', color: '#8b9caa', fontSize: '12px' }}>
            Grava a posição de todos os 16 faders, mutes, solos, rota LR e master.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Ex: Culto Domingo Noite"
            value={sceneName}
            onChange={e => setSceneName(e.target.value)}
            style={{ padding: '8px 12px', background: '#10151d', border: '1px solid #2a3644', borderRadius: '6px', color: '#fff' }}
          />
          <button disabled={busy} onClick={handleSaveCurrent} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Save size={14} /> Salvar Cena
          </button>
        </div>
      </section>

      {/* Scenes List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {scenes.map(s => {
          const isActive = activeSceneId === s.id;
          return (
            <div
              key={s.id}
              className="panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '12px',
                border: isActive ? '1px solid #58bfa6' : '1px solid #232d39',
                background: isActive ? 'rgba(88, 191, 166, 0.05)' : '#161d27',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#e2e8f0' }}>{s.name}</h3>
                  {s.builtIn ? (
                    <span className="pill" style={{ fontSize: '10px' }}>Template Igreja</span>
                  ) : (
                    <span className="pill" style={{ fontSize: '10px', background: '#2d3748' }}>Personalizada</span>
                  )}
                </div>
                <p style={{ color: '#8b9caa', fontSize: '12px', margin: '6px 0 0' }}>{s.description}</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', borderTop: '1px solid #24303e', paddingTop: '10px' }}>
                <button
                  disabled={busy}
                  onClick={() => handleApplyScene(s)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: isActive ? '#58bfa6' : '#2563eb',
                    color: '#fff',
                    fontWeight: 'bold',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <Play size={14} /> {isActive ? 'Cena Ativa na Mesa' : 'Carregar Cena'}
                </button>

                {!s.builtIn && (
                  <button
                    onClick={() => handleDeleteScene(s.id)}
                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px' }}
                    title="Excluir cena"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
