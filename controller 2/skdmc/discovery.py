"""Descoberta da mesa por broadcast UDP.

CONFIRMADO (ConnectActivity): o app envia um broadcast UDP para 255.255.255.255;
a mesa responde com um pacote de TEXTO contendo endereço/hostname/porta, e o IP
de quem responde vira um device "Console".

PROVISÓRIO: a porta UDP de destino e os bytes exatos da requisição NÃO foram
encontrados no estático (config.udp_discovery_port / discovery_probe). Por isso,
nesta fase a descoberta ativa fica BLOQUEADA (não envia broadcast). O parser da
resposta já está pronto para quando a captura trouxer o formato real.
"""
import socket
from . import config


class SafetyLock(RuntimeError):
    pass


def parse_discovery_reply(data: bytes):
    """Tenta extrair IP/host/porta de um pacote de resposta de texto.
    O formato exato é PROVISÓRIO; este parser é tolerante e será ajustado quando
    a captura mostrar o layout real. Retorna dict com o que conseguir ler."""
    text = data.decode("utf-8", "replace").strip()
    info = {"raw": text}
    # heurística provisória: procurar tokens de IP e número de porta
    import re
    m_ip = re.search(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", text)
    if m_ip:
        info["ip"] = m_ip.group(1)
    m_port = re.search(r"\b(\d{2,5})\b", text.split(":")[-1]) if ":" in text else None
    if m_port:
        info["port"] = int(m_port.group(1))
    return info


def discover(cfg=None, timeout=2.0, allow_network=False):
    """Envia o broadcast e coleta respostas. BLOQUEADO nesta fase:
    allow_network=False e/ou porta UDP desconhecida levantam SafetyLock."""
    cfg = cfg or config.DEFAULTS
    if not allow_network:
        raise SafetyLock("Descoberta desativada nesta fase (nada é enviado à mesa).")
    if cfg.udp_discovery_port is None or cfg.discovery_probe is None:
        raise SafetyLock(
            "Porta UDP e/ou payload de descoberta ainda desconhecidos "
            "(PROVISÓRIO). Confirme na captura antes de ativar."
        )
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(timeout)
    found = []
    try:
        s.sendto(cfg.discovery_probe, (config.UDP_BROADCAST_ADDR, cfg.udp_discovery_port))
        while True:
            try:
                data, addr = s.recvfrom(2048)
            except socket.timeout:
                break
            info = parse_discovery_reply(data)
            info.setdefault("ip", addr[0])
            found.append(info)
    finally:
        s.close()
    return found
