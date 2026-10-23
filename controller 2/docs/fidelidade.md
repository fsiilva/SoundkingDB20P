# Fidelidade técnica — parâmetros x descritor protobuf

Classificação sem presumir unidade/escala a partir do nome do campo.

| Controle (UI) | Mensagem | Campo | Existe no descritor | Nível | Observação |
| --- | --- | --- | --- | --- | --- |
| Fader de canal | MicInOutputPartModel | `outFaderValue` | sim | CONFIRMADO (campo existe) | Campo existe. Unidade (dB) e faixa: desconhecidas. |
| Mute de canal | MicInOutputPartModel | `isMuteEnable` | sim | CONFIRMADO (campo existe) | Booleano confirmado no descritor. |
| Solo de canal | MicInOutputPartModel | `isSoloEnable` | sim | CONFIRMADO (campo existe) | Booleano confirmado no descritor. |
| Pan de canal | MicInOutputPartModel | `panValue` | sim | CONFIRMADO (campo existe) | Campo existe. Faixa real (ex.: -1..1 ou outra) desconhecida. |
| 48V (phantom) | MicInInputPartModel | `is48vEnable` | sim | CONFIRMADO (campo existe) | Booleano confirmado. |
| HPF de entrada | MicInInputPartModel | `isHPFEnable` | sim | CONFIRMADO (campo existe) | Booleano confirmado; hpfValue também existe. |
| Trim de entrada | MicInInputPartModel | `trimValue` | sim | CONFIRMADO (campo existe) | Campo existe; unidade/faixa desconhecidas. |
| EQ ganho (4 bandas) | EqPartModel | `highGainValue` | sim | CONFIRMADO (campo existe) | Campos *GainValue existem p/ high/highMid/lowMid/low. Unidade dB provável; faixa desconhecida. |
| EQ frequência | EqPartModel | `highFreqValue` | sim | CONFIRMADO (campo existe) | Campos *FreqValue existem. Faixa de Hz por banda NÃO confirmada. |
| EQ Q | EqPartModel | `highQValue` | sim | CONFIRMADO (campo existe) | Campos *QValue existem. Faixa de Q desconhecida. |
| EQ bypass | EqPartModel | `isByPass` | sim | CONFIRMADO (campo existe) | Booleano confirmado. |
| EQ tipo (shelf/peak) | EqPartModel | `highType` | sim | CONFIRMADO (campo existe) | highType/lowType existem (int). Semântica dos valores desconhecida. |
| Gate threshold | MicInDynamicPartModel | `gateThresholdValue` | sim | CONFIRMADO (campo existe) | Campo existe; unidade/faixa desconhecidas. |
| Gate attack/release/hold/depth | MicInDynamicPartModel | `gateAttackValue` | sim | CONFIRMADO (campo existe) | gateAttack/Release/Hold/Depth existem; unidades (ms/dB) PROVÁVEIS, não confirmadas. |
| Comp threshold/ratio | MicInDynamicPartModel | `compressorTresholdValue` | sim | CONFIRMADO (campo existe) | compressorTreshold/Ratio existem; escala do ratio desconhecida. |
| Comp attack/release/gain | MicInDynamicPartModel | `compressorAttackValue` | sim | CONFIRMADO (campo existe) | compressorAttack/Release/Gain existem; unidades PROVÁVEIS, não confirmadas. |
| Envio p/ bus (gain) | MicInBusModel | `gainValue` | sim | CONFIRMADO (campo existe) | gainValue/isPrefader/panValue existem. Mapa canal→bus e unidade desconhecidos. |
| Nome do canal | MicInChannelModel | `channelName` | sim | CONFIRMADO (campo existe) | String confirmada. |
| Master HPF | SetupInfoModel | `isMasterLrHPFEnable` | sim | CONFIRMADO (campo existe) | isMasterLrHPFEnable/masterLrHpfValue existem no descritor. |
| Bus 8 LPF | SetupInfoModel | `isBus8LpfEnable` | sim | CONFIRMADO (campo existe) | isBus8LpfEnable/bus8LpfValue existem. |
| Fader de bus (valor) | — | `—` | — | PROVÁVEL | OutBusModel tem outputModel; o 'fader de bus' provável mas sem campo escalar isolado confirmado. UI = leitura. |
| Mute de bus | — | `—` | — | DESCONHECIDO | Não há campo 'mute de bus' confirmado no descritor. UI mostra como indicador de leitura. |
| Medidores (nível) de canal/bus/master | MeterLevelData/SetupMeterModel | `gainValue/channelMeterStatue` | — | DESCONHECIDO | Existe estrutura de meter no descritor, mas a leitura real depende da mesa. Na UI são SIMULADOS. |
| Espectro de frequência | — | `—` | — | DESCONHECIDO | Não há espectro no protocolo. Requer fonte de áudio real + FFT. Na UI é SIMULADO. |
| moduleId → canal/parâmetro físico | (vários) | `moduleId` | — | DESCONHECIDO | Todos os modelos têm moduleId, mas o número de cada canal/parâmetro físico só se confirma na captura. |
| Framing / fim de payload | — | `—` | — | PROVÁVEL | Sync 0x5A + int32 id CONFIRMADOS no estático; campo de tamanho é hipótese até a captura. |

**Resumo:** 20 campos confirmados no descritor · 2 prováveis · 4 desconhecidos.

Confirmado = o campo existe no descritor (fato) ou veio da análise estática. Nenhuma unidade/faixa/escala é tratada como confirmada só porque o campo existe.