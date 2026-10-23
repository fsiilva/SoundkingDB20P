# Escrita experimental do fader BATERIA — 22/10/2026

## Evidências

O usuário indicou **canal 1 / BATERIA** para o teste. A captura do D-Touch 20 em `~/Downloads/db20p-canal1-fader.pcap` contém comandos de saída de canal com ID 110. O método estático `sendMicInOutputPart:` do aplicativo também usa `0x6e` (110).

O payload corresponde a **MicInOutputPartModel**, não a MicInChannelModel. Para moduleId 0, o campo pode ser omitido conforme o valor padrão proto3. Foram observados isMuteEnable (tag 4) e outFaderValue (tag 5 / float32), incluindo variações do fader e uma alternância de mute feita no aplicativo oficial. O controlador não habilita a alternância de mute.

Formato de envio observado:

```text
6 × 5A | int32BE comando 110 | int32BE tamanho protobuf | varint tamanho | protobuf
```

Exemplo do aplicativo, reproduzido byte a byte pelo encoder:

```text
5a5a5a5a5a5a 0000006e 00000007 07 20012d7771e643
```

Neste pacote, `20 01` mantém mute ligado e `2d 7771e643` codifica o float32 do fader. O comprimento do cabeçalho não inclui o varint adicional. Esse perfil de envio não deve ser confundido com o bloco de snapshot preenchido até 16384 bytes.

## Prefixo do snapshot esclarecido

Os bytes antes do protobuf são um varint com o comprimento da mensagem. Na primeira captura, `ef 5a` representa **11631**, exatamente o tamanho do SKDMCData decodificado. O parser agora lê esse comprimento e valida o padding nulo, em vez de descartar dois bytes por suposição. Não se trata de um checksum identificado.

## Teste físico concluído

O script `tools/validate-channel1.mjs` abriu uma sessão com a mesa, leu o estado atual e executou um passo de −1 unidade bruta, seguido de +1 para restaurar. A evidência detalhada foi salva em `capturas/calibracao-canal1/teste-escrita.json`.

| Etapa | Fader bruto confirmado pela mesa | Mute |
| --- | --- | --- |
| Antes | 494.82904052734375 | Ligado |
| Após −1 | 493.82904052734375 | Ligado |
| Restaurado | 494.82904052734375 | Ligado |

Cada escrita foi confirmada por um novo snapshot. Os campos de saída pan, solo, mute, moduleId e LR foram preservados e comparados na leitura de retorno. Não se afirma ausência de mudanças externas em outras áreas da mesa; elas não foram comandadas pelo teste.

## Disponibilidade no sistema

O mixer real apresenta **Fader real · BATERIA**, com botões −1 / +1 em unidades brutas. `POST /api/channel1-fader` recebe apenas `delta` (−1 ou +1) e `expectedRaw`.

Restrições verificadas no servidor:

- IP do perfil `192.168.18.162`, TCP 6400.
- Entrada `in1Model.ch1Model`, moduleId 0, nome BATERIA.
- Mute ligado na leitura atual e na leitura feita imediatamente antes da escrita.
- Fader esperado coincide com o valor lido; mudanças concorrentes impedem o envio.
- Um único passo de 1 unidade, dentro da faixa capturada de 0 a 540.817626953125.
- Operação serializada: pausa a consulta automática, faz leitura antes, envia, lê novamente e confirma. A consulta periódica é retomada após a operação.
- Outros canais e controles não possuem rota de escrita.
- Retorno divergente é reportado como erro; não se apresenta o ajuste como confirmado. A operação de interface é um ajuste intencional, não um teste que se restaura sozinho.

O script de validação executado restaurou o valor. Os botões da interface mantêm o novo valor escolhido até outro ajuste.

## Limites da escala

O print enviado confirma nomes, mute de BATERIA/VIOLÃO e posição aproximada perto de −10 dB na BATERIA. Ele não fornece duas leituras numéricas precisas antes/depois; portanto não estabelece uma conversão de toda a escala para dB. Um passo bruto não equivale a 1 dB. Pan, mute, solo, EQ, dinâmica, buses e demais faders ainda não foram habilitados para escrita.
