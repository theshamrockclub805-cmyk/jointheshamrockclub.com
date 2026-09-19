'use strict';

/**
 * Sending email, and the one template every Shamrock email uses.
 *
 * Nothing here ever throws at the caller. An email failing must not fail the
 * thing that triggered it: a sponsor who submits the application form has
 * still applied even if the confirmation bounces, and a payment is still a
 * payment even if the welcome note never lands. Callers get {sent:false} and
 * a logged reason instead of an exception.
 *
 * Required environment variables (Netlify > Site configuration):
 *   RESEND_API_KEY   from resend.com > API Keys
 *   MAIL_FROM        e.g. The Shamrock Club <hello@jointheshamrockclub.com>
 *                    The domain must be verified in Resend or nothing sends.
 * Optional:
 *   MAIL_REPLY_TO    where replies should go, if not the From address
 *   MAIL_BCC         a team address that gets a silent copy of everything
 *   SITE_URL         defaults to https://jointheshamrockclub.com
 */

function env(name) {
  var value = process.env[name];
  if (value === undefined) {
    var match = Object.keys(process.env).find(function (key) {
      return key.toLowerCase() === name.toLowerCase();
    });
    if (match) value = process.env[match];
  }
  return typeof value === 'string' ? value.trim() : value;
}

var SITE_URL = (env('SITE_URL') || 'https://jointheshamrockclub.com').replace(/\/+$/, '');

var BLUE = '#17115a';
var RED = '#e10600';
var GOLD = '#d5b24a';
var INK = '#17142b';
var MUTED = '#676879';
var LINE = '#e4e5ee';
var BG = '#f7f8fc';

/**
 * Escape anything interpolated into the HTML. Business names, school names and
 * applicant notes all originate from a public form, so none of them may be
 * treated as markup.
 */
