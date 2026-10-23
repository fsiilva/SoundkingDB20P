# Achados da captura 2 — comandos de escrita (22/10/2026)

Captura `mq16_controles.pcap` (~7,25 MB) com você movendo **um controle por vez**.
SHA-256 da cópia: `cc575d588553463825976b604e2e5fb054aed576768fbcd04003158707c0a754`
(original preservado na pasta). Nosso controlador não enviou nada — só observamos
o app oficial.

## 1. Fatos confirmados pelos bytes

### Canal e enquadramento dos comandos
- Os comandos de escrita saem do **app → mesa** na **porta TCP 6400**.
- Framing confirmado, igual ao da leitura:
  ```
  5A×6 | uint32 ID (BE) | uint32 LENGTH (BE) | payload
  ```
  onde `payload` = **[1 byte de tamanho] + protobuf + 2 bytes de trailer (provável checksum)**.
- O protobuf tem **campo 1 = moduleId** (omitido quando é 0, por ser proto3) e os
  demais campos com os parâmetros.

### IDs de comando confirmados (pelas suas ações reais)

| ID | Comando | Mensagem | Confirmado por |
| --- | --- | --- | --- |
| **110** | Canal (fader/mute/solo/pan) | (campo `moduleId` + parâmetro) | pan do TECLADO varrendo ±100 |
| **104** | EQ paramétrico | **EqPartModel** (completo) | EQ da GUITARRA, ganho em dB |
| **108** | Envio para bus | (moduleId + bus + nível) | ação de envio de bus |
| **114** | Saída / master | (moduleId) | ação no master/saída |

### EQ (ID 104) — totalmente decodificado
O comando carrega o **EqPartModel inteiro** (não só o que mudou). Ex. real da
GUITARRA (`moduleId=3`):
`highFreqValue=5361`, `highGainValue=2.18 dB`, `highQValue=3.0`, … e a **banda de
graves** (`lowGainValue`, campo 13) foi o que você mexeu — varreu de **−4.6 dB
até +13.6 dB** e voltou. **Isso confirma que o ganho do EQ está em dB.**

### Canal (ID 110)
- `moduleId=2` (TECLADO) com um **float no campo 2** indo de −100 a +100 e
  voltando = o **pan** que você mexeu (faixa ±100).
- Frames menores com `campo 4 = 1` nos canais BATERIA (moduleId 0, omitido) e
  BAIXO (moduleId 1) = os toques de **fader/mute/solo** do início.

## 2. Hipóteses ainda não confirmadas

- **Trailer de 2 bytes** ao fim de cada payload: provável checksum (algoritmo a definir).
- **Campo exato do nível do fader** e sua **escala** (o snapshot trazia faders em
  valores brutos ~500–900; aqui o pan é ±100 e o ganho de EQ é dB — cada parâmetro
  tem sua própria escala, a confirmar um a um).
- **Campos do bus (108)** e do **out/master (114)** — semântica detalhada a mapear.
- **Mute/solo:** provável booleano no `campo 4`; confirmar com um teste isolado.

## 3. O que isso significa

O **protocolo de escrita está substancialmente decodificado**: sabemos a porta, o
enquadramento, os IDs de comando, e que o payload é o nosso protobuf com `moduleId`
+ parâmetros. O EQ fecha 100% contra o `EqPartModel`. Juntando com a captura 1
(leitura/estado + mapa de `moduleId`), temos as duas pontas do protocolo.

## 4. Próxima evidência para fechar 100%

| Dúvida | Teste isolado que resolve |
| --- | --- |
| Checksum (2 bytes finais) | Comparar payloads idênticos exceto 1 valor; ver como os 2 bytes variam |
| Escala do fader | Mover UM fader para marcas conhecidas (−∞, 0 dB, +10) e ler o valor enviado |
| Mute vs solo (campo 4) | Só mute (sem solo) num canal, depois só solo, e comparar |
| Bus (108) campos | Um envio de bus por vez, variando nível |

Com um desses testes a gente fecha cada ponto. Mas o essencial do protocolo —
leitura **e** escrita — já está comprovado por dados reais.
