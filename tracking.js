/*
 * Visit tracking for jointheshamrockclub.com.
 *
 * 1. UTM capture. When someone arrives on any page with ?utm_source=... (or
 *    any utm_ tag) in the link, those tags are remembered in this browser for
 *    90 days. The application form sends them to Airtable with the
 *    application, so a sponsor who clicked an Instagram or Oxnard USA link,
 *    browsed, and applied days later is still credited to that link.
 *    First touch wins: a later untagged visit never overwrites it.
 *
 * 2. Google Analytics 4. Paste your Measurement ID (G-XXXXXXXXXX) below and
 *    every page that includes this script starts reporting. Leave it blank and
 *    nothing is loaded.
 */
(function () {
  var GA_MEASUREMENT_ID = 'G-DCNFYJ8C9Z';

  var KEY = 'shamrock_attribution';
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function read() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (saved && saved.at && Date.now() - saved.at < MAX_AGE_MS) return saved;
    } catch (e) { /* storage blocked or corrupt: behave as a fresh visit */ }
    return null;
  }

  function write(value) {
    try { window.localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function externalReferrer() {
    try {
      if (!document.referrer) return '';
      var ref = new URL(document.referrer);
      return ref.hostname === window.location.hostname ? '' : ref.hostname;
    } catch (e) { return ''; }
  }

  var params = new URLSearchParams(window.location.search);
  var fromLink = {};
  var hasUtm = false;
  UTM_KEYS.forEach(function (k) {
    var v = (params.get(k) || '').trim().slice(0, 200);
    if (v) { fromLink[k] = v; hasUtm = true; }
  });

  var saved = read();
  if (!saved) {
    var referrer = externalReferrer();
    if (hasUtm || referrer) {
      fromLink.referrer = referrer;
      fromLink.landing_page = window.location.pathname;
      fromLink.at = Date.now();
      write(fromLink);
      saved = fromLink;
    }
  }

  window.ShamrockTracking = {
    /** The remembered first-touch attribution, or an empty object. */
    get: function () { return read() || {}; },
    /** Send a GA4 event if Analytics is on; a no-op otherwise. */
    event: function (name, data) {
      if (typeof window.gtag === 'function') window.gtag('event', name, data || {});
    }
  };

  if (GA_MEASUREMENT_ID) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);
  }
})();
