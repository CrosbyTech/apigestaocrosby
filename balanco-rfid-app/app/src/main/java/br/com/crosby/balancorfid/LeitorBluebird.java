package br.com.crosby.balancorfid;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Log;

import co.kr.bluebird.sled.BTReader;
import co.kr.bluebird.sled.SDConsts;

import java.util.Set;

/**
 * Pistola Bluebird (RFR900 / RFR900S / RFR901) por Bluetooth, com o SDK
 * oficial "RFID INTEGRATED Android SDK" (bluebird-sled). Tudo do SDK roda na
 * thread principal, como no app de exemplo da Bluebird; as respostas chegam
 * como mensagens no Handler: conexão (BTMsg), gatilho/bateria (SDMsg) e
 * etiquetas lidas (RFMsg, "EPC;rssi:-54.8").
 */
class LeitorBluebird implements Leitor {
    private static final String TAG = "BalancoRFID/Bluebird";
    private static final String PREF_MAC = "bluebird_mac";
    private static final long TEMPO_CONEXAO_MS = 20000;

    private final Context ctx;
    private final Ouvinte ouvinte;
    private final SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private BTReader reader;
    private boolean aberto = false;

    private boolean conectado = false;
    private boolean conectando = false;
    private boolean lendo = false;

    private final Runnable desistirDeConectar = this::desistir;

    private void desistir() {
        if (conectando && !conectado) {
            conectando = false;
            ouvinte.aoEstado(false, false, "A pistola Bluebird não respondeu. Confira se está ligada (LED azul) e perto do celular.", "bluetooth");
        }
    }

