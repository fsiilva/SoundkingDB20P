# Soundking DB20P Studio

Controlador local em React 19, JavaScript, Vite e Node.js. O modo **Mesa real** é a tela inicial e recebe os dados da DB20P via ponte TCP. O modo **Demonstração** mantém os ajustes locais separados. O fader BATERIA possui um teste de escrita restrito, descrito abaixo.

## Executar

Requer Node.js 20.19+ ou 22.12+.

```sh
npm install
npm run dev
```

O endereço anterior na porta 5174 redireciona para 5173.

Esse comando inicia a interface em **http://127.0.0.1:5173/** e a ponte em `127.0.0.1:8787`. Se as portas já estiverem ocupadas, encerre a instância anterior. `Ctrl+C` encerra os dois processos e a conexão com o equipamento.

Conecte o computador à rede da mesa. No topo da interface, informe o IP (atualmente `192.168.18.162`) e clique **Conectar à mesa**. A conexão usa TCP 6400, solicita o primeiro snapshot e repete a leitura a cada 6 segundos. Use **Desconectar** para parar a comunicação. O botão **Reconectar** abre uma nova sessão se o socket cair. A interface não conecta automaticamente ao carregar a página.

Para execução separada, use `npm run bridge` e `npm run dev:ui`. Não execute a ponte separada junto com o iniciador combinado.

```sh
npm test
npm run build
# Iniciar servidor de produção local unificado (porta 8787):
npm start
# Preview do build de desenvolvimento; requer a ponte em outro terminal:
npm run preview -- --port 5173
```

## Deploy (EasyPanel / Docker)

O projeto está configurado para deploy com 1 clique no **EasyPanel** usando build multi-stage Docker.

