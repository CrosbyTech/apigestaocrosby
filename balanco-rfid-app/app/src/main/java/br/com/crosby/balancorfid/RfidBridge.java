package br.com.crosby.balancorfid;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Ponte entre a página /balanco-rfid e as pistolas RFID.
 * Na página: window.HeadcoachRfid.* (chamadas) e o evento "headcoach-rfid"
 * em window (respostas): { tipo: 'status' | 'tags' | 'gatilho' | 'potencia' | 'bluetooth' }.
 *
 * Dois drivers ({@link Leitor}): Urovo (pistola RFDT50 encaixada no coletor
 * Urovo) e Bluebird (RFR900/RFR901 por Bluetooth, em qualquer celular Android).
 * Coletor Urovo → Urovo; outro celular → Bluebird. Na escolha manual por
 * Bluetooth, o nome do aparelho pareado decide (RFR…/BLUEBIRD → Bluebird).
 *
 * As leituras chegam etiqueta por etiqueta (centenas por segundo); juntamos
 * a cada 300 ms e mandamos um lote só, com a contagem de cada EPC.
 */
public class RfidBridge implements Leitor.Ouvinte {
    private static final int PERM_BT = 41;

    private final MainActivity act;
    private final WebView web;
    private final Updater updater;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private Leitor atual;
    private LeitorUrovo urovo;
    private LeitorBluebird bluebird;
    private String acaoPendente; // após a permissão do Bluetooth: "listar" | "auto" | "mac:<mac>"

    private volatile boolean conectado = false;
    private volatile boolean conectando = false;
    private volatile boolean lendo = false;
    private volatile String erro = null;
    private volatile String modo = null; // "pinos" | "bluetooth"
    private volatile int moduloStatus = -1;
    private volatile int bateria = -1;
    private volatile boolean carregando = false;

