package com.meald.app;

import android.net.Uri;
import android.webkit.CookieManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "ScopedCookies")
public class ScopedCookiesPlugin extends Plugin {

    private static final String EXPIRES = "Thu, 01 Jan 1970 00:00:00 GMT";

    @PluginMethod
    public void clearForUrls(PluginCall call) {
        JSArray urlsArray = call.getArray("urls");
        if (urlsArray == null) {
            call.reject("urls required");
            return;
        }

        List<String> urls = new ArrayList<>();
        try {
            for (int i = 0; i < urlsArray.length(); i++) {
                urls.add(urlsArray.getString(i));
            }
        } catch (Exception e) {
            call.reject("Invalid urls", e);
            return;
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        for (String url : urls) {
            expireCookiesForUrl(cookieManager, url);
        }

        cookieManager.flush();

        Set<String> remaining = new LinkedHashSet<>();
        for (String url : urls) {
            collectCookieNames(cookieManager.getCookie(url), remaining);
        }

        JSArray remainingArray = new JSArray();
        for (String name : remaining) {
            remainingArray.put(name);
        }

        JSObject ret = new JSObject();
        ret.put("remainingCookieNames", remainingArray);
        call.resolve(ret);
    }

    private void expireCookiesForUrl(CookieManager cookieManager, String url) {
        String cookieString = cookieManager.getCookie(url);
        if (cookieString == null || cookieString.isEmpty()) {
            return;
        }

        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            return;
        }

        List<String> domainVariants = domainVariantsFor(host);
        String[] cookies = cookieString.split("; ");
        for (String cookie : cookies) {
            String[] parts = cookie.split("=", 2);
            if (parts.length == 0) {
                continue;
            }
            String name = parts[0].trim();
            if (name.isEmpty()) {
                continue;
            }
            for (String domain : domainVariants) {
                expireCookie(cookieManager, url, name, domain, true);
                expireCookie(cookieManager, url, name, domain, false);
            }
            expireCookieHostOnly(cookieManager, url, name, true);
            expireCookieHostOnly(cookieManager, url, name, false);
        }
    }

    private void expireCookie(
            CookieManager cookieManager,
            String url,
            String name,
            String domain,
            boolean secure
    ) {
        StringBuilder sb = new StringBuilder();
        sb.append(name).append("=; Max-Age=0; Expires=").append(EXPIRES);
        sb.append("; Path=/; Domain=").append(domain);
        if (secure) {
            sb.append("; Secure");
        }
        cookieManager.setCookie(url, sb.toString());
    }

    private void expireCookieHostOnly(CookieManager cookieManager, String url, String name, boolean secure) {
        StringBuilder sb = new StringBuilder();
        sb.append(name).append("=; Max-Age=0; Expires=").append(EXPIRES);
        sb.append("; Path=/");
        if (secure) {
            sb.append("; Secure");
        }
        cookieManager.setCookie(url, sb.toString());
    }

    private void collectCookieNames(String cookieString, Set<String> out) {
        if (cookieString == null || cookieString.isEmpty()) {
            return;
        }
        for (String cookie : cookieString.split("; ")) {
            String[] parts = cookie.split("=", 2);
            if (parts.length > 0) {
                String name = parts[0].trim();
                if (!name.isEmpty()) {
                    out.add(name);
                }
            }
        }
    }

    private List<String> domainVariantsFor(String host) {
        Set<String> variants = new LinkedHashSet<>();
        variants.add(host);
        if (!host.startsWith(".")) {
            variants.add("." + host);
        }
        if (host.equals("costco.com") || host.endsWith(".costco.com")) {
            variants.add("costco.com");
            variants.add(".costco.com");
        }
        return new ArrayList<>(variants);
    }
}
