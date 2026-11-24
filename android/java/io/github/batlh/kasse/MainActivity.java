package io.github.batlh.kasse;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Hülle um die Kassen-Oberfläche: Speichern, Dateien, Theme und Zurück-Taste. */
public class MainActivity extends Activity {
    private static final int REQ_OPEN = 1;
    private static final int REQ_SAVE = 2;
    private static final int LIGHT_BAR = 0xFFFFFFFF;
    private static final int DARK_BAR = 0xFF17252E;

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;
    private byte[] pendingSave;
    final Object lock = new Object();

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyBars() {
        boolean dark = isDark();
        int c = dark ? DARK_BAR : LIGHT_BAR;
        Window w = getWindow();
        w.setStatusBarColor(c);
        w.setNavigationBarColor(c);
        w.getDecorView().setBackgroundColor(c);
        int flags = w.getDecorView().getSystemUiVisibility();
        if (dark) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (android.os.Build.VERSION.SDK_INT >= 26) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (android.os.Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        w.getDecorView().setSystemUiVisibility(flags);
    }

    /** Handys bleiben im Hochformat, Tablets dürfen sich weiter drehen. */
    private void applyOrientation() {
        boolean phone = getResources().getConfiguration().smallestScreenWidthDp < 600;
        setRequestedOrientation(phone ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    /** Hält die Oberfläche von Notch, Kamera-Loch und Systemleisten frei. */
    private void applySafeArea(FrameLayout root) {
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
            getWindow().setAttributes(lp);
        }
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int l = in.getSystemWindowInsetLeft();
                int t = in.getSystemWindowInsetTop();
                int r = in.getSystemWindowInsetRight();
                int b = in.getSystemWindowInsetBottom();
                if (android.os.Build.VERSION.SDK_INT >= 28) {
                    DisplayCutout c = in.getDisplayCutout();
                    if (c != null) {
                        l = Math.max(l, c.getSafeInsetLeft());
                        t = Math.max(t, c.getSafeInsetTop());
                        r = Math.max(r, c.getSafeInsetRight());
                        b = Math.max(b, c.getSafeInsetBottom());
                    }
                }
                v.setPadding(l, t, r, b);
                return in;
            }
        });
    }

    private void pushTheme() {
        if (web != null) web.evaluateJavascript(
                "document.documentElement.dataset.theme='" + (isDark() ? "dark" : "light") + "'", null);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyBars();
        applyOrientation();

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.addJavascriptInterface(new Bridge(), "KasseAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return true; // Die App lädt nie fremde Seiten.
            }

            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap b) {
                pushTheme();
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pushTheme();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_OPEN);
                } catch (Exception e) {
                    pendingPick = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applySafeArea(root);
        setContentView(root);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        applyOrientation();
        applyBars();
        pushTheme();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.kasseBack?window.kasseBack():false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_OPEN) {
            if (pendingPick != null) {
                Uri[] r = (res == RESULT_OK && data != null && data.getData() != null)
                        ? new Uri[]{data.getData()} : null;
                pendingPick.onReceiveValue(r);
                pendingPick = null;
            }
        } else if (req == REQ_SAVE) {
            boolean ok = false;
            if (res == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (OutputStream o = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    o.write(pendingSave);
                    ok = true;
                } catch (Exception e) {
                    Toast.makeText(this, "Datei konnte nicht gespeichert werden.", Toast.LENGTH_LONG).show();
                }
            }
            pendingSave = null;
            web.evaluateJavascript("window.kasseFileSaved(" + ok + ")", null);
        }
    }

    File stateFile() {
        return new File(getFilesDir(), "kasse.json");
    }

    static byte[] readAll(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        }
    }

    private void requestSave(final String name, final String mime, final String content) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                pendingSave = content.getBytes(StandardCharsets.UTF_8);
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(i, REQ_SAVE);
            }
        });
    }

    /** Wird aus JavaScript aufgerufen. */
    public final class Bridge {
        Bridge() {
        }

        @JavascriptInterface
        public String theme() {
            return isDark() ? "dark" : "light";
        }

        @JavascriptInterface
        public String load() {
            synchronized (lock) {
                File[] order = {stateFile(), new File(getFilesDir(), "kasse.bak.json")};
                for (File f : order) {
                    try {
                        if (f.exists() && f.length() > 0) return new String(readAll(f), StandardCharsets.UTF_8);
                    } catch (Exception ignored) {
                    }
                }
                return "";
            }
        }

        @JavascriptInterface
        public boolean save(String json) {
            synchronized (lock) {
                File main = stateFile();
                File tmp = new File(getFilesDir(), "kasse.tmp");
                File bak = new File(getFilesDir(), "kasse.bak.json");
                try (FileOutputStream o = new FileOutputStream(tmp)) {
                    o.write(json.getBytes(StandardCharsets.UTF_8));
                    o.getFD().sync();
                } catch (Exception e) {
                    return false;
                }
                if (main.exists()) {
                    bak.delete();
                    main.renameTo(bak);
                }
                return tmp.renameTo(main);
            }
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String content) {
            requestSave(name, mime, content);
        }
    }
}
