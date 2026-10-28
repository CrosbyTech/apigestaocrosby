# Balanço RFID — app Android (Urovo DT50 + RFDT50 · Bluebird RFR900)

App "casca": abre a tela `https://headcoach.crosbytech.com.br/balanco-rfid` numa
WebView (login normal do HeadCoach, lojas do usuário, INICIAR / PAUSAR /
FINALIZAR) e faz só a parte nativa:

- **leitura RFID** pelo SDK UHF da Urovo (`window.HeadcoachRfid` na página;
  respostas pelo evento `headcoach-rfid` em `window`);
- **atualização automática**: ao abrir, lê `apk-latest.json` no bucket
  `pdv-updates/balanco-rfid` do Supabase; se houver versão nova, baixa e o
  Android pede um toque em "Atualizar" (app fora da Play Store não se instala
  em silêncio).

Cada contagem finalizada vira um **"ARQUIVO BALANÇO LOJA X DATA HORA"** em
HeadCoach → Tecnologia → Balanço RFID (`/balanco-rfid/arquivos`), com resumo por
produto (EPC SGTIN-96 → EAN → produto TOTVS) e CSV. Backend: `routes/balancoRfid.routes.js`,
`services/balancoRfid.js`, tabela `balanco_rfid_arquivos` (`migrations/balanco_rfid.sql`).

## Publicar uma versão

```bash
node scripts/release.mjs --notas "o que mudou"
```

Sobe a versão (+1), compila e envia o APK + `apk-latest.json`. Use
`--manter-versao` para republicar a versão atual e `--obrigatoria` para não
deixar adiar. Mudanças só na tela (`BalancoRfidApp.jsx`) **não** precisam de
APK novo — basta o deploy do frontend.

## Build

- JDK 17 e Android SDK (plataforma 34, build-tools 34) — nesta máquina em
  `C:/Users/yagom/dev-tools` (`local.properties` aponta o SDK).
- `gradlew.bat assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.

## Chave de assinatura — GUARDAR BACKUP

`keystore/balanco-rfid.jks` + `keystore.properties` ficam **fora do git**. Toda
versão precisa ser assinada com a MESMA chave; se ela se perder, os coletores
não aceitam mais atualização (tem que desinstalar e instalar de novo).
Guarde os dois arquivos num lugar seguro.

## SDK da Urovo (`app/libs`, `app/src/main/jniLibs`)

`URFIDLibrary-v2.5.0718.jar` (+ `rfiddrive`, `platform_sdk`, `UEventObserverLibrary`,
`GripBatterySdk` e as `.so` `libhwSerial` / `libserial_port_driver`) — SDK UHF
da Urovo, obtido do pacote público `uhf_rfid_scanner` 3.1.1 (pub.dev, MIT).
Uso: `RFIDSDKManager.init` → `getRfidManager().registerCallback(IRfidCallback)`
→ `startInventory()` / `stopInventory()`; `RFIDGripManager.monitorRFDT50Status`
(bateria e estado da pistola); `GripDeviceManager.setKeyEventListener` (gatilho,
tecla 523). Se a Urovo fornecer versão mais nova do SDK, trocar os jars.

## Pistolas suportadas (drivers em `Leitor*.java`)

- **Urovo** (`LeitorUrovo`): pistola RFDT50 encaixada no coletor Urovo (ou grip
  Bluetooth da Urovo). Usada quando o aparelho é um coletor Urovo.
- **Bluebird** (`LeitorBluebird`): RFR900 / RFR900S / RFR901 por Bluetooth, em
  qualquer celular Android. Conecta sozinho na última pistola usada ou na
  primeira pareada com nome "RFR…"; na lista "Bluetooth" o nome decide a marca.
  SDK oficial "RFID INTEGRATED Android SDK" 5.90.00.09 (Bluebird, out/2026):
  `app/libs/bluebird-sled-java11.jar` + `bluebird-keymapper.jar`. Uso:
  `BTReader.getReader(ctx, handler)` → `SD_Open()` → `BT_Connect(mac)`;
  `RF_PerformInventory(turbo, false, ignorePC=true)` / `RF_StopInventory()`;
  mensagens no Handler: BTMsg 60 conectado / 61-62 caiu, SDMsg 41-42 gatilho,
  43 bateria, RFMsg 5 tag ("EPC;rssi:-54.8"). Potência 5–30 dBm.

`RfidBridge` decide o driver: coletor Urovo (fabricante ou classe de sistema
`android.device.DeviceManager`) → Urovo; senão → Bluebird.
