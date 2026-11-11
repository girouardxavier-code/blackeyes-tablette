package fr.cieldirect.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ciel Direct : coquille Android de l'application web (dossier assets/www).
 * - Les fichiers de l'application sont servis sous https://appassets.androidplatform.net/ (origine stable :
 *   réglages mémorisés, sécurité du contenu).
 * - Les appels aux services de données passent par un pont natif (pas de restriction CORS).
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final Set<String> API_HOSTS = new HashSet<String>(Arrays.asList(
            "api.adsb.lol", "opensky-network.org", "api.planespotters.net"));
    private static final int REQ_LOC = 1;

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b1220"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " CielDirect/1.0");

        web.addJavascriptInterface(new Bridge(), "CDNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    WebResourceResponse r = new WebResourceResponse(mime(path), "utf-8", in);
                    Map<String, String> h = new HashMap<String, String>();
                    h.put("Cache-Control", "no-cache");
                    r.setResponseHeaders(h);
                    return r;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                // liens externes (crédits photo…) : navigateur du téléphone
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) { cb.invoke(origin, true, false); return; }
                geoCb = cb; geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(ORIGIN + "index.html");
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_LOC && geoCb != null) {
            geoCb.invoke(geoOrigin, hasLocation(), false);
            geoCb = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onPause() { web.onPause(); super.onPause(); }

    @Override
    protected void onDestroy() { pool.shutdownNow(); web.destroy(); super.onDestroy(); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.cdBack ? window.cdBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) MainActivity.super.onBackPressed();
            }
        });
    }

    private static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    /** Pont appelé depuis radar.js (window.CDNative). */
    private class Bridge {
        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String body, final String headers) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    int status = 0;
                    String text;
                    HttpURLConnection c = null;
                    try {
                        URL u = new URL(url);
                        if (!"https".equals(u.getProtocol()) || !API_HOSTS.contains(u.getHost()))
                            throw new SecurityException("Adresse non autorisée");
                        c = (HttpURLConnection) u.openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(12000);
                        c.setRequestMethod("POST".equals(method) ? "POST" : "GET");
                        c.setRequestProperty("Accept", "application/json");
                        c.setRequestProperty("User-Agent", "CielDirect/1.0 (Android)");
                        JSONObject h = new JSONObject(headers == null || headers.isEmpty() ? "{}" : headers);
                        for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                            String k = it.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                        if ("POST".equals(method)) {
                            c.setDoOutput(true);
                            OutputStream os = c.getOutputStream();
                            os.write((body == null ? "" : body).getBytes("UTF-8"));
                            os.close();
                        }
                        status = c.getResponseCode();
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        text = in == null ? "" : read(in);
                    } catch (Exception e) {
                        text = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    final String js = "window.__cdHttp(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")";
                    ui.post(new Runnable() {
                        @Override
                        public void run() { web.evaluateJavascript(js, null); }
                    });
                }
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(i, "Partager le vol"));
                }
            });
        }
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }
}
