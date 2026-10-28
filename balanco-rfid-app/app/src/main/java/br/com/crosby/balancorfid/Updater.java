package br.com.crosby.balancorfid;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualização automática: ao abrir, lê o apk-latest.json publicado pelo
 * scripts/release.mjs (bucket pdv-updates/balanco-rfid). Se houver versão
 * nova, baixa e instala pelo PackageInstaller — o Android pede só um toque
 * em "Atualizar" (app fora da Play Store não pode se instalar em silêncio).
 */
public class Updater {
    private final Activity act;
    private File pendente; // APK baixado aguardando a permissão "instalar apps"
    private boolean verificando = false;

    Updater(Activity act) {
        this.act = act;
    }

    void verificar(final boolean avisarSemNovidade) {
        if (verificando) return;
        verificando = true;
        new Thread(() -> {
            try {
                JSONObject j = new JSONObject(baixarTexto(BuildConfig.UPDATE_URL + "?t=" + System.currentTimeMillis()));
                final int codigo = j.optInt("versionCode", 0);
                final String nome = j.optString("versionName", "");
                final String url = j.optString("url", "");
                final String notas = j.optString("notas", "");
                final boolean obrigatoria = j.optBoolean("obrigatoria", false);
                act.runOnUiThread(() -> {
                    verificando = false;
                    if (codigo > BuildConfig.VERSION_CODE && !url.isEmpty()) {
                        AlertDialog.Builder b = new AlertDialog.Builder(act)
                                .setTitle("Atualização disponível")
                                .setMessage("Versão " + nome + " (você está na " + BuildConfig.VERSION_NAME + ")."
                                        + (notas.isEmpty() ? "" : "\n\n" + notas))
                                .setCancelable(!obrigatoria)
                                .setPositiveButton("Atualizar", (d, w) -> baixarEInstalar(url));
                        if (!obrigatoria) b.setNegativeButton("Depois", null);
                        b.show();
                    } else if (avisarSemNovidade) {
                        Toast.makeText(act, "Você já está na versão mais nova (" + BuildConfig.VERSION_NAME + ")", Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception e) {
                act.runOnUiThread(() -> {
                    verificando = false;
                    if (avisarSemNovidade) Toast.makeText(act, "Não consegui verificar atualização: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private String baixarTexto(String endereco) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(endereco).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setUseCaches(false);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
            String l;
            while ((l = r.readLine()) != null) sb.append(l);
        }
        return sb.toString();
    }

    private void baixarEInstalar(final String url) {
        final AlertDialog progresso = new AlertDialog.Builder(act)
                .setTitle("Baixando atualização")
                .setMessage("0%")
                .setCancelable(false)
                .show();
        new Thread(() -> {
            try {
                File destino = new File(act.getCacheDir(), "atualizacao.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                    byte[] buf = new byte[64 * 1024];
                    long lido = 0;
                    int n;
                    int ultimo = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        lido += n;
                        if (total > 0) {
                            final int pct = (int) (lido * 100 / total);
                            if (pct != ultimo) {
                                ultimo = pct;
                                act.runOnUiThread(() -> progresso.setMessage(pct + "%"));
                            }
                        }
                    }
                }
                act.runOnUiThread(() -> {
                    progresso.dismiss();
                    instalar(destino);
                });
            } catch (Exception e) {
                act.runOnUiThread(() -> {
                    progresso.dismiss();
                    Toast.makeText(act, "Falha ao baixar a atualização: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private void instalar(File apk) {
        // Android 8+: o app precisa da permissão "instalar apps desconhecidos"
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            pendente = apk;
            new AlertDialog.Builder(act)
                    .setTitle("Permitir atualizações")
                    .setMessage("Na próxima tela, ative \"Permitir desta fonte\" para o Balanço RFID e volte para o app.")
                    .setPositiveButton("Abrir configuração", (d, w) -> act.startActivity(
                            new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()))))
                    .setNegativeButton("Cancelar", null)
                    .show();
            return;
        }
        try {
            PackageInstaller pi = act.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(act.getPackageName());
            int id = pi.createSession(params);
            try (PackageInstaller.Session s = pi.openSession(id);
                 InputStream in = new FileInputStream(apk);
                 OutputStream out = s.openWrite("balanco-rfid.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
                out.close();
                Intent i = new Intent(act, InstallResultReceiver.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pend = PendingIntent.getBroadcast(act, id, i, flags);
                s.commit(pend.getIntentSender());
            }
        } catch (Exception e) {
            Toast.makeText(act, "Falha ao instalar: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** Voltou da tela de permissão: instala o que ficou pendente. */
    void aoVoltar() {
        if (pendente != null && (Build.VERSION.SDK_INT < 26 || act.getPackageManager().canRequestPackageInstalls())) {
            File apk = pendente;
            pendente = null;
            instalar(apk);
        }
    }
}
