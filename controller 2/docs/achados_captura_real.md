# Achados da captura real — Soundking DB20P (22/10/2026)

Captura passiva feita na igreja (`mq16_bruto.pcap`, ~10,9k pacotes, 93 s), com o
MacBook rodando o MQ16 oficial na mesma rede Wi-Fi da mesa. Apenas descoberta +
conexão + estado inicial; **nenhum controle foi movido** nesta captura.

SHA-256 da cópia analisada: `0f253d86047e886fc668769e3b5736a025b64387ff197210fc321f9eb565fb46`
(original preservado na pasta `MESA DE SOM IGREJA`).

## 1. Fatos diretamente observados (confirmados pelos bytes)

- **Mesa (DB20P) nesta rede:** IP **192.168.18.162**, no Wi-Fi da igreja
  (`192.168.18.x`) — **não** no `192.168.43.1` padrão do app. O IP depende da rede;
  não é fixo.
- **Portas TCP:** **6400** (controle/estado) e **6401** (canal separado, tráfego
  intenso, valores binários — provável *metering*). Também um pacote **UDP 6399**.
- **Enquadramento na porta 6400 (CONFIRMADO):**
  ```
  5A 5A 5A 5A 5A 5A | uint32 ID (big-endian) | uint32 LENGTH (big-endian) | payload[LENGTH]
  ```
  O **campo de tamanho** — que era hipótese — está **confirmado**.
  - App → mesa: `ID=1, LENGTH=0` (o "start data", sem payload).
  - Mesa → app: `ID=1, LENGTH=16384`, payload = protobuf do estado.
  - Há **2 bytes** (`ef 5a`) entre o LENGTH e o início do protobuf — provável
    checksum/flag (ainda não confirmado).
- **O payload decodifica contra o esquema que recuperamos (`SKDMCData`):** campos
  1=In1Model, 2=In2Model, 3=BusModel, 4=SetupModel, 5=lista de PeqModel, etc.
  **O esquema de engenharia reversa está validado por dados reais.**
- **Mapa `moduleId` → canal físico (CONFIRMADO, com os nomes reais da sua mesa):**

| moduleId | canal | nome | fader (valor bruto) | mute |
| --- | --- | --- | --- | --- |
| 0 | ch1 | BATERIA | 508.2 | **mutado** |
| 1 | ch2 | BAIXO | 543.2 | — |
| 2 | ch3 | TECLADO | 618.6 | — |
| 3 | ch4 | GUITARRA | 667.5 | — |
| 4 | ch5 | VIOLÃO | 575.0 | **mutado** |
| 5 | ch6 | (sem nome) | 726.0 | — |
| 6 | ch7 | VOZ SEM FIO | 863.3 | — |
| 7 | ch8 | VOZ TALK | 742.1 | — |
| 8 | ch9 | TALK FECHADO | 0.0 | — |
| 9 | ch10 | VOZ 1 | 656.7 | — |
| 10 | ch11 | VOZ 3 | 675.2 | — |
| 11 | ch12 | VOZ 4 | 866.4 | — |
| 12 | st1 | AUX PC | 839.9 | — |
| 13 | st2 | ST 2 | 0.0 | — |
| 14 | — | SPDIF | 0.0 | — |
| 15 | — | USB | 0.0 | — |

  Também há os mixes de fone no estado (FONE VOZ, FONE BATERIA, FONE GUITA,
  FONE TECLA, FONE BAIXO) e as saídas PA L / PA R.

## 2. Hipóteses ainda não confirmadas

- **Unidade do fader:** os valores são **brutos** (~0–900+), **não dB**. O app
  converte para dB na tela; a fórmula de conversão ainda é desconhecida.
- **Os 2 bytes `ef 5a`** antes do protobuf: provável checksum/flag — a confirmar.
- **Porta 6401:** enquadramento diferente (`5A 5A` + binário). Forte candidato a
  *metering* (valores de nível), mas não decodificado ainda.
- **UDP 6399:** só 1 pacote de 2 bytes nesta captura (a mesa já era conhecida pelo
  app, então não houve broadcast de descoberta). Função a confirmar (ping/descoberta).
- **Snapshot em pedaços:** `LENGTH=16384` (0x4000) sugere envio em blocos de 16 KB;
  confirmar a remontagem de blocos para mensagens maiores que 16 KB.

## 3. Framing e comprimentos candidatos

- Porta 6400: **confirmado** `5A×6 + uint32 id + uint32 len + payload` (+2 bytes `ef5a`).
- Porta 6401: **candidato** `5A×2 + ...` (a investigar).

## 4. Mapeamento de IDs e canais

- **IDs observados nesta captura:** `1` (init/snapshot nas duas direções) e `195`
  (mesa→app, após o snapshot — provável marcador de fim/estado).
- **Canais:** mapa `moduleId` 0–15 confirmado (tabela acima).
- **IDs de comando de escrita (102, 104, …):** **NÃO observados** — porque não
  mexemos em nada nesta captura (correto). Precisam de uma 2ª captura mexendo um
  controle por vez.

## 5. Requisitos de inicialização / sessão

- Observado: app abre TCP 6400 → envia `ID=1, LEN=0` ("start data") → mesa responde
  com o snapshot `SKDMCData`. **Não** houve troca de login/senha antes do snapshot
  nesta captura — indício de que **não há autenticação** na porta 6400 (a confirmar).

## 6. Próxima evidência necessária

| Dúvida | Como resolver |
| --- | --- |
| IDs e framing dos comandos de **escrita** | 2ª captura: mover **um controle por vez** (fader, mute, EQ, bus), anotando a ordem |
| Unidade/escala do fader (bruto → dB) | Mover um fader para valores conhecidos (ex.: 0 dB, −∞) e ler o valor bruto |
| Significado de `ef 5a` | Comparar vários frames; ver se muda com o conteúdo (checksum) |
| Porta 6401 (metering?) | Decodificar o fluxo 6401 e correlacionar com níveis na tela |
| Confirmar ausência de login | Repetir a conexão e verificar que não há troca antes do snapshot |

## Resumo

A comunicação real **foi capturada e comprovada**: o esquema protobuf recuperado
bate com o estado real da mesa, e o `moduleId` de cada canal está confirmado pelos
nomes que você configurou. Falta a **segunda captura mexendo controles** para
mapear os comandos de escrita — aí o controlador pode, com sua autorização, passar
à fase de **leitura** real e, bem depois, escrita controlada.
