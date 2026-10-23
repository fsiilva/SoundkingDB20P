# Controlador Soundking DB20P (iMac Intel) — esqueleto offline

Base para controlar a mesa DB20P pela rede local, falando o mesmo protocolo do
app oficial MQ16/DM20 (descoberto por engenharia reversa). Esta fase é **offline**:
não conecta na mesa, não envia nada, não depende de captura ainda.

## O que é CONFIRMADO vs PROVISÓRIO

**Confirmado (análise estática do APK — ver relatório):**
- Transporte **TCP**, porta **6400**, host padrão **192.168.43.1** (mesa como AP Wi-Fi).
- Framing: **6× `0x5A`** (sincronismo) + **`int32` big-endian = ID do comando** + **payload protobuf**. Receptor sincroniza em 4× `0x5A`.
- Serialização **Protocol Buffers proto3** — 45 `.proto`, 52 mensagens, 516 campos (em `skdmc.descset` / `skdmc_full.proto`, tags e tipos reais).
- Mapa de IDs de envio 102–130/192 e handlers de recepção (`skdmc/commands.py`).
- Descoberta por **broadcast UDP** para `255.255.255.255`; resposta de texto vira device.

**Provisório (só a captura confirma — ver `skdmc/config.py`):**
- Se há campo de **tamanho** explícito no frame além do ID (`has_length_field`).
- **Porta UDP** do broadcast e os **bytes** da pergunta/resposta de descoberta.
- Mapa dos valores de **`moduleId`** → canal/parâmetro físico.
- Se há **login/senha** no início da sessão.
- Vínculo exato **ID → mensagem protobuf** por comando (`SEND_PROTO_GUESS`).

Nada provisório é tratado como fato: fica configurável e marcado no código.

## Estrutura

```
controller/
  skdmc.descset        descriptor set recuperado (fonte de verdade das mensagens)
  skdmc_full.proto     mesmo esquema em texto legível
  requirements.txt     dependência única: protobuf (resto é stdlib)
  skdmc/
    config.py          parâmetros confirmados x provisórios (configuráveis)
    messages.py        carrega as mensagens do descset (sem protoc; runtime)
    protocol.py        framing: encode/decode de frames TCP
    commands.py        IDs de envio + handlers de recepção + EnmCommand
    tcp_client.py      cliente TCP 6400 — COM TRAVA (não conecta/envia nesta fase)
    discovery.py       broadcast UDP — COM TRAVA (não envia nesta fase)
  tests/               testes unitários (mensagens sintéticas + fixtures)
  ui/
    server.py          servidor local stdlib (somente leitura; escrita = 403)
    index.html         prévia da interface (estado simulado, escrita desativada)
    state_sim.json     fixture de estado SIMULADO (não vem da mesa)
```

## Como rodar (offline)

```
cd controller
python3 -m unittest discover -s tests -v      # testes (39)
python3 ui/server.py                          # interface em http://127.0.0.1:8777
```

Abra `http://127.0.0.1:8777` no navegador. A interface é **modo demonstração**:
valores simulados, ajustes só na tela, nada vai à mesa.

### Interface (inspirada no MQ16)

- Fundo grafite, destaques azuis, canais em faixas verticais com fader + medidor.
- Abas: **Visão geral**, **Canais** (fader, mute/solo/pan, valor numérico no modo Pro),
  **Equalizador** (4 bandas reais do esquema + curva calculada), **Dinâmica**
  (gate/compressor), **Buses/Saídas**, **Análise de frequência**, **Config/Diagnóstico**.
- **Modo Simples / Profissional** (mesmo estado e lógica; Pro mostra valores
  precisos e parâmetros avançados). Troca no canto superior direito.
- Controles indisponíveis/ainda não conectados aparecem marcados; medidores
  simulados levam a etiqueta `sim`.

### Analisador de frequência

- **Curva de EQ**: matemática real (filtros biquad) — visualiza o ajuste, não é
  medição da mesa.