function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links survive, so a bad value can never become a javascript: URL. */
function safeUrl(value) {
  var url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * Build one email. Inline styles and tables throughout, because email clients
 * strip <style> blocks and ignore most modern layout.
 *
 * blocks: array of { label, value } rendered as a detail list, or
 *         { text } for a paragraph, or { bullets: [...] } for a list.
 */
function render(options) {
  var heading = esc(options.heading || '');
  var preheader = esc(options.preheader || '');
  var ctaUrl = safeUrl(options.ctaUrl);
  var blocks = Array.isArray(options.blocks) ? options.blocks : [];

  var bodyParts = [];

  (options.intro ? [].concat(options.intro) : []).forEach(function (para) {
    bodyParts.push(
      '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:' + INK + ';">' +
      esc(para) + '</p>'
    );
  });

  blocks.forEach(function (block) {
    if (block.text) {
      bodyParts.push(
        '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:' + INK + ';">' +
        esc(block.text) + '</p>'
      );
      return;
    }
    if (Array.isArray(block.bullets)) {
      var items = block.bullets.map(function (b) {
        return '<li style="margin:0 0 8px;font-size:16px;line-height:1.6;color:' + INK + ';">' +
          esc(b) + '</li>';
      }).join('');
      bodyParts.push('<ul style="margin:0 0 18px;padding-left:22px;">' + items + '</ul>');
      return;
    }
    if (block.label) {
      bodyParts.push(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="margin:0 0 10px;"><tr>' +
        '<td style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:' + MUTED +
        ';padding:0 0 2px;">' + esc(block.label) + '</td></tr><tr>' +
        '<td style="font-size:16px;color:' + INK + ';font-weight:600;padding:0 0 10px;">' +
        esc(block.value) + '</td></tr></table>'
      );
    }
  });

  var cta = ctaUrl
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;">' +
      '<tr><td align="center" bgcolor="' + RED + '" style="border-radius:999px;">' +
      '<a href="' + ctaUrl + '" style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:15px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;' +
      'text-decoration:none;border-radius:999px;">' + esc(options.ctaLabel || 'Open') + '</a>' +
      '</td></tr></table>'
    : '';

  var footerNote = options.footerNote
    ? '<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:' + MUTED + ';">' +
      esc(options.footerNote) + '</p>'
    : '';

  var html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + heading + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + BG + ';">' +
    // Hidden preview line, shown by inboxes next to the subject.
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + preheader + '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
    'style="background:' + BG + ';padding:28px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ' +
    'style="max-width:600px;width:100%;background:#ffffff;border:1px solid ' + LINE + ';' +
    'border-radius:16px;font-family:Arial,Helvetica,sans-serif;">' +

    '<tr><td style="padding:26px 34px 0;">' +
    '<p style="margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:' + GOLD + ';">' +
    'The Shamrock Club</p></td></tr>' +

    '<tr><td style="padding:10px 34px 0;">' +
    '<h1 style="margin:0 0 18px;font-size:25px;line-height:1.2;color:' + BLUE + ';">' +
    heading + '</h1></td></tr>' +

    '<tr><td style="padding:0 34px 26px;">' + bodyParts.join('') + cta + footerNote + '</td></tr>' +

    '<tr><td style="padding:18px 34px 26px;border-top:1px solid ' + LINE + ';">' +
    '<p style="margin:0;font-size:12px;line-height:1.6;color:' + MUTED + ';">' +
    'The Shamrock Club &mdash; local businesses backing local high school programs.<br>' +
    '<a href="' + SITE_URL + '" style="color:' + BLUE + ';">jointheshamrockclub.com</a>' +
    '</p></td></tr>' +

    '</table></td></tr></table></body></html>';

  return { html: html, text: toText(options) };
}

/** A readable plain-text alternative. Some clients and most filters want one. */
function toText(options) {
  var lines = [];
  lines.push(String(options.heading || '').toUpperCase());
  lines.push('');

  (options.intro ? [].concat(options.intro) : []).forEach(function (para) {
    lines.push(String(para), '');
  });

  (Array.isArray(options.blocks) ? options.blocks : []).forEach(function (block) {
    if (block.text) { lines.push(String(block.text), ''); return; }
    if (Array.isArray(block.bullets)) {
      block.bullets.forEach(function (b) { lines.push('  - ' + b); });
      lines.push('');
      return;
    }
    if (block.label) lines.push(block.label + ': ' + block.value);
  });

  var url = safeUrl(options.ctaUrl);
  if (url) {
    lines.push('');
    lines.push((options.ctaLabel || 'Open') + ': ' + url);
  }
  if (options.footerNote) lines.push('', String(options.footerNote));

  lines.push('', '--', 'The Shamrock Club', SITE_URL);
  return lines.join('\n');
}

/**
 * Send one email. Returns {sent:true, id} or {sent:false, reason} — never throws.
 */
async function send(message) {
  var apiKey = env('RESEND_API_KEY');
  var from = env('MAIL_FROM');

  if (!apiKey || !from) {
    console.warn('Email not sent ("' + (message.subject || '') + '"): ' +
      'RESEND_API_KEY set = ' + Boolean(apiKey) + ', MAIL_FROM set = ' + Boolean(from) + '.');
    return { sent: false, reason: 'not configured' };
  }

  var to = [].concat(message.to || []).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: 'no recipient' };

  var rendered = render(message);
  var payload = {
    from: from,
    to: to,
    subject: message.subject || '',
    html: rendered.html,
    text: rendered.text
  };

  var replyTo = env('MAIL_REPLY_TO');
  if (replyTo) payload.reply_to = replyTo;
  var bcc = env('MAIL_BCC');
  if (bcc) payload.bcc = [bcc];

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    var body = await res.json().catch(function () { return {}; });

    if (!res.ok) {
      console.error('Email provider rejected "' + payload.subject + '": ' +
        res.status + ' ' + JSON.stringify(body).slice(0, 300));
      return { sent: false, reason: 'provider ' + res.status };
    }
    return { sent: true, id: body.id };
  } catch (err) {
    console.error('Email send failed for "' + payload.subject + '": ' + err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = {
  send: send,
  render: render,
  esc: esc,
  safeUrl: safeUrl,
  env: env,
  SITE_URL: SITE_URL
};