- **Dockerfile**: [Dockerfile](file:///Users/flavio/Downloads/mesa_digital/projeto_mesa/Dockerfile)
- **Compose**: [docker-compose.yml](file:///Users/flavio/Downloads/mesa_digital/projeto_mesa/docker-compose.yml)
- **Porta**: `8787` (configurável via variável de ambiente `PORT`)
- **Healthcheck**: `/api/health`
- **Guia Completo**: [docs/DEPLOY_EASYPANEL.md](file:///Users/flavio/Downloads/mesa_digital/projeto_mesa/docs/DEPLOY_EASYPANEL.md)

Para testar localmente com Docker Compose:
```sh
docker compose up --build
```


## Mesa real

- Mixer de 16 entradas, organizado em dois bancos, com os nomes e moduleIds recebidos.
- Indicadores de mute e solo, fader e pan brutos, atualizados pela leitura periódica.
- Seleção e consulta de parâmetros recebidos de canal, EQ, dinâmica e buses.
- Estado compartilhado entre mixer, cabeçalho, conexão e diagnóstico.
- Horário da última leitura, erros e aviso de dados desatualizados. Após queda da conexão ou timeout, a última leitura permanece identificada como antiga; não é substituída por dados de demonstração.
- Sem medidores fictícios no mixer real. A porta TCP 6401 aparece na captura com dados periódicos, mas o significado dos bytes ainda não foi validado.
- O analisador real informa que não há fonte de áudio disponível.

**Escrita restrita:** BATERIA permite fader na faixa capturada e pan próximo ao centro, com mute ligado, além de ativar mute. Os dB exibidos são estimados pela curva do aplicativo. Outros canais, desmutar, solo, EQ, dinâmica e buses permanecem sem escrita. Consulte [a validação inicial](docs/teste-fader-canal1.md) e a atualização abaixo.

## Demonstração

A opção Demonstração permite explorar faders, mute, solo, pan, master, EQ matemático, gate, compressor, buses ilustrativos e espectro sintético. Os ajustes são locais e não comandam a mesa. Parâmetros dos canais persistem no navegador. A restauração e a exportação JSON afetam apenas a demonstração; não existe importação de cenas. Master e checklist são mantidos na sessão.

## Transporte e protocolo

- O navegador acessa `/api` no Vite; o proxy encaminha à ponte HTTP local. Node usa `net` e `dgram` para os sockets.
- A ponte abre HTTP somente em `127.0.0.1:8787`. Não há endpoint de envio arbitrário. A escrita é restrita ao fader, pan de teste e ativação de mute da BATERIA.
- A solicitação fixa de snapshot capturada no aplicativo oficial é: `5a5a5a5a5a5a0000000100000000` (14 bytes).
- `POST /api/connect`: transporte, IP, porta e `autoRead` opcional. Leitura automática exige TCP 6400.
- `POST /api/start-sync`: inicia leitura periódica em uma conexão TCP 6400 existente.
- `POST /api/read-snapshot`: leitura pontual, com intervalo mínimo de 5 segundos.
- `POST /api/channel1-fader`: passo de −1 ou +1 no fader BATERIA, com validação antes do envio e confirmação por leitura. Requer `expectedRaw` igual ao valor atual.
- `POST /api/disconnect`: encerra sockets e temporizadores.
- `GET /api/transport`: estado compartilhado e última leitura.
- Timeout de leitura: 4 segundos. A interface considera o snapshot antigo após 15 segundos ou imediatamente em caso de erro/desconexão. Erro de decodificação interrompe a repetição automática; reconecte para retomar.
- O painel técnico também oferece escuta UDP local. Ela não captura o tráfego de outros dispositivos e não confirma conexão. Porta e payload da descoberta ativa permanecem desconhecidos.

O parser usa o perfil de resposta observado neste equipamento: cabeçalho de 14 bytes, bloco de 16384 bytes, varint com comprimento do protobuf, SKDMCData e padding nulo. O prefixo foi confirmado pela captura de controle; não se afirma suporte a todo firmware. Veja [as evidências](docs/protocolo-validado.md).

`server/schema.json` deriva do descritor fornecido em `referencia/controller/skdmc.descset`. `tools/export_schema.py` permite regenerá-lo usando Python + protobuf. O servidor em operação depende apenas de Node.js e protobufjs.

## Verificação

- Build de produção aprovado.
- 26 testes JavaScript: parser, fragmentação TCP, transporte em loopback, ciclo de leitura automática, timeout, parada, estado desatualizado, recuperação da demonstração renderização do mixer real, equivalência byte a byte do encoder 110 e regras/retorno de escrita restrita.
- Leitura direta e atualização periódica testadas na mesa física, pelo mesmo proxy/API utilizado pela interface. Escrita de −1 unidade bruta no fader BATERIA confirmada por leitura, seguida de restauração confirmada; mute permaneceu ligado.
- Suíte Python da base de referência aprovada com Python 3.14 + protobuf no ambiente `.venv`. A base preservada emite ResourceWarnings; o Python 3.9 do sistema é incompatível.
- A renderização de componentes foi testada; não houve inspeção visual automatizada em navegador, pois a ferramenta correspondente não está disponível nesta sessão.

O conteúdo original do TGZ permanece em `referencia/controller/`, sem alterações nos módulos de protocolo. Os arquivos são referências técnicas, não instruções para executar ações no equipamento. Capturas e dados brutos ficam em `capturas/`, excluídos do Git. As fontes externas são opcionais e possuem fallback local.

## Controles reais da BATERIA — atualização

O painel **Controles reais · BATERIA** oferece fader arrastável na faixa capturada (0–540,817 bruto), pan experimental entre −1 e +1 e um botão para ativar mute. Arrastar muda a seleção local; **Aplicar** envia o valor e aguarda uma nova leitura para confirmar. Fader/pan requerem mute ligado. Desmutar e escrever nos demais canais permanecem bloqueados.

`POST /api/channel1-control` recebe `field` (outFaderValue, panValue ou isMuteEnable), `value`, `expectedRaw` e, opcionalmente, `expectedPan`/`expectedMute`. Somente `true` é aceito para mute. A rota antiga de passos continua compatível.

A confirmação interna usa leituras separadas por pelo menos 250 ms durante uma escrita serializada; a leitura manual mantém o intervalo de 5 segundos e a atualização automática continua a cada 6 segundos. Testes físicos de fader e pan tiveram confirmação em cerca de 0,5 segundo, com restauração ao estado anterior. Evidência: `capturas/calibracao-canal1/teste-controles.json`. O envio de mute=true foi confirmado mantendo o canal já mutado; isso não é um teste de desmutar.

Os dB com **≈** são calculados pela curva recuperada de InitConvTab/ConvertFaderValue do D-Touch 20, usada pelo próprio aplicativo para o ganho dos medidores pós-fader. Não representam calibração acústica ou validação completa da escala da mesa. O valor bruto permanece exibido. Proveniência: `docs/curva-aplicativo.json`.
