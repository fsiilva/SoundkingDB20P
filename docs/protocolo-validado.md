# DB20P — evidências de leitura, 22/10/2026

Equipamento observado em `192.168.18.162`. Aplicativo D-Touch 20 no Mac, cliente `192.168.18.17`. As conclusões abaixo se restringem ao equipamento/firmware desta sessão.

## Captura e inicialização

Original: `~/Downloads/db20p-inicializacao.pcap`. A captura ainda podia estar em andamento durante a análise. Foi extraída uma cópia limitada a registros pcap completos, preservada em `capturas/analise-inicial/snapshot.pcap`, com hash e contagens em `flows.json`. O início da captura contém uma sessão já aberta; há também uma reconexão completa posterior com SYN e resposta de inicialização.

- TCP 6400: solicitação de snapshot e resposta de configuração.
- TCP 6401: dados periódicos, observados em segmentos de 266 bytes. O mapeamento desses dados para medidores ainda não foi validado. Não é áudio FFT.
- Não foi necessário enviar autenticação no teste direto de leitura desta sessão. Isso não estabelece uma regra para todos os firmwares.
- Descoberta UDP: ainda não mapeada; não foi inventada uma sonda.

Solicitação transmitida pelo aplicativo e reproduzida pelo controlador:

```text
5a5a5a5a5a5a 00000001 00000000
sincronismo   comando  comprimento
```

A função de leitura envia esses 14 bytes fixos. Não aceita IDs arbitrários ou payloads fornecidos pelo navegador. A escrita restrita posterior está documentada em [Teste de fader canal 1](teste-fader-canal1.md).

## Perfil experimental da resposta

A resposta observada tem seis bytes `5A`, comando int32 BE = 1 e comprimento int32 BE = 16384, seguidos do bloco de 16384 bytes. Total: 16398 bytes.

No bloco foi confirmado um varint inicial com o tamanho do protobuf (`ef5a` = 11631 nesta amostra), seguido de SKDMCData e padding nulo. O parser agora lê o varint e valida os limites e padding. O parser aceita somente o comprimento capturado e grupos estruturais esperados. Esse perfil não é uma especificação universal do protocolo.

O limite do protobuf vem do comprimento varint; zeros que pertençam aos campos são preservados. TCP é remontado por buffering no transporte Node; os testes cobrem fragmentação e frames concatenados.

## Leitura direta validada

O teste Node abriu TCP 6400, enviou 14 bytes, recebeu 16398 bytes, decodificou 16 entradas e encerrou a conexão. O resultado foi preservado em `capturas/analise-inicial/leitura-direta.json`.

Exemplos de dados recebidos (sem unidade inferida):

| Entrada no descritor | moduleId | Nome | outFaderValue bruto |
| --- | --- | --- | --- |
| ch1Model | 0 | BATERIA | 508.1974 |
| ch2Model | 1 | BAIXO | 543.2173 |
| ch3Model | 2 | TECLADO | 618.5777 |
| ch4Model | 3 | GUITARRA | 667.4819 |
| ch5Model | 4 | VIOLÃO | 575 |
| ch7Model | 6 | VOZ SEM FIO | 863.3159 |

O snapshot indicou mute em BATERIA e VIOLÃO. Esses estados foram decodificados, mas a correspondência visual deve ser conferida no aplicativo/mesa. Não foram alterados pelo controlador.

A ordem de USB e SPDIF no descritor tem IDs 15 e 14 respectivamente. A interface de leitura usa a chave do descritor e moduleId, sem supor que posição na lista equivale a canal físico.

## Interface e limites

Projeto e protocolo → conectar TCP `192.168.18.162:6400` → **Ler estado real**.

O painel mostra uma leitura pontual, timestamp, nomes, IDs, mute/solo e valores brutos. O mixer continua separado e demonstrativo. Não há sincronização contínua, normalização de fader/pan, escrita, sessão de medidores ou análise de áudio real.

Para avançar: conferir os estados visualmente; capturar mudanças isoladas com autorização e condições apropriadas; validar escala, eventos e prefixo; só então implementar os controles correspondentes.

## Integração ao sistema

A tela inicial **Mesa real** agora utiliza o mesmo estado da ponte. Ao conectar pelo topo da interface, ela solicita o snapshot e atualiza a leitura a cada 6 segundos. Os nomes, mute, solo e valores brutos aparecem no mixer principal. EQ, dinâmica e buses podem ser consultados a partir do snapshot recebido. A demonstração é uma opção explícita, com estado separado.

A interface preserva a última leitura e indica dados antigos em caso de desconexão, timeout ou atraso superior a 15 segundos. Erros não provocam troca silenciosa para valores simulados. A escrita do fader BATERIA foi validada posteriormente em passos restritos, com mute ligado. Consulte o relatório do teste; demais controles, conversão de escalas, medidores e captura de áudio permanecem pendentes.
