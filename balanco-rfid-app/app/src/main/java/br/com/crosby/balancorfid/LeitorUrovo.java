package br.com.crosby.balancorfid;

import android.content.Context;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import com.ubx.usdk.RFIDSDKManager;
import com.ubx.usdk.grip.RFID53RStatusCallBack;
import com.ubx.usdk.io.GripDeviceManager;
import com.ubx.usdk.io.listener.KeyEventListener;
import com.ubx.usdk.listener.InitListener;
import com.ubx.usdk.rfid.RFIDGripManager;
import com.ubx.usdk.rfid.RfidManager;
import com.ubx.usdk.rfid.aidl.IRfidCallback;

/**
 * Pistola Urovo (RFDT50 encaixada no DT50, ou grip Bluetooth da Urovo) pelo
 * SDK URFIDLibrary. As chamadas ao SDK rodam numa thread própria.
 */
class LeitorUrovo implements Leitor {
    private static final String TAG = "BalancoRFID/Urovo";

    private final Context ctx;
    private final Ouvinte ouvinte;
    private final Handler worker;

    private volatile boolean conectado = false;
    private volatile boolean conectando = false;
    private volatile boolean lendo = false;
    private volatile String modo = null;
    private boolean gripMonitorado = false;

    private final IRfidCallback callback = new IRfidCallback() {
        @Override
        public void onInventoryTag(String epc, String data, int rssi) {
            if (epc != null) ouvinte.aoLerTag(epc, rssi);
        }

        @Override
        public void onInventoryTagEnd() {
        }
    };

    LeitorUrovo(Context ctx, Ouvinte ouvinte) {
        this.ctx = ctx;
        this.ouvinte = ouvinte;
        HandlerThread t = new HandlerThread("rfid-urovo");
        t.start();
        worker = new Handler(t.getLooper());
    }

    @Override
    public String marca() {
        return "urovo";
    }

    private RfidManager rm() {
        try {
            return RFIDSDKManager.getInstance().getRfidManager();
        } catch (Throwable t) {
            return null;
        }
    }

    @Override
    public void conectar(final String mac) {
        if (conectando) return;
        conectando = true;
        worker.post(() -> {
            InitListener aoIniciar = ok -> worker.post(() -> {
                RfidManager rm = rm();
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
                }
                ouvinte.aoEstado(conectado, false,
                        conectado ? null : "A pistola não respondeu. Confira se está encaixada/ligada e tente de novo.", modo);
            });
            try {
                if (mac == null) RFIDSDKManager.getInstance().init(ctx, aoIniciar);
                else RFIDSDKManager.getInstance().initBTtoMac(ctx, mac, aoIniciar);
            } catch (Throwable t) {
                Log.e(TAG, "init", t);
                conectando = false;
                conectado = false;
                ouvinte.aoEstado(false, false, "Este aparelho não tem o leitor RFID da Urovo (" + t.getClass().getSimpleName() + ")", null);
            }
        });
    }

    private void monitorarPistola() {
        if (gripMonitorado) return;
        gripMonitorado = true;
        try {
            RFIDGripManager.getInstance().monitorRFDT50Status(ctx, new RFID53RStatusCallBack() {
                @Override
                public void onReadBatteryInfo(int nivel, boolean carregando) {
                    ouvinte.aoBateria(nivel, carregando);
                }

                @Override
                public void onModuleStatus(int st) {
                    ouvinte.aoModulo(st);
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "monitorRFDT50Status indisponível", t);
        }
        try {
            GripDeviceManager.getInstance().setKeyEventListener(new KeyEventListener() {
                @Override
                public void event(int tecla, boolean apertado) {
                    ouvinte.aoGatilho(tecla, apertado);
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "setKeyEventListener indisponível", t);
        }
    }

    @Override
    public void iniciar() {
        worker.post(() -> {
            RfidManager rm = rm();
            if (!conectado || rm == null) {
                ouvinte.aoEstado(conectado, false, "Conecte o leitor antes de iniciar.", modo);
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
            ouvinte.aoEstado(true, lendo, lendo ? null : "O leitor recusou iniciar a leitura (código " + r + ").", modo);
        });
    }

    @Override
    public void pausar() {
        worker.post(() -> {
            RfidManager rm = rm();
            try {
                if (rm != null) rm.stopInventory();
            } catch (Throwable t) {
                Log.e(TAG, "stopInventory", t);
            }
            lendo = false;
            ouvinte.aoEstado(conectado, false, null, modo);
        });
    }

    @Override
    public void lerPotencia() {
        worker.post(() -> {
            RfidManager rm = rm();
            try {
                ouvinte.aoPotencia(rm == null ? -1 : rm.getOutputPower(), rm == null ? -1 : rm.getSupportMaxOutputPower(), 0);
            } catch (Throwable t) {
                Log.e(TAG, "potencia", t);
            }
        });
    }

    @Override
    public void definirPotencia(final int dbm) {
        worker.post(() -> {
            RfidManager rm = rm();
            try {
                int r = rm == null ? -1 : rm.setOutputPower(dbm);
                ouvinte.aoPotencia(rm == null ? -1 : rm.getOutputPower(), rm == null ? -1 : rm.getSupportMaxOutputPower(), r);
            } catch (Throwable t) {
                Log.e(TAG, "setOutputPower", t);
            }
        });
    }

    @Override
    public String versaoSdk() {
        try {
            return "Urovo " + RFIDSDKManager.getInstance().getSDKVersion();
        } catch (Throwable t) {
            return "Urovo";
        }
    }

    private void soltar() {
        try {
            RfidManager rm = rm();
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
    }

    @Override
    public void desconectar() {
        worker.post(() -> {
            soltar();
            ouvinte.aoEstado(false, false, null, null);
        });
    }

    @Override
    public void liberar() {
        worker.post(this::soltar);
    }
}