    private final Map<String, int[]> pendentes = new HashMap<>(); // epc -> {leituras, rssi}

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
    }

    boolean estaLendo() {
        return lendo;
    }

    private static Boolean coletorUrovo;

    /**
     * Coletor Urovo? Pelo fabricante e, para não depender do nome, pela classe
     * de sistema android.device.DeviceManager: num Urovo ela vem do próprio
     * Android (carregador de boot); nos outros celulares só existe a cópia que
     * vai dentro do APK (mesmo carregador do app).
     */
    static boolean ehColetorUrovo() {
        if (coletorUrovo != null) return coletorUrovo;
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase();
        boolean sim = m.contains("urovo");
        if (!sim) {
            try {
                Class<?> c = Class.forName("android.device.DeviceManager");
                sim = c.getClassLoader() != RfidBridge.class.getClassLoader();
            } catch (Throwable ignored) {
            }
        }
        coletorUrovo = sim;
        return sim;
    }

    private Leitor usar(String marca) {
        if (atual != null && !atual.marca().equals(marca)) {
            atual.liberar();
            atual = null;
            conectado = false;
            lendo = false;
        }
        if ("urovo".equals(marca)) {
            if (urovo == null) urovo = new LeitorUrovo(act, this);
            atual = urovo;
        } else {
            if (bluebird == null) bluebird = new LeitorBluebird(act, this);
            atual = bluebird;
        }
        return atual;
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
            o.put("coletorUrovo", ehColetorUrovo());
            o.put("marca", atual == null ? JSONObject.NULL : atual.marca());
            o.put("conectado", conectado);
            o.put("conectando", conectando);
            o.put("lendo", lendo);
            o.put("modo", modo == null ? JSONObject.NULL : modo);
            o.put("erro", erro == null ? JSONObject.NULL : erro);
            o.put("moduloStatus", moduloStatus);
            o.put("bateria", bateria);
            o.put("carregando", carregando);
            o.put("sdk", atual == null ? JSONObject.NULL : atual.versaoSdk());
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

    // ─── Leitor.Ouvinte (respostas dos drivers) ──────────────────────────────
    @Override
    public void aoEstado(boolean conectadoAgora, boolean lendoAgora, String erroAgora, String modoAgora) {
        boolean comecou = lendoAgora && !lendo;
        conectado = conectadoAgora;
        conectando = false;
        lendo = lendoAgora;
        erro = erroAgora;
        if (modoAgora != null || !conectadoAgora) modo = modoAgora;
        act.telaAcesa(lendo);
        if (comecou) ui.post(descarregar);
        if (!lendo) ui.postDelayed(descarregar, 150); // último lote
        emitirStatus();
    }

    @Override
    public void aoLerTag(String epc, int rssi) {
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
    public void aoGatilho(int tecla, boolean apertado) {
        emitirGatilho(tecla, apertado);
    }

    @Override
    public void aoBateria(int nivel, boolean carregandoAgora) {
        bateria = nivel;
        carregando = carregandoAgora;
        emitirStatus();
    }

    @Override
    public void aoModulo(int status) {
        moduloStatus = status;
        emitirStatus();
    }

    @Override
    public void aoPotencia(int atualDbm, int max, int resultado) {
        try {
            emitir(estado().put("tipo", "potencia").put("potencia", atualDbm).put("potenciaMax", max).put("resultado", resultado));
        } catch (Exception ignored) {
        }
    }

    // ─── permissão do Bluetooth (Android 12+) ────────────────────────────────
    private boolean temPermissaoBt() {
        return Build.VERSION.SDK_INT < 31
                || act.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void pedirPermissaoBt(String acao) {
        acaoPendente = acao;
        act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN}, PERM_BT);
    }

    void aoResponderPermissao(int requestCode) {
        if (requestCode != PERM_BT) return;
        String acao = acaoPendente;
        acaoPendente = null;
        if (!temPermissaoBt()) {
            erro = "Sem permissão de Bluetooth não dá para usar a pistola Bluebird.";
            emitirStatus();
            return;
        }
        if ("listar".equals(acao)) enviarListaBluetooth();
        else if ("auto".equals(acao)) conectarBluebird(null);
        else if (acao != null && acao.startsWith("mac:")) conectarBluetooth(acao.substring(4));
    }

    // ─── chamadas da página ──────────────────────────────────────────────────
    @JavascriptInterface
    public String info() {
        return estado().toString();
    }

    /** Automático: coletor Urovo → pistola encaixada; outro celular → Bluebird pareada. */
    @JavascriptInterface
    public void conectar() {
        ui.post(() -> {
            if (ehColetorUrovo()) {
                conectando = true;
                erro = null;
                emitirStatus();
                usar("urovo").conectar(null);
            } else {
                conectarBluebird(null);
            }
        });
    }

    private void conectarBluebird(String mac) {
        if (!temPermissaoBt()) {
            pedirPermissaoBt(mac == null ? "auto" : "mac:" + mac);
            return;
        }
        conectando = true;
        erro = null;
        emitirStatus();
        usar("bluebird").conectar(mac);
    }

    /** Conecta numa pistola pareada por Bluetooth (MAC da lista). */
    @JavascriptInterface
    public void conectarBluetooth(final String mac) {
        if (mac == null || mac.trim().isEmpty()) return;
        ui.post(() -> {
            if (!temPermissaoBt()) {
                pedirPermissaoBt("mac:" + mac.trim());
                return;
            }
            String nome = nomeDoPareado(mac.trim());
            if (LeitorBluebird.pareceBluebird(nome) || !ehColetorUrovo()) {
                conectarBluebird(mac.trim());
            } else {
                conectando = true;
                erro = null;
                emitirStatus();
                usar("urovo").conectar(mac.trim());
            }
        });
    }

    private String nomeDoPareado(String mac) {
        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null) return null;
            for (BluetoothDevice d : bt.getBondedDevices()) {
                if (mac.equalsIgnoreCase(d.getAddress())) return d.getName();
            }
        } catch (SecurityException ignored) {
        }
        return null;
    }

    @JavascriptInterface
    public void iniciar() {
        ui.post(() -> {
            if (atual == null || !conectado) {
                erro = "Conecte o leitor antes de iniciar.";
                emitirStatus();
                return;
            }
            atual.iniciar();
        });
    }

    @JavascriptInterface
    public void pausar() {
        ui.post(() -> {
            if (atual != null) atual.pausar();
        });
    }

    @JavascriptInterface
    public void desconectar() {
        ui.post(() -> {
            if (atual != null) atual.desconectar();
        });
    }

    /** Potência em dBm. Resposta: evento "potencia" com { potencia, potenciaMax }. */
    @JavascriptInterface
    public void potencia() {
        ui.post(() -> {
            if (atual != null) atual.lerPotencia();
        });
    }

    @JavascriptInterface
    public void definirPotencia(final int dbm) {
        ui.post(() -> {
            if (atual != null) atual.definirPotencia(dbm);
        });
    }

    /** Lista as pistolas pareadas por Bluetooth (evento tipo "bluetooth"). */
    @JavascriptInterface
    public void listarBluetooth() {
        ui.post(() -> {
            if (!temPermissaoBt()) {
                pedirPermissaoBt("listar");
                return;
            }
            enviarListaBluetooth();
        });
    }

    private void enviarListaBluetooth() {
        JSONArray lista = new JSONArray();
        String falha = null;
        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            if (bt == null) falha = "Aparelho sem Bluetooth";
            else if (!bt.isEnabled()) falha = "Ligue o Bluetooth do celular";
            else {
                Set<BluetoothDevice> pareados = bt.getBondedDevices();
                for (BluetoothDevice d : pareados) {
                    String nome = d.getName() == null ? "(sem nome)" : d.getName();
                    lista.put(new JSONObject()
                            .put("nome", nome)
                            .put("mac", d.getAddress())
                            .put("marca", LeitorBluebird.pareceBluebird(nome) ? "bluebird" : JSONObject.NULL));
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

    void liberar() {
        if (urovo != null) urovo.liberar();
        if (bluebird != null) bluebird.liberar();
        lendo = false;
        conectado = false;
        act.telaAcesa(false);
    }
}
