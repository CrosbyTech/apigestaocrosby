package br.com.crosby.balancorfid;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.ubx.usdk.RFIDSDKManager;
import com.ubx.usdk.grip.RFID53RStatusCallBack;
import com.ubx.usdk.io.GripDeviceManager;
import com.ubx.usdk.io.listener.KeyEventListener;
import com.ubx.usdk.listener.InitListener;
import com.ubx.usdk.rfid.RFIDGripManager;
import com.ubx.usdk.rfid.RfidManager;
import com.ubx.usdk.rfid.aidl.IRfidCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Ponte entre a página /balanco-rfid e o SDK UHF da Urovo (URFIDLibrary).
 * Na página: window.HeadcoachRfid.* (chamadas) e o evento "headcoach-rfid"
 * em window (respostas): { tipo: 'status' | 'tags' | 'gatilho' | 'bluetooth' }.
 *
 * As leituras chegam etiqueta por etiqueta (centenas por segundo); juntamos
 * a cada 300 ms e mandamos um lote só, com a contagem de cada EPC.
 */
public class RfidBridge {
    private static final String TAG = "BalancoRFID";
    private static final int PERM_BT = 41;

    private final MainActivity act;
    private final WebView web;
    private final Updater updater;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Handler worker;

    private volatile boolean conectado = false;
    private volatile boolean conectando = false;
    private volatile boolean lendo = false;
    private volatile String erro = null;
    private volatile String modo = null; // "pinos" | "bluetooth"
    private volatile int moduloStatus = -1; // 0 conectado · 1 separado · 2 ligando · 3 desligado
    private volatile int bateria = -1;
    private volatile boolean carregando = false;
    private boolean gripMonitorado = false;

    private final Map<String, int[]> pendentes = new HashMap<>(); // epc -> {leituras, rssi}

    private final IRfidCallback callback = new IRfidCallback() {
        @Override
        public void onInventoryTag(String epc, String data, int rssi) {
            if (epc == null) return;
            String e = epc.trim().toUpperCase();
            if (e.isEmpty()) return;
            synchronized (pendentes) {
                int[] v = pendentes.get(e);
                if (v == null) pendentes.put(e, new int[]{1, rssi});
                else {
                    v[0]++;
                    v[1] = rssi;
                }
            }
        }

        @Override
        public void onInventoryTagEnd() {
        }
    };

    private final Runnable descarregar = new Runnable() {
        @Override
        public void run() {
            JSONArray lote = null;
            synchronized (pendentes) {
                if (!pendentes.isEmpty()) {
                    lote = new JSONArray();
                    for (Map.Entry<String, int[]> it : pendentes.entrySet()) {
                        try {
                            lote.put(new JSONObject().put("e", it.getKey()).put("c", it.getValue()[0]).put("r", it.getValue()[1]));
                        } catch (Exception ignored) {
                        }
                    }
                    pendentes.clear();
                }
            }
            if (lote != null) {
                try {
                    emitir(new JSONObject().put("tipo", "tags").put("tags", lote));
                } catch (Exception ignored) {
                }
            }
            if (lendo) ui.postDelayed(this, 300);
        }
    };

    RfidBridge(MainActivity act, WebView web, Updater updater) {
        this.act = act;
        this.web = web;
        this.updater = updater;
        HandlerThread t = new HandlerThread("rfid");
        t.start();
        worker = new Handler(t.getLooper());
    }

    boolean estaLendo() {
        return lendo;
    }

