# EXEMPLO de relatório de descoberta — DADOS SINTÉTICOS

> ⚠️ Este relatório foi gerado a partir de uma **captura SINTÉTICA** criada por
> `tests/pcap_fixtures.py` (frames montados por nós com o framing confirmado e
> mensagens protobuf reais do descritor). **NÃO é tráfego da mesa.** Serve só para
> mostrar o formato da saída. Os IPs, portas e textos de descoberta são fictícios.

---

# Relatório de descoberta — exemplo.pcap

Resultados apontam para bytes DA CAPTURA. IDs/sync observados; vínculo id->mensagem e framing seguem HIPÓTESE até validação.

## 1. Fatos observados (da captura)
- Pacotes: **4** · por protocolo: {'UDP': 2, 'TCP': 2}
- Janela de tempo: 1000.0 → 1000.25 (0.25 s)
- Hosts: 192.168.43.50 (4), 192.168.43.1 (3), 255.255.255.255 (1)
- Portas de destino mais vistas:
  - TCP 6400 — 2 pkts
  - UDP 7000 — 1 pkts
  - UDP 50000 — 1 pkts

## 2. Framing e comprimentos candidatos
- CONFIRMADO (estático): sync `0x5A` (≥4) + `int32` big-endian = ID do comando.
- Fluxo 192.168.43.50:50001 → 192.168.43.1:6400: 44 bytes, sync0x5A=2, framing provável = **com_campo_tamanho_int32be**
  - [sem_campo_tamanho] frames=2 protobuf_ok=0
  - [com_campo_tamanho_int32be] frames=2 protobuf_ok=2

## 3. Mapeamento de IDs e canais candidatos (HIPÓTESE)
- ID **104** (EQ paramétrico (PEQ)): 1 amostra(s), ambígua=1.0, campos observados=[1, 4]
  - candidatos: Command×1, EqPartModel×1, FxmodulModel×1
- ID **110** (Canal (fader/mute/solo/pan)): 1 amostra(s), ambígua=1.0, campos observados=[2, 4, 5]
  - candidatos: Command×1, PeqModel×1, BusInputItemModel×1

## 4. Possíveis requisitos de inicialização / sessão
- Observar o PRIMEIRO frame de cada direção (quem fala primeiro, qual ID).
- Procurar troca inicial antes dos comandos (possível login/handshake).
- Confirmar se há um 'start data' pedindo o snapshot `AllData` (visto no estático).

## 5. Próxima evidência necessária (por dúvida)
| Dúvida | Evidência que resolve |
| --- | --- |
| Campo de tamanho no frame? | Comparar as duas hipóteses: a que der 100% protobuf-válido vence |
| Porta/bytes da descoberta UDP | Capturar o broadcast ao abrir o app |
| ID → mensagem exata | Vários frames do mesmo ID + roundtrip byte-a-byte |
| moduleId → canal físico | Mexer um controle por vez e ver qual id/campo muda |
| Login/sessão | Ver se há troca antes do primeiro comando |