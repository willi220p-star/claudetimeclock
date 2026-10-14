/**
 * DGK Clock email sender (Google Apps Script web app, V8).
 *
 * The Supabase Edge Function `send-email` POSTs a signed JSON envelope here;
 * this verifies it and sends one email with MailApp. Contract:
 * docs/superpowers/specs/2026-10-14-email-notifications-contract.md
 *
 * All logic is in handle(raw, deps) so it can be unit-tested with fake deps.
 * Responses never echo the secret, signature, recipient address or body.
 */

var MAX_SKEW_SECONDS = 300;
var MAX_PAYLOAD_CHARS = 20000;
var DEDUPE_SECONDS = 21600; // 6 hours, the CacheService maximum
var LOCK_WAIT_MS = 10000;
var DEFAULT_URL_PREFIX = 'https://willi220p-star.github.io/claudetimeclock/';
var DEFAULT_SENDER_NAME = 'DGK Clock';
var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var SIG_RE = /^[0-9a-f]{64}$/;
var EMAIL_RE = /^[^\s@,;<>"'()[\]\\]+@[^\s@,;<>"'()[\]\\]+\.[^\s@,;<>"'()[\]\\]+$/;
var CATEGORIES = ['user', 'admin'];

// In Apps Script, Templates.gs globals are shared; under Node (tests) we require it.
function templates_() {
  if (typeof module !== 'undefined' && typeof require === 'function') return require('./Templates.js');
  return { TEMPLATES: TEMPLATES, render: render };
}

function ok_(eventId, status) {
  return { ok: true, event_id: eventId, status: status };
}

function fail_(eventId, code, message, retryable) {
  return { ok: false, event_id: eventId || null, code: code, message: message, retryable: retryable };
}

// Compares two strings in time that depends only on their length.
function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function canonical_(ts, eventId, payload) {
  return 'v1.' + ts + '.' + eventId + '.' + payload;
}

/** Signature check only: true when sig matches HMAC-SHA-256 of the canonical string. */
function verify(env, secret, hmacHex) {
  return safeEqual_(String(hmacHex(canonical_(env.ts, env.event_id, env.payload), secret)).toLowerCase(), env.sig);
}

function parseEnvelope_(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD_CHARS + 1000) return null;
  var env;
  try {
    env = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!env || typeof env !== 'object') return null;
  if (env.v !== 1) return null;
  if (typeof env.ts !== 'number' || !isFinite(env.ts) || Math.floor(env.ts) !== env.ts) return null;
  if (typeof env.event_id !== 'string' || !UUID_RE.test(env.event_id)) return null;
  if (typeof env.payload !== 'string' || env.payload.length === 0 || env.payload.length > MAX_PAYLOAD_CHARS) return null;
  if (typeof env.sig !== 'string' || !SIG_RE.test(env.sig)) return null;
  return env;
}

function allowedRecipients_(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s !== ''; });
}

/**
 * Validates and sends one email.
 * deps: {now() -> ms, props: {KEY: value}, hmacHex(message, key) -> hex,
 *        mail: {remaining() -> int, send({to, subject, body, htmlBody, name})},
 *        cache: {get(k), put(k, v, seconds)}, lock: {tryLock(ms) -> bool, releaseLock()},
 *        log(obj)}
 * Returns the response object from the contract (always sent as HTTP 200 JSON).
 */
function handle(raw, deps) {
  var res = handle_(raw, deps);
  try {
    deps.log({
      event_id: res.event_id,
      template_id: res.template_id || null,
      category: res.category || null,
      status: res.ok ? res.status : 'error',
      code: res.ok ? null : res.code
    });
  } catch {
    // logging must never change the outcome
  }
  delete res.template_id;
  delete res.category;
  return res;
}