    // ─── eventos para a página ───────────────────────────────────────────────
    private void emitir(JSONObject detalhe) {
        final String js = "window.dispatchEvent(new CustomEvent('headcoach-rfid',{detail:" + detalhe.toString() + "}))";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    private JSONObject estado() {
        JSONObject o = new JSONObject();
        try {
            o.put("app", "balanco-rfid");
            o.put("versao", BuildConfig.VERSION_NAME);
            o.put("versaoCodigo", BuildConfig.VERSION_CODE);
            o.put("modelo", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("android", Build.VERSION.RELEASE);
            o.put("conectado", conectado);
            o.put("conectando", conectando);
            o.put("lendo", lendo);
            o.put("modo", modo == null ? JSONObject.NULL : modo);
            o.put("erro", erro == null ? JSONObject.NULL : erro);
            o.put("moduloStatus", moduloStatus);
            o.put("bateria", bateria);
            o.put("carregando", carregando);
            try {
                o.put("sdk", RFIDSDKManager.getInstance().getSDKVersion());
            } catch (Throwable ignored) {
            }
        } catch (Exception ignored) {
        }
        return o;
    }

    private void emitirStatus() {
        try {
            emitir(estado().put("tipo", "status"));
        } catch (Exception ignored) {
        }
    }

    void emitirGatilho(int tecla, boolean apertado) {
        try {
            emitir(new JSONObject().put("tipo", "gatilho").put("tecla", tecla).put("apertado", apertado));
        } catch (Exception ignored) {
        }
    }

    private RfidManager leitor() {
        try {
            return RFIDSDKManager.getInstance().getRfidManager();
        } catch (Throwable t) {
            return null;
        }
    }

    // ─── chamadas da página ──────────────────────────────────────────────────
    @JavascriptInterface
    public String info() {
        return estado().toString();
    }

    /** Conecta na pistola encaixada (pinos/serial). Resposta: evento status. */
    @JavascriptInterface
    public void conectar() {
        iniciarConexao(null);
    }

    /** Conecta numa pistola pareada por Bluetooth (MAC da lista). */
    @JavascriptInterface
    public void conectarBluetooth(String mac) {
        if (mac == null || mac.trim().isEmpty()) return;
        iniciarConexao(mac.trim());
    }

    private void iniciarConexao(final String mac) {
        if (conectando) return;
        conectando = true;
        erro = null;
        emitirStatus();
        worker.post(() -> {
            InitListener aoIniciar = ok -> worker.post(() -> {
                RfidManager rm = leitor();
                conectando = false;
                conectado = ok && rm != null;
                modo = mac == null ? "pinos" : "bluetooth";
                if (conectado) {
                    try {
                        rm.registerCallback(callback);
                    } catch (Throwable t) {
                        Log.e(TAG, "registerCallback", t);
                    }
                    monitorarPistola();
                } else {
                    erro = "A pistola não respondeu. Confira se está encaixada/ligada e tente de novo.";
                }
                emitirStatus();
            });
            try {
                if (mac == null) RFIDSDKManager.getInstance().init(act, aoIniciar);
                else RFIDSDKManager.getInstance().initBTtoMac(act, mac, aoIniciar);
            } catch (Throwable t) {
                Log.e(TAG, "init", t);
                conectando = false;
                conectado = false;
                erro = "Este aparelho não tem o leitor RFID da Urovo (" + t.getClass().getSimpleName() + ")";
                emitirStatus();
            }
        });
    }

    private void monitorarPistola() {
        if (gripMonitorado) return;
        gripMonitorado = true;
        try {
            RFIDGripManager.getInstance().monitorRFDT50Status(act, new RFID53RStatusCallBack() {
                @Override
                public void onReadBatteryInfo(int nivel, boolean carregandoAgora) {
                    bateria = nivel;
                    carregando = carregandoAgora;
                    emitirStatus();
                }

                @Override
                public void onModuleStatus(int st) {
                    moduloStatus = st;
                    emitirStatus();
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "monitorRFDT50Status indisponível", t);
        }
        try {
            GripDeviceManager.getInstance().setKeyEventListener(new KeyEventListener() {
                @Override
                public void event(int tecla, boolean apertado) {
                    emitirGatilho(tecla, apertado);
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "setKeyEventListener indisponível", t);
        }
    }

    @JavascriptInterface
    public void iniciar() {
        worker.post(() -> {
            RfidManager rm = leitor();
            if (!conectado || rm == null) {
                erro = "Conecte o leitor antes de iniciar.";
                emitirStatus();
                return;
            }
            int r;
            try {
                r = rm.startInventory();
            } catch (Throwable t) {
                r = -1;
                Log.e(TAG, "startInventory", t);
            }
            lendo = r == 0;
            erro = lendo ? null : "O leitor recusou iniciar a leitura (código " + r + ").";
            act.telaAcesa(lendo);
            if (lendo) ui.post(descarregar);
            emitirStatus();
        });
    }

    @JavascriptInterface
    public void pausar() {
        worker.post(() -> {
            RfidManager rm = leitor();
            try {
                if (rm != null) rm.stopInventory();
            } catch (Throwable t) {
                Log.e(TAG, "stopInventory", t);
            }
            lendo = false;
            act.telaAcesa(false);
            ui.postDelayed(descarregar, 150); // último lote
            emitirStatus();
        });
    }

    @JavascriptInterface
    public void desconectar() {
        worker.post(() -> {
            liberarSdk();
            emitirStatus();
        });
    }

    /** Potência em dBm. Resposta: evento status com { potencia, potenciaMax }. */
    @JavascriptInterface
    public void potencia() {
        worker.post(() -> {
            RfidManager rm = leitor();
            try {
                JSONObject o = estado().put("tipo", "potencia");
                if (rm != null) {
                    o.put("potencia", rm.getOutputPower());
                    o.put("potenciaMax", rm.getSupportMaxOutputPower());
                }
                emitir(o);
            } catch (Throwable t) {
                Log.e(TAG, "potencia", t);
            }
        });
    }

    @JavascriptInterface
    public void definirPotencia(final int dbm) {
        worker.post(() -> {
            RfidManager rm = leitor();
            try {
                int r = rm == null ? -1 : rm.setOutputPower(dbm);
                JSONObject o = estado().put("tipo", "potencia").put("resultado", r);
                if (rm != null) {
                    o.put("potencia", rm.getOutputPower());
                    o.put("potenciaMax", rm.getSupportMaxOutputPower());
                }
                emitir(o);
            } catch (Throwable t) {
                Log.e(TAG, "setOutputPower", t);
            }
        });
    }

    /** Lista as pistolas pareadas por Bluetooth (evento tipo "bluetooth"). */
    @JavascriptInterface
    public void listarBluetooth() {
        ui.post(() -> {
            if (Build.VERSION.SDK_INT >= 31
                    && act.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN}, PERM_BT);
                return;
            }
            enviarListaBluetooth();
        });
    }

    void aoResponderPermissao(int requestCode) {
        if (requestCode == PERM_BT) enviarListaBluetooth();
    }

    private void enviarListaBluetooth() {
        JSONArray lista = new JSONArray();
        String falha = null;
        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null) falha = "Aparelho sem Bluetooth";
            else if (!bt.isEnabled()) falha = "Ligue o Bluetooth do coletor";
            else {
                Set<BluetoothDevice> pareados = bt.getBondedDevices();
                for (BluetoothDevice d : pareados) {
                    lista.put(new JSONObject().put("nome", d.getName() == null ? "(sem nome)" : d.getName()).put("mac", d.getAddress()));
                }
            }
        } catch (SecurityException se) {
            falha = "Permita o acesso ao Bluetooth nas configurações do app";
        } catch (Exception e) {
            falha = e.getMessage();
        }
        try {
            emitir(new JSONObject().put("tipo", "bluetooth").put("dispositivos", lista).put("erro", falha == null ? JSONObject.NULL : falha));
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void verificarAtualizacao() {
        ui.post(() -> updater.verificar(true));
    }

    @JavascriptInterface
    public void recarregar() {
        ui.post(web::reload);
    }

    @JavascriptInterface
    public void vibrar(int ms) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) act.getSystemService(android.content.Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(10, Math.min(ms, 500)));
        } catch (Throwable ignored) {
        }
    }

    // ─── encerramento ────────────────────────────────────────────────────────
    private void liberarSdk() {
        try {
            RfidManager rm = leitor();
            if (rm != null) {
                if (lendo) rm.stopInventory();
                rm.unregisterCallback(callback);
            }
        } catch (Throwable ignored) {
        }
        try {
            RFIDSDKManager.getInstance().release();
        } catch (Throwable ignored) {
        }
        lendo = false;
        conectado = false;
        modo = null;
        act.telaAcesa(false);
    }

    void liberar() {
        worker.post(this::liberarSdk);
    }
}
