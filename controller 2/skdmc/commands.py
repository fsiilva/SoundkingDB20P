"""IDs de comando do protocolo.

CONFIRMADO (SendCommandManager.send###Command): os números dos comandos de
ENVIO e o que cada um ajusta. O número é o int32 que vai no frame logo após o
sincronismo 0x5A.

ATENÇÃO sobre o payload: no app, cada send###Command recebe um "model" da
camada de UI e o converte para a mensagem protobuf de `com.amo.skdmc.data`.
O vínculo id -> mensagem protobuf exata NÃO está 100% determinado estaticamente
em todos os casos; por isso `SEND_PROTO_GUESS` é marcado como PROVISÓRIO e só
deve ser fixado após a captura (ou leitura mais profunda de cada send###Command).
"""

# --- CONFIRMADO: id -> rótulo semântico (o que o comando ajusta) ---
SEND_COMMANDS = {
    102: "Estágio de entrada do canal (ganho/phantom/etc.)",
    104: "EQ paramétrico (PEQ)",
    106: "Dinâmica (gate/compressor)",
    108: "Envio para bus",
    110: "Canal (fader/mute/solo/pan)",
    112: "Entrada de saída (out input)",
    114: "Saída (out output)",
    116: "Setup geral",
    118: "Patch de saída",
    120: "FX modulação",
    122: "FX delay",
    124: "FX reverb",
    126: "FX GEQ",
    128: "Monitor",
    130: "Medidores (meter)",
    192: "Gravador/player",
}

# --- PROVISÓRIO: id -> mensagem protobuf provável (confirmar na captura) ---
# Baseado no nome do model recebido por cada send###Command. NÃO usar para
# escrita real antes de confirmar.
SEND_PROTO_GUESS = {
    104: "PeqModel",
    106: "DynamicModel",
    108: "MicInBusModel",
    110: "MicInChannelModel",
    112: "MicInInputPartModel",
    114: "MicInOutputPartModel",
    116: "SetupModel",
    118: "SetupPatchModel",
    120: "SetupFxModulModel",
    122: "SetupFxDelayModel",
    124: "SetupFxReverbModel",
    126: "SetupFxGeqModel",
    128: "SetupMonitorModel",
    130: "SetupMeterModel",
}

# --- CONFIRMADO: handlers de recepção (CmdHandler.processCommand) ---
# Semântica de cada evento vindo da mesa. Os números exatos de cada um ainda
# dependem de ler o packed-switch / confirmar na captura (alguns vistos: scenes
# 143, 157, 159, 161). Por isso a chave aqui é o NOME do handler, não o número.
RECEIVE_HANDLERS = [
    "proccessAllDataCmd",                 # snapshot completo -> SKDMCData
    "proccessMicInputPartModelChangedEvent",
    "proccessMicEqPartModelChangedEvent",
    "proccessMicDynamicPartModelChangedEvent",
    "proccessMicBusPartModelChangedEvent",
    "proccessMicOutputPartModelChangedEvent",
    "proccessBusInputPartModelChangedEvent",
    "proccessBusOutputPartModelChangedEvent",
    "proccessSetupInfoPartModelChangedEvent",
    "proccessSetupPatchPartModelChangedEvent",
    "proccessSetupFxModulPartModelChangedEvent",
    "proccessSetupFxDelayPartModelChangedEvent",
    "proccessSetupFxReverbPartModelChangedEvent",
    "proccessSetupFxGeqPartModelChangedEvent",
    "proccessSetupMonitorPartModelChangedEvent",
    "proccessSetupMeterPartModelChangedEvent",
    "proccessIn1AndIn2ChannelNamePartModelChangedEvent",
    "proccessOutChannelNamePartModelChangedEvent",
    "processMeterData",
    # cenas / mídia / bibliotecas: ver relatório
]

# --- CONFIRMADO: enum EnmCommand (command.proto) para botões genéricos ---
ENM_COMMAND = {
    "PlayBtn": 0, "CopyBtn": 1, "PastBtn": 2,
    "Record_Stop": 3, "Record_Play": 4, "Record_FirstSong": 5,
    "Record_PrevSong": 6, "Record_NextSong": 7, "Record_LastSong": 8,
    "Record_ModeChanged": 9, "Record_Record": 10,
    "Scene_Export": 11, "Scene_GetImportFileList": 12, "Scene_Import": 13,
}