- **Espectro**: SIMULADO e rotulado (não há captação de áudio real nesta fase).
- **Sugestões consultivas** por objetivo (reduzir graves, inteligibilidade da
  voz, controlar médios, reduzir aspereza nos agudos), com Aceitar/Rejeitar
  individuais. Aceitar altera só o EQ **simulado** (demo) — nunca a mesa.
- Para espectro **real** no futuro seria preciso uma fonte de áudio (ex.: retorno
  USB da mesa ou entrada de captura no Mac) + FFT. Documentado em `skdmc/analyzer.py`.

Navegação: na aba Canais há botões ‹ anterior / próximo ›, um seletor de canal e
as **setas ← →** do teclado. O fader é arrastável (vertical); o EQ atualiza a
curva e os valores **em tempo real, sem recriar os elementos** durante o arraste.

### Verificações visuais e de interação (opcional, Chromium já presente)

- `python3 tools_screens.py` — salva PNGs de todas as abas em `screens/` (Simples e Pro).
- `python3 tools_interact.py` — testa interações reais (EQ não recria o `path`,
  fader altera o valor, navegação, mute em modo demo).
- `python3 tools_responsive.py` — captura em 1920/1280/1024/760 px e confere que
  não há rolagem horizontal (sem cortes).

### Auditoria funcional e fidelidade técnica

- `python3 tests/audit_functional.py` — testa cada controle individualmente
  (fader, mute, solo, pan, navegação, EQ freq/ganho/Q/bypass/curva, dinâmica,
  buses/envios, master, modos) e a **segurança** (nenhuma interação envia comando
  real; `/api/command` → 403). Imprime uma tabela Controle / Resultado / Validação
  / Limitação.
- `python3 tools_fidelity.py` — cruza cada parâmetro da UI com o descritor
  protobuf e gera `docs/fidelidade.md` (confirmado × provável × desconhecido).
  Nenhuma unidade/faixa é tratada como confirmada só porque o campo existe.

Achado da auditoria já corrigido: o "mute de bus" não é campo confirmado no
descritor; deixou de ser um botão clicável (que não controlava nada) e passou a
ser um indicador de leitura. Travado por teste (`tests/test_fidelity.py`).

### Controles ainda SEM comportamento funcional (por decisão, não bug)

- **Dinâmica** (gate/compressor): somente leitura até confirmar framing/`moduleId`.
- **Faders/mute de bus**: leitura (nível simulado; mute de bus não confirmado).
- **Medidores e espectro**: simulados (não há áudio/telemetria real nesta fase).
- Edição de canal/EQ/pan/master: funcional **apenas em modo demonstração**
  (`/api/demo-set`, estado em memória) — nunca alcança a mesa.

## Compatibilidade (Intel x86_64 / macOS)

- Testado em **x86_64** (mesma arquitetura do iMac 2012).
- Única dependência: **`protobuf`** (`requirements.txt`, faixa 4.x–5.x, com wheels
  x86_64 para macOS). O resto usa só a biblioteca padrão do Python 3.
- O código não usa `protoc`: as classes são construídas em runtime a partir do
  `.descset`. Compatível com protobuf 4.x e 5.x.
- Se o Python do Mac reclamar da extensão C do protobuf, force a implementação
  pura: `export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python`.
- `protoc` só seria necessário se você quiser gerar `.py` estáticos — opcional.

## Analisar um `.pcap` real (offline) — comando único

Depois da captura na igreja, um só comando faz todo o diagnóstico (fluxos, portas,
horários, frames `0x5A`, framing provável, comparação dos payloads com os
descritores e exportação JSON + Markdown):

```
cd controller
python3 -m skdmc.diagnose /caminho/mq16.pcap -o diagnostico
```

Gera `diagnostico/relatorio.md` (legível, com: fatos observados · framing e
comprimentos candidatos · IDs e canais candidatos · requisitos de inicialização ·
próxima evidência necessária) e `diagnostico/diagnostico.json`.