function handle_(raw, deps) {
  var env = parseEnvelope_(raw);
  if (!env) return fail_(null, 'bad_request', 'Malformed envelope.', false);
  var id = env.event_id;

  var props = deps.props || {};
  var secret = props.SHARED_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    return fail_(id, 'server_misconfigured', 'SHARED_SECRET is not set.', true);
  }

  var nowSec = Math.floor(deps.now() / 1000);
  if (Math.abs(nowSec - env.ts) > MAX_SKEW_SECONDS) return fail_(id, 'stale_request', 'Timestamp outside the allowed window.', false);

  if (!verify(env, secret, deps.hmacHex)) return fail_(id, 'bad_signature', 'Signature does not match.', false);

  var p;
  try {
    p = JSON.parse(env.payload);
  } catch {
    return fail_(id, 'bad_request', 'Payload is not JSON.', false);
  }
  if (!p || typeof p !== 'object') return fail_(id, 'bad_request', 'Payload is not an object.', false);
  if (p.event_id !== id) return fail_(id, 'bad_request', 'event_id mismatch.', false);

  var T = templates_();
  var tid = p.template_id;
  var template = typeof tid === 'string' && Object.prototype.hasOwnProperty.call(T.TEMPLATES, tid) ? T.TEMPLATES[tid] : null;
  if (!template) return fail_(id, 'unknown_template', 'Unknown template.', false);
  var category = p.recipient_category;
  var meta = { template_id: tid, category: CATEGORIES.indexOf(category) === -1 ? null : category };
  function withMeta(r) {
    r.template_id = meta.template_id;
    r.category = meta.category;
    return r;
  }
  if (CATEGORIES.indexOf(category) === -1 || template.categories.indexOf(category) === -1) {
    return withMeta(fail_(id, 'bad_request', 'Recipient category not allowed for this template.', false));
  }

  var to = p.to;
  if (typeof to !== 'string' || to.length > 254 || !EMAIL_RE.test(to)) {
    return withMeta(fail_(id, 'invalid_recipient', 'Recipient address is not valid.', false));
  }
  var allowed = allowedRecipients_(props.ALLOWED_RECIPIENTS);
  if (allowed.length > 0 && allowed.indexOf(to.toLowerCase()) === -1) {
    return withMeta(fail_(id, 'recipient_not_allowed', 'Recipient is not in ALLOWED_RECIPIENTS.', false));
  }

  var prefix = props.ALLOWED_URL_PREFIX || DEFAULT_URL_PREFIX;
  var data = p.data;
  var url = data && typeof data === 'object' ? data.action_url : null;
  if (typeof url !== 'string' || url.indexOf(prefix) !== 0 || /[\s"'<>]/.test(url)) {
    return withMeta(fail_(id, 'invalid_url', 'action_url is not allowed.', false));
  }

  var msg;
  try {
    msg = T.render(template, data);
  } catch {
    return withMeta(fail_(id, 'bad_request', 'Template data is missing or invalid.', false));
  }

  if (!deps.lock.tryLock(LOCK_WAIT_MS)) return withMeta(fail_(id, 'busy', 'Another send is in progress.', true));
  try {
    var key = 'sent:' + id;
    if (deps.cache.get(key)) return withMeta(ok_(id, 'duplicate'));
    if (deps.mail.remaining() < 1) return withMeta(fail_(id, 'quota_exceeded', 'Daily email quota used up.', true));
    try {
      deps.mail.send({
        to: to,
        subject: msg.subject,
        body: msg.text,
        htmlBody: msg.html,
        name: props.SENDER_NAME || DEFAULT_SENDER_NAME
      });
    } catch {
      return withMeta(fail_(id, 'send_failed', 'MailApp could not send.', true));
    }
    try {
      deps.cache.put(key, '1', DEDUPE_SECONDS);
    } catch {
      // ponytail: a cache write failure after a real send is ignored; the
      // email went out, and Supabase is the authoritative record.
    }
    return withMeta(ok_(id, 'sent'));
  } finally {
    deps.lock.releaseLock();
  }
}

/* ---------- Apps Script runtime (not used by the tests) ---------- */

function hmacHexReal_(message, key) {
  var bytes = Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var h = (b & 0xff).toString(16);
      return h.length === 1 ? '0' + h : h;
    })
    .join('');
}

function realDeps_() {
  return {
    now: function () { return Date.now(); },
    props: PropertiesService.getScriptProperties().getProperties(),
    hmacHex: hmacHexReal_,
    mail: {
      remaining: function () { return MailApp.getRemainingDailyQuota(); },
      send: function (m) { MailApp.sendEmail(m); }
    },
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    log: function (o) { console.log(JSON.stringify(o)); }
  };
}

function doPost(e) {
  var raw = e && e.postData ? e.postData.contents : '';
  var res;
  try {
    res = handle(raw, realDeps_());
  } catch {
    console.log(JSON.stringify({ status: 'error', code: 'server_error' }));
    res = fail_(null, 'server_error', 'Unexpected error.', true);
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to trigger the authorisation prompt. Sends nothing. */
function setup() {
  console.log('Remaining daily email quota: ' + MailApp.getRemainingDailyQuota());
}

/**
 * Run from the editor to send ONE test email to your own Google account
 * (Session.getEffectiveUser()). Does not need SHARED_SECRET.
 */
function selfTest() {
  var me = Session.getEffectiveUser().getEmail();
  var props = PropertiesService.getScriptProperties().getProperties();
  var msg = render(TEMPLATES.general_notice, {
    recipient_name: 'there',
    event_title: 'Test email',
    event_message: 'If you can read this, the DGK Clock email sender works.',
    action_url: props.ALLOWED_URL_PREFIX || DEFAULT_URL_PREFIX,
    event_timestamp: new Date().toString()
  });
  MailApp.sendEmail({ to: me, subject: msg.subject, body: msg.text, htmlBody: msg.html, name: props.SENDER_NAME || DEFAULT_SENDER_NAME });
  console.log('Test email sent. Remaining quota: ' + MailApp.getRemainingDailyQuota());
}

if (typeof module !== 'undefined') {
  module.exports = { handle: handle, verify: verify, safeEqual_: safeEqual_, canonical_: canonical_ };
}
