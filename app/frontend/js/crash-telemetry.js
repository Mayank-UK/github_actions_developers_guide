/* Grafana Faro browser-crash telemetry — runtime beacon loader, the same
 * discipline as the Umami carrier: NO build tooling for this static site,
 * so the collector endpoint and app name ride a config <script> line in
 * each page's <head> whose __FARO_URL__/__FARO_APP__ placeholder tokens
 * are swapped at image build time (see .docker/frontend/Dockerfile).
 * Builds without the FARO_* build args DELETE that line — this file then
 * reads no window.FARO_CONFIG and no-ops completely (byte-clean pages).
 * It therefore ships in every build unconditionally, exactly like
 * analytics.js.
 *
 * The SDK itself is the official CDN IIFE bundle (jsdelivr, pinned to
 * major @1) injected as a plain <script defer> once per document; the
 * bundle installs window.GrafanaFaroWebSdk (NOT window.Faro — that shape
 * is Grafana's outdated docs). initializeFaro's defaults already capture
 * uncaught errors; we pass only url + app, keeping the payload minimal.
 * Values are PUBLIC (the browser ships them to the collector anyway), so
 * they are repository Variables, never secrets.
 */
(function () {
  "use strict";
  var cfg = window.FARO_CONFIG;
  if (!cfg || typeof cfg.url !== "string" || cfg.url === "" ||
      typeof cfg.app !== "string" || cfg.app === "") {
    return; /* unconfigured (or beacon-free) build: complete no-op */
  }
  if (document.getElementById("faro-crash-telemetry")) {
    return; /* idempotent per document */
  }
  var s = document.createElement("script");
  s.id = "faro-crash-telemetry";
  s.defer = true;
  s.src = "https://cdn.jsdelivr.net/npm/@grafana/faro-web-sdk@1/dist/bundle/faro-web-sdk.iife.js";
  /* The global exists only once the bundle evaluated; initialize once
   * with the minimal payload (a blocked/failed load simply never fires). */
  s.addEventListener("load", function () {
    if (window.__faroInitialized) return;
    window.__faroInitialized = true;
    if (window.GrafanaFaroWebSdk &&
        typeof window.GrafanaFaroWebSdk.initializeFaro === "function") {
      window.GrafanaFaroWebSdk.initializeFaro({
        url: cfg.url,
        app: { name: cfg.app, environment: "production" }
      });
    }
  }, { once: true });
  document.head.appendChild(s);
})();
