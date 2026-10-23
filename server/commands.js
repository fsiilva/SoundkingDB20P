/**
 * Dicionário de comandos do protocolo Soundking DB20P.
 * Confirmado através de engenharia reversa do aplicativo oficial (CmdHandler / SendCommandManager).
 */

// IDs de comando de ENVIO confirmados e seus alvos
export const SEND_COMMANDS = Object.freeze({
  102: 'Estágio de entrada do canal (ganho/phantom/etc.)',
  104: 'EQ paramétrico (PEQ)',
  106: 'Dinâmica (gate/compressor)',
  108: 'Envio para bus',
  110: 'Canal (fader/mute/solo/pan)',
  112: 'Entrada de saída (out input)',
  114: 'Saída (out output)',
  116: 'Setup geral',
  118: 'Patch de saída',
  120: 'FX modulação',
  122: 'FX delay',
  124: 'FX reverb',
  126: 'FX GEQ',
  128: 'Monitor',
  130: 'Medidores (meter)',
  192: 'Gravador/player',
});

// Mensagem protobuf provável associada a cada ID de comando
export const SEND_PROTO_GUESS = Object.freeze({
  104: 'PeqModel',
  106: 'DynamicModel',
  108: 'MicInBusModel',
  110: 'MicInChannelModel',
  112: 'MicInInputPartModel',
  114: 'MicInOutputPartModel',
  116: 'SetupModel',
  118: 'SetupPatchModel',
  120: 'SetupFxModulModel',
  122: 'SetupFxDelayModel',
  124: 'SetupFxReverbModel',
  126: 'SetupFxGeqModel',
  128: 'SetupMonitorModel',
  130: 'SetupMeterModel',
});

// Handlers de recepção confirmados (CmdHandler.processCommand)
export const RECEIVE_HANDLERS = Object.freeze([
  'proccessAllDataCmd', // snapshot completo -> SKDMCData (ID=1)
  'proccessMicInputPartModelChangedEvent',
  'proccessMicEqPartModelChangedEvent',
  'proccessMicDynamicPartModelChangedEvent',
  'proccessMicBusPartModelChangedEvent',
  'proccessMicOutputPartModelChangedEvent',
  'proccessBusInputPartModelChangedEvent',
  'proccessBusOutputPartModelChangedEvent',
  'proccessSetupInfoPartModelChangedEvent',
  'proccessSetupPatchPartModelChangedEvent',
  'proccessSetupFxModulPartModelChangedEvent',
  'proccessSetupFxDelayPartModelChangedEvent',
  'proccessSetupFxReverbPartModelChangedEvent',
  'proccessSetupFxGeqPartModelChangedEvent',
  'proccessSetupMonitorPartModelChangedEvent',
  'proccessSetupMeterPartModelChangedEvent',
  'proccessIn1AndIn2ChannelNamePartModelChangedEvent',
  'proccessOutChannelNamePartModelChangedEvent',
  'processMeterData',
]);

// Enum EnmCommand (command.proto) para controle de transporte/botões
export const ENM_COMMAND = Object.freeze({
  PlayBtn: 0,
  CopyBtn: 1,
  PastBtn: 2,
  Record_Stop: 3,
  Record_Play: 4,
  Record_FirstSong: 5,
  Record_PrevSong: 6,
  Record_NextSong: 7,
  Record_LastSong: 8,
  Record_ModeChanged: 9,
  Record_Record: 10,
  Scene_Export: 11,
  Scene_GetImportFileList: 12,
  Scene_Import: 13,
});