    private final Handler mensagens = new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message m) {
            try {
                tratar(m);
            } catch (Throwable t) {
                Log.e(TAG, "mensagem", t);
            }
        }
    };

    LeitorBluebird(Context ctx, Ouvinte ouvinte) {
        this.ctx = ctx;
        this.ouvinte = ouvinte;
        this.prefs = ctx.getSharedPreferences("balanco_rfid", Context.MODE_PRIVATE);
    }

    @Override
    public String marca() {
        return "bluebird";
    }

    private boolean abrir() {
        if (reader == null) reader = BTReader.getReader(ctx, mensagens);
        if (reader == null) return false;
        if (!aberto) aberto = reader.SD_Open();
        return aberto;
    }

    /** Primeira pistola pareada com nome de Bluebird (RFR900, RFR901…). */
    static String macPareadaBluebird() {
        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null) return null;
            Set<BluetoothDevice> pareados = bt.getBondedDevices();
            for (BluetoothDevice d : pareados) {
                if (pareceBluebird(d.getName())) return d.getAddress();
            }
        } catch (SecurityException ignored) {
        }
        return null;
    }

    static boolean pareceBluebird(String nome) {
        if (nome == null) return false;
        String n = nome.toUpperCase();
        return n.contains("RFR") || n.contains("BLUEBIRD");
    }

    @Override
    public void conectar(final String macEscolhido) {
        ui.post(() -> {
            try {
                if (!abrir()) {
                    ouvinte.aoEstado(false, false, "Não consegui abrir o leitor Bluebird.", "bluetooth");
                    return;
                }
                if (!reader.BT_IsEnabled()) {
                    reader.BT_Enable();
                    ouvinte.aoEstado(false, false, "Ligue o Bluetooth do celular e toque em Conectar de novo.", "bluetooth");
                    return;
                }
                if (reader.BT_GetConnectState() == SDConsts.BTConnectState.CONNECTED) {
                    aoConectar();
                    return;
                }
                String mac = macEscolhido;
                if (mac == null) mac = prefs.getString(PREF_MAC, null);
                if (mac == null) mac = macPareadaBluebird();
                if (mac == null) {
                    ouvinte.aoEstado(false, false,
                            "Nenhuma pistola Bluebird pareada. Pareie a RFR900 no Bluetooth do celular e toque em Bluetooth para escolher.",
                            "bluetooth");
                    return;
                }
                conectando = true;
                ouvinte.aoEstado(false, false, null, "bluetooth");
                int r = reader.BT_Connect(mac);
                if (r == -10) { // já conectado
                    aoConectar();
                } else if (r != 0 && r != -18) { // -18 = já conectando
                    conectando = false;
                    ouvinte.aoEstado(false, false, "A pistola Bluebird recusou a conexão (código " + r + ").", "bluetooth");
                } else {
                    prefs.edit().putString(PREF_MAC, mac).apply();
                    ui.removeCallbacks(desistirDeConectar);
                    ui.postDelayed(desistirDeConectar, TEMPO_CONEXAO_MS);
                }
            } catch (SecurityException se) {
                conectando = false;
                ouvinte.aoEstado(false, false, "Permita o acesso ao Bluetooth para o app (configurações do Android).", "bluetooth");
            } catch (Throwable t) {
                Log.e(TAG, "conectar", t);
                conectando = false;
                ouvinte.aoEstado(false, false, "Falha ao conectar na Bluebird: " + t.getMessage(), "bluetooth");
            }
        });
    }

    private void aoConectar() {
        ui.removeCallbacks(desistirDeConectar);
        conectando = false;
        conectado = true;
        try {
            String mac = reader.BT_GetConnectedDeviceAddr();
            if (mac != null) prefs.edit().putString(PREF_MAC, mac).apply();
            int bat = reader.SD_GetBatteryStatus();
            if (bat >= 0) ouvinte.aoBateria(bat, false);
        } catch (Throwable ignored) {
        }
        ouvinte.aoEstado(true, false, null, "bluetooth");
    }

    private void aoPerder(String motivo) {
        ui.removeCallbacks(desistirDeConectar);
        boolean estava = conectado || conectando;
        conectado = false;
        conectando = false;
        lendo = false;
        if (estava) ouvinte.aoEstado(false, false, motivo, "bluetooth");
    }

    private void tratar(Message m) {
        if (m.what == SDConsts.Msg.BTMsg) {
            if (m.arg1 == SDConsts.BTCmdMsg.SLED_BT_CONNECTION_ESTABLISHED) aoConectar();
            else if (m.arg1 == SDConsts.BTCmdMsg.SLED_BT_DISCONNECTED) aoPerder(null);
            else if (m.arg1 == SDConsts.BTCmdMsg.SLED_BT_CONNECTION_LOST) aoPerder("Conexão com a pistola perdida. Toque em Conectar.");
        } else if (m.what == SDConsts.Msg.SDMsg) {
            if (m.arg1 == SDConsts.SDCmdMsg.TRIGGER_PRESSED) ouvinte.aoGatilho(SDConsts.SDCmdMsg.TRIGGER_PRESSED, true);
            else if (m.arg1 == SDConsts.SDCmdMsg.TRIGGER_RELEASED) ouvinte.aoGatilho(SDConsts.SDCmdMsg.TRIGGER_PRESSED, false);
            else if (m.arg1 == SDConsts.SDCmdMsg.SLED_BATTERY_STATE_CHANGED) ouvinte.aoBateria(m.arg2, false);
            else if (m.arg1 == SDConsts.SDCmdMsg.SLED_INVENTORY_STATE_CHANGED) {
                // a pistola parou sozinha (ex.: bateria baixa)
                lendo = false;
                ouvinte.aoEstado(conectado, false, "A pistola parou a leitura (código " + m.arg2 + "). Confira a bateria.", "bluetooth");
            }
        } else if (m.what == SDConsts.Msg.RFMsg) {
            if (m.arg1 == SDConsts.RFCmdMsg.INVENTORY && m.arg2 == SDConsts.RFResult.SUCCESS && m.obj instanceof String) {
                lerEtiqueta((String) m.obj);
            } else if (m.arg1 == SDConsts.RFCmdMsg.STOP_INVENTORY && lendo) {
                lendo = false;
                ouvinte.aoEstado(conectado, false, null, "bluetooth");
            }
        }
    }

    // "3035E191640CA3000000007B;rssi:-54.8" (outros campos opcionais depois de ';')
    private void lerEtiqueta(String dado) {
        String[] partes = dado.split(";");
        String epc = partes[0].trim().toUpperCase();
        // com ignorePC=true vem só o EPC; se vier com o PC (96 bits + 4 dígitos), tira
        if (epc.length() == 28 && epc.startsWith("3")) epc = epc.substring(4);
        if (epc.isEmpty()) return;
        int rssi = 0;
        for (String p : partes) {
            if (p.startsWith("rssi:")) {
                try {
                    rssi = Math.round(Float.parseFloat(p.substring(5)));
                } catch (Exception ignored) {
                }
            }
        }
        ouvinte.aoLerTag(epc, rssi);
    }

    @Override
    public void iniciar() {
        ui.post(() -> {
            if (!conectado || reader == null) {
                ouvinte.aoEstado(conectado, false, "Conecte o leitor antes de iniciar.", "bluetooth");
                return;
            }
            int r;
            try {
                // contínuo (turbo), sem seleção, só o EPC (sem o campo PC)
                r = reader.RF_PerformInventory(true, false, true);
            } catch (Throwable t) {
                r = -1;
                Log.e(TAG, "RF_PerformInventory", t);
            }
            lendo = r == SDConsts.RFResult.SUCCESS;
            ouvinte.aoEstado(true, lendo, lendo ? null : "A pistola recusou iniciar a leitura (código " + r + ").", "bluetooth");
        });
    }

    @Override
    public void pausar() {
        ui.post(() -> {
            try {
                if (reader != null) reader.RF_StopInventory();
            } catch (Throwable t) {
                Log.e(TAG, "RF_StopInventory", t);
            }
            lendo = false;
            ouvinte.aoEstado(conectado, false, null, "bluetooth");
        });
    }

    @Override
    public void lerPotencia() {
        ui.post(() -> {
            try {
                int p = conectado && reader != null ? reader.RF_GetRadioPowerState() : -1;
                ouvinte.aoPotencia(p, SDConsts.RFPower.MAX_POWER, 0);
            } catch (Throwable t) {
                Log.e(TAG, "RF_GetRadioPowerState", t);
            }
        });
    }

    @Override
    public void definirPotencia(final int dbm) {
        ui.post(() -> {
            try {
                int v = Math.max(SDConsts.RFPower.MIN_POWER, Math.min(SDConsts.RFPower.MAX_POWER, dbm));
                int r = reader == null ? -1 : reader.RF_SetRadioPowerState(v);
                int p = reader == null ? -1 : reader.RF_GetRadioPowerState();
                ouvinte.aoPotencia(p, SDConsts.RFPower.MAX_POWER, r);
            } catch (Throwable t) {
                Log.e(TAG, "RF_SetRadioPowerState", t);
            }
        });
    }

    @Override
    public String versaoSdk() {
        return "Bluebird 5.90";
    }

    private void soltar(boolean fecharLeitor) {
        ui.removeCallbacks(desistirDeConectar);
        try {
            if (reader != null) {
                if (lendo) reader.RF_StopInventory();
                if (reader.BT_GetConnectState() == SDConsts.BTConnectState.CONNECTED) reader.BT_Disconnect();
                if (fecharLeitor && aberto) {
                    reader.SD_Close();
                    aberto = false;
                }
            }
        } catch (Throwable ignored) {
        }
        lendo = false;
        conectado = false;
        conectando = false;
    }

    @Override
    public void desconectar() {
        ui.post(() -> {
            soltar(false);
            ouvinte.aoEstado(false, false, null, null);
        });
    }

    @Override
    public void liberar() {
        ui.post(() -> soltar(true));
    }
}
