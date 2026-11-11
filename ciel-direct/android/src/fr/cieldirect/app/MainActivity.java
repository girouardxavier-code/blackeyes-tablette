package fr.cieldirect.app;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.ParcelUuid;
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
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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
    private static final int REQ_LOC = 1, REQ_DRONE = 2;
    /* Remote ID (ASTM F3411 / OpenDroneID) en Bluetooth : données de service UUID 0xFFFA */
    private static final ParcelUuid ODID_UUID = ParcelUuid.fromString("0000fffa-0000-1000-8000-00805f9b34fb");

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean droneOn = false;
    private ScanCallback bleCb;
    private BroadcastReceiver wifiRx;
    private final Runnable wifiTick = new Runnable() {
        @Override
        public void run() {
            if (!droneOn) return;
            try { ((WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE)).startScan(); } catch (Exception ignored) { }
            ui.postDelayed(this, 30000);   // Android limite à 4 balayages Wi-Fi par tranche de 2 minutes
        }
    };
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
        if (code == REQ_DRONE) {
            if (dronePerms().length == 0) startDrones();
            else droneState("Autorisation refusée : la détection des drones a besoin du Bluetooth et de la position.");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); if (droneOn) startScans(); }

    @Override
    protected void onPause() { stopScans(); web.onPause(); super.onPause(); }

    @Override
    protected void onDestroy() { droneOn = false; stopScans(); pool.shutdownNow(); web.destroy(); super.onDestroy(); }

    /* ------------------------------------------------------------ détection des drones */
    private String[] dronePerms() {
        List<String> need = new ArrayList<String>();
        List<String> want = new ArrayList<String>();
        want.add(Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= 31) want.add("android.permission.BLUETOOTH_SCAN");
        for (String p : want) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) need.add(p);
        return need.toArray(new String[0]);
    }

    private void startDrones() {
        String[] need = dronePerms();
        if (need.length > 0) { requestPermissions(need, REQ_DRONE); return; }
        droneOn = true;
        startScans();
    }

    private void stopDrones() { droneOn = false; stopScans(); }

    private void droneState(String msg) {
        final String js = "window.__cdDroneState && window.__cdDroneState(" + JSONObject.quote(msg) + ")";
        ui.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    private void emit(String src, String kind, String mac, int rssi, byte[] data) {
        try {
            JSONObject o = new JSONObject();
            o.put("src", src); o.put("kind", kind); o.put("mac", mac); o.put("rssi", rssi); o.put("hex", hex(data));
            final String js = "window.__cdDrone && window.__cdDrone(" + JSONObject.quote(o.toString()) + ")";
            ui.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
        } catch (Exception ignored) { }
    }

    private void startScans() {
        if (!droneOn) return;
        String bt = startBle(), wifi = startWifi();
        if (bt != null && wifi != null) droneState(bt + " " + wifi);
        else if (bt != null) droneState(bt + " Écoute du Wi-Fi seulement.");
        else if (wifi != null) droneState("Écoute du Bluetooth. " + wifi);
        else droneState("Détection des drones active (Bluetooth et Wi-Fi).");
    }

    private void stopScans() {
        try {
            BluetoothManager bm = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
            if (bleCb != null && ad != null && ad.getBluetoothLeScanner() != null) ad.getBluetoothLeScanner().stopScan(bleCb);
        } catch (Exception ignored) { }
        bleCb = null;
        if (wifiRx != null) { try { unregisterReceiver(wifiRx); } catch (Exception ignored) { } wifiRx = null; }
        ui.removeCallbacks(wifiTick);
    }

    private String startBle() {
        if (bleCb != null) return null;
        try {
            BluetoothManager bm = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
            if (ad == null) return "Pas de Bluetooth sur cet appareil.";
            if (!ad.isEnabled()) return "Bluetooth désactivé : activez-le pour capter plus de drones.";
            BluetoothLeScanner sc = ad.getBluetoothLeScanner();
            if (sc == null) return "Bluetooth indisponible.";
            ScanSettings.Builder sb = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY);
            if (Build.VERSION.SDK_INT >= 26) {   // Bluetooth 5 (longue portée) : réglages absents d'Android 6, appelés par réflexion
                try {
                    sb.getClass().getMethod("setLegacy", boolean.class).invoke(sb, false);
                    sb.getClass().getMethod("setPhy", int.class).invoke(sb, 255);
                } catch (Exception ignored) { }
            }
            // sans filtre matériel (certains téléphones ignorent les filtres sur données de service) : tri dans handleBle
            List<ScanFilter> filters = null;
            bleCb = new ScanCallback() {
                @Override
                public void onScanResult(int type, ScanResult r) { handleBle(r); }

                @Override
                public void onBatchScanResults(List<ScanResult> rs) { for (ScanResult r : rs) handleBle(r); }

                @Override
                public void onScanFailed(int err) { bleCb = null; droneState("Balayage Bluetooth impossible (erreur " + err + ")."); }
            };
            sc.startScan(filters, sb.build(), bleCb);
            return null;
        } catch (SecurityException e) {
            return "Bluetooth refusé.";
        } catch (Exception e) {
            return "Bluetooth indisponible.";
        }
    }

    private void handleBle(ScanResult r) {
        ScanRecord rec = r.getScanRecord();
        if (rec == null) return;
        byte[] d = rec.getServiceData(ODID_UUID);
        // [0x0D (code application), compteur, message de 25 octets ou paquet de messages]
        if (d == null || d.length < 27 || d[0] != 0x0D) return;
        emit("ble", "odid", r.getDevice().getAddress(), r.getRssi(), Arrays.copyOfRange(d, 2, d.length));
    }

    private String startWifi() {
        if (Build.VERSION.SDK_INT < 30) return "Wi-Fi : nécessite Android 11.";
        if (wifiRx == null) {
            wifiRx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) { readWifi(); }
            };
            registerReceiver(wifiRx, new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION));
        }
        ui.removeCallbacks(wifiTick);
        ui.post(wifiTick);
        return null;
    }

    /* Balises Wi-Fi : élément « propre au fabricant » (221) de l'ASTM (FA:0B:BC, type 0x0D)
       ou du signalement électronique français (6A:5C:35, type 0x01). Lecture par réflexion (Android 11+). */
    @SuppressWarnings("unchecked")
    private void readWifi() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            List<android.net.wifi.ScanResult> rs = wm.getScanResults();
            Method getIes = android.net.wifi.ScanResult.class.getMethod("getInformationElements");
            for (android.net.wifi.ScanResult r : rs) {
                List<Object> ies = (List<Object>) getIes.invoke(r);
                if (ies == null) continue;
                for (Object ie : ies) {
                    int id = (Integer) ie.getClass().getMethod("getId").invoke(ie);
                    if (id != 221) continue;
                    ByteBuffer bb = ((ByteBuffer) ie.getClass().getMethod("getBytes").invoke(ie)).duplicate();
                    byte[] b = new byte[bb.remaining()];
                    bb.get(b);
                    if (b.length < 5) continue;
                    int o0 = b[0] & 0xff, o1 = b[1] & 0xff, o2 = b[2] & 0xff, t = b[3] & 0xff;
                    if (o0 == 0xFA && o1 == 0x0B && o2 == 0xBC && t == 0x0D && b.length >= 30)
                        emit("wifi", "odid", r.BSSID, r.level, Arrays.copyOfRange(b, 5, b.length));   // 5 = OUI + type + compteur
                    else if (o0 == 0x6A && o1 == 0x5C && o2 == 0x35 && t == 0x01)
                        emit("wifi", "fr", r.BSSID, r.level, Arrays.copyOfRange(b, 4, b.length));
                }
            }
        } catch (Exception ignored) { }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

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
        public void droneStart() { ui.post(new Runnable() { @Override public void run() { startDrones(); } }); }

        @JavascriptInterface
        public void droneStop() { ui.post(new Runnable() { @Override public void run() { stopDrones(); } }); }

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