- **Checklist da captura presencial:** `docs/checklist_captura.md`.
- **Exemplo de relatório (dados SINTÉTICOS):** `docs/exemplo_relatorio_sintetico.md`.
- Ferramentas externas: só para **capturar** (Wireshark/`tcpdump`, ou PCAPdroid/
  captura por cabo em celular). Para **analisar** não precisa de nada além do Python
  do projeto — o leitor de `.pcap`/`.pcapng` é puro Python.

O comando `python3 -m skdmc.pcap_analyze` (análise de frames) e
`python3 -m skdmc.match_report` (decodificador dirigido de um payload) continuam
disponíveis; o `diagnose` orquestra os dois.

Gera `pcap_out/relatorio.txt` (legível) e `pcap_out/analise.json` (inspeção).
O leitor é puro Python (lê `.pcap` e `.pcapng`, sem dependências).

O que o relatório mostra:
- **Fluxos** TCP/UDP com timestamps, IPs, portas e bytes (CONFIRMADO: o que está na captura).
- No canal TCP (porta 6400): procura o sincronismo **`0x5A`** e extrai **ID (int32 BE)** + payload (CONFIRMADO).
- Testa as **duas hipóteses de framing** (com e sem campo de tamanho) e marca a
  mais provável = a que produz frames cujos payloads são **protobuf válido**
  (decoder genérico, sem esquema). Ambas ficam no relatório como hipótese.
- No UDP: mostra broadcast e respostas de texto da descoberta.

Importante: o analisador **não** decide que um ID é uma mensagem específica. Ele
confirma que o payload é protobuf e mostra os campos por número/wire-type. O
vínculo ID→mensagem só é fixado depois, casando com o `skdmc.descset` e a captura.

## Decodificador dirigido (offline, HIPÓTESE)

Dado um ID e um payload capturado, testa as mensagens do `skdmc.descset` e mede
o encaixe. Não inventa nada, não altera descritores nem `config.py`, e rotula
todo resultado como **hipótese** até validar com frames reais.

```
# a partir de um hex (payload sem o sync/id)
python3 -m skdmc.match_report --hex 08031d00007a45 --id 104
# ou de um arquivo binário, e saída JSON
python3 -m skdmc.match_report --file payload.bin --id 110 --json
```

Como a nota (score 0–1) é calculada — documentado em `skdmc/match.py`:
- +0.40 se `ParseFromString` não dá erro;
- +0.30 × (tags observadas que existem no schema ÷ tags observadas);
- +0.20 × (dessas, as com wire-type coerente ÷ tags casadas);
- +0.10 se o reencode bate **byte-a-byte** com o payload.

O relatório separa **OBSERVADO** (campos realmente nos bytes, via decoder
genérico sem esquema) de **INFERIDO** (qual mensagem seria), lista bytes/tags
não explicados e erros, e marca **ambiguidade** quando o 2º colocado está perto
do 1º. Importante: payloads curtos casam com muitas mensagens (protobuf é
estrutural) — por isso o vínculo ID→mensagem só se fecha com vários frames reais
do mesmo ID. O decodificador **não** promove hipótese a fato.

## Validação quando a mesa estiver disponível (futuro)

1. Rodar a captura passiva (ver relatório, seção "Roteiro de captura") e me enviar o `.pcap`.
2. Com a captura: fixar em `config.py` → `has_length_field`, `udp_discovery_port`,
   `discovery_probe`; mapear `moduleId`; confirmar login.
3. Adicionar testes com **frames reais** extraídos do `.pcap` (fixtures) e conferir
   que `protocol.decode_frames` reproduz os mesmos campos.
4. Só então, com sua autorização, habilitar `allow_network=True` para **leitura**
   (receber `AllData` e acompanhar mudanças), ainda sem escrever.
5. Teste de escrita controlado, um comando por vez, fora de culto.

**Nada é enviado à mesa até os passos 1–4 e sua autorização explícita.**
