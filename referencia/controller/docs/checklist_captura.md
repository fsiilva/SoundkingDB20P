# Checklist — captura presencial do protocolo da Soundking DB20P

Objetivo: obter uma captura de rede **legítima** da comunicação entre o app oficial
(MQ16/DM20) e a mesa, para analisar offline com `python3 -m skdmc.diagnose`.

**Segurança:** esta captura é **passiva** (só observa). Não envie comandos, não faça
varredura de rede, não mude o roteador, não tente login. O controlador deste projeto
permanece com a rede desligada (`ALLOW_NETWORK = False`).

> Não presuma rede nem IP: a mesa pode estar em Wi-Fi próprio, no Wi-Fi da igreja ou
> em cabo. O IP `192.168.43.1`/porta `6400` são o **padrão** visto no app — confirme
> na hora, não assuma que continuam válidos.

## Antes de ir
- [ ] Levar o dispositivo que roda o app oficial (o que funciona hoje: MacBook M2, ou o tablet/celular).
- [ ] Levar o computador de análise (iMac) e um pen drive para transferir o arquivo.
- [ ] Ter o Wireshark instalado no dispositivo de captura (ou saber usar `tcpdump`).
- [ ] Combinar um horário fora de culto/evento.

## Passo 1 — Como o dispositivo do app está na rede da mesa
- [ ] Verifique se o dispositivo do app está conectado:
  - à **rede Wi-Fi da própria mesa** (a DB20P como ponto de acesso), ou
  - ao **Wi-Fi da igreja** com a mesa no mesmo Wi-Fi, ou
  - por **cabo** a um switch/roteador junto da mesa.
- [ ] Anote o nome da rede (SSID) e se é a mesa que distribui o IP.

## Passo 2 — Registrar IP e informações de rede visíveis
- [ ] No dispositivo do app, anote o IP dele e o gateway:
  - macOS: `ifconfig | grep "inet "` e `netstat -nr | grep default`.
  - iOS/Android: Ajustes → Wi-Fi → (detalhes da rede).
- [ ] Se o app tiver tela de busca/scan, anote o IP que ele mostra para a mesa.
- [ ] Anote a hora (ajuda a localizar o início da sessão na captura).

## Passo 3 — Escolher o método de captura viável

**Caso A — o app roda no MESMO computador onde você captura (ideal).**
Ex.: o MacBook M2 roda o MQ16 e também o tcpdump. A captura vê todo o tráfego do app.
- [ ] Descobrir a interface: `ifconfig` (Wi-Fi costuma ser `en0`).
- [ ] Capturar tudo:
  ```
  sudo tcpdump -i en0 -s0 -w ~/mq16.pcap
  ```
  (filtro opcional, se quiser enxugar: `"port 6400 or udp or host <ip-da-mesa>"`)

**Caso B — o app roda em CELULAR/TABLET (captura no PC NÃO vê o tráfego dele).**
> Importante: uma captura feita no computador **não vê** o tráfego de outro
> dispositivo na mesma rede (redes Wi-Fi/switches modernos isolam por porta). Opções:
- [ ] **Melhor:** capturar no próprio dispositivo que roda o app (ver Caso A).
  - Android: apps de captura local (ex.: PCAPdroid) geram `.pcap` sem PC.
  - iPad/iPhone: capturar via Mac com o dispositivo conectado por cabo
    (macOS cria uma interface de captura "rvi" para o aparelho).
- [ ] **Alternativa com hardware compatível:** espelhamento de porta (port mirroring/SPAN)
  num switch gerenciável, espelhando a porta da mesa (ou do dispositivo) para o PC.
- [ ] **Alternativa:** um ponto de acesso/roteador em que você controle e consiga
  capturar (ex.: o PC compartilhando a rede para o dispositivo). Não altere o roteador da igreja.

## Passo 4 — Abrir o app e observar a comunicação normal
- [ ] Com a captura já rodando, abra o MQ16/DM20 e deixe ele **buscar** e **conectar**.
- [ ] Use a mesa normalmente por ~1–2 min, mexendo **um controle de cada vez**, com
      alguns segundos entre cada, falando/anotando o que fez e a hora:
  - um fader, depois um mute, depois uma banda de EQ, depois um envio de bus;
  - salvar e carregar uma cena.
- [ ] Isso isola, na captura, o ID e o `moduleId` de cada função.

## Passo 5 — Salvar a captura original SEM modificar
- [ ] Pare com `Ctrl+C` (tcpdump) ou Stop (Wireshark).
- [ ] Guarde o arquivo original intacto (ex.: `mq16_bruto.pcap`). Não edite.
- [ ] Faça uma cópia de trabalho para análise; o original fica preservado.

## Passo 6 — Repetir só se precisar comparar estados
- [ ] Se quiser diferenciar dois estados observáveis (ex.: mute ligado × desligado),
      faça uma segunda captura curta mudando **só** aquele controle, e nomeie claramente
      (`mute_on.pcap`, `mute_off.pcap`).

## Passo 7 — Transferir para o computador de análise
- [ ] Copie o `.pcap` para o iMac (pen drive, AirDrop, etc.).
- [ ] Rode o diagnóstico offline:
  ```
  cd controller
  python3 -m skdmc.diagnose ~/mq16_bruto.pcap -o diagnostico
  ```
- [ ] Me envie `diagnostico/relatorio.md` (ou o `.pcap`) para fecharmos o protocolo.

## Ferramentas externas necessárias
- **Para capturar:** Wireshark ou `tcpdump` (no dispositivo que roda o app).
  Em celular: PCAPdroid (Android) ou captura via Mac por cabo (iOS).
- **Para analisar:** nada além do Python 3 + `protobuf` (já no projeto). O leitor de
  `.pcap`/`.pcapng` é puro Python; não precisa de Wireshark no computador de análise.
