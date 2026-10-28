package br.com.crosby.balancorfid;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * App "Balanço RFID": abre a tela /balanco-rfid do HeadCoach (login normal do
 * HeadCoach, lojas do usuário, iniciar/pausar/finalizar a contagem) e faz só a
 * parte nativa — ler a pistola RFID da Urovo (window.HeadcoachRfid) e se
 * atualizar sozinho a partir do bucket pdv-updates.
 */
public class MainActivity extends Activity {

    private WebView web;
    private RfidBridge bridge;
    private Updater updater;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#000638"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F3F4F6"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // sessão do Supabase fica no localStorage
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // bip das leituras
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " HeadcoachBalancoRFID/" + BuildConfig.VERSION_NAME);

        updater = new Updater(this);
        bridge = new RfidBridge(this, web, updater);
        web.addJavascriptInterface(bridge, "HeadcoachRfid");

        web.setWebChromeClient(new WebChromeClient()); // alert/confirm da página
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                // HeadCoach e o login do Supabase ficam dentro do app; o resto vai pro navegador
                if (host.equals(BuildConfig.HOST) || host.endsWith("supabase.co")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) mostrarSemConexao();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BuildConfig.START_URL);

        updater.verificar(false);
    }

    private void mostrarSemConexao() {
        String html = "<html><body style='font-family:sans-serif;background:#F3F4F6;color:#000638;"
                + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center'>"
                + "<h2>Sem conexão com o HeadCoach</h2><p>Confira o Wi-Fi do coletor e toque em tentar de novo.</p>"
                + "<button style='padding:14px 28px;font-size:16px;border:0;border-radius:12px;background:#000638;color:#fff'"
                + " onclick=\"location.href='" + BuildConfig.START_URL + "'\">Tentar de novo</button></body></html>";
        web.loadDataWithBaseURL(BuildConfig.START_URL, html, "text/html", "utf-8", null);
    }

    /** Liga/desliga a tela sempre acesa (durante a contagem). */
    void telaAcesa(boolean ligar) {
        runOnUiThread(() -> {
            if (ligar) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    // Gatilho da pistola: a Urovo manda como tecla (523 = BT_SCAN; 520–522 nos
    // modelos com gatilho de leitura). Repassa para a página iniciar/pausar.
    private static boolean ehGatilho(int k) {
        return k >= 520 && k <= 523;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (ehGatilho(k)) {
            if (e.getRepeatCount() == 0) bridge.emitirGatilho(k, e.getAction() == KeyEvent.ACTION_DOWN);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        if (bridge.estaLendo()) {
            new AlertDialog.Builder(this)
                    .setTitle("Contagem em andamento")
                    .setMessage("A leitura continua em segundo plano. Deseja sair mesmo assim?")
                    .setPositiveButton("Sair", (d, w) -> moveTaskToBack(true))
                    .setNegativeButton("Ficar", null)
                    .show();
            return;
        }
        moveTaskToBack(true);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        bridge.aoResponderPermissao(requestCode);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updater.aoVoltar();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        bridge.liberar();
        web.setVisibility(View.GONE);
        web.destroy();
        super.onDestroy();
    }
}
