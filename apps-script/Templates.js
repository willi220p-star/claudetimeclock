/**
 * DGK Clock email templates (Google Apps Script, V8).
 * Plain JS, no dependencies. In Apps Script every .gs file shares one global
 * scope, so helpers end in "_" (private, not runnable from the editor).
 */

var TEMPLATE_REQUIRED = ['recipient_name', 'event_title', 'event_message', 'action_url', 'event_timestamp'];
var MESSAGE_MAX = 1000;
var FIELD_MAX = 200; // recipient_name, event_title, event_timestamp
var URL_MAX = 2000;

var FOOTER_TEXT = 'You get this because email notifications are on. Turn them off on Me in DGK Clock.';

function templateText_(intro) {
  return [
    'Hi {{recipient_name}},',
    '',
    intro,
    '',
    '{{event_title}}',
    '{{event_message}}',
    '',
    'When: {{event_timestamp}}',
    '',
    'Open DGK Clock: {{action_url}}',
    '',
    '--',
    FOOTER_TEXT
  ].join('\n');
}

function templateHtml_(intro) {
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2430;max-width:560px">' +
    '<p style="margin:0 0 12px">Hi {{recipient_name}},</p>' +
    '<p style="margin:0 0 12px">' + intro + '</p>' +
    '<p style="margin:0 0 4px;font-weight:bold">{{event_title}}</p>' +
    '<p style="margin:0 0 12px;white-space:pre-line">{{event_message}}</p>' +
    '<p style="margin:0 0 20px;color:#5b6170;font-size:13px">{{event_timestamp}}</p>' +
    '<p style="margin:0 0 24px"><a href="{{action_url}}" style="display:inline-block;background:#3859f9;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Open DGK Clock</a></p>' +
    '<p style="margin:0;color:#5b6170;font-size:12px;border-top:1px solid #e3e5ea;padding-top:12px">' + FOOTER_TEXT + '</p>' +
    '</div>'
  );
}

function defineTemplate_(id, categories, intro) {
  return {
    id: id,
    version: 1,
    categories: categories,
    subject: 'DGK Clock: {{event_title}}',
    text: templateText_(intro),
    html: templateHtml_(intro),
    required: TEMPLATE_REQUIRED.slice()
  };
}

var TEMPLATES = {
  request_update: defineTemplate_('request_update', ['user'], 'There is an update on one of your requests.'),
  approval_needed: defineTemplate_('approval_needed', ['admin'], 'Something is waiting for your approval.'),
  announcement: defineTemplate_('announcement', ['user', 'admin'], 'There is a new announcement.'),
  roster_change: defineTemplate_('roster_change', ['user', 'admin'], 'There is a roster change.'),
  task_update: defineTemplate_('task_update', ['user', 'admin'], 'There is an update on a task.'),
  general_notice: defineTemplate_('general_notice', ['user', 'admin'], 'You have a new notification.')
};

function templateError_(message) {
  var err = new Error(message);
  err.code = 'bad_request';
  return err;
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Checks and normalises template data. Throws (err.code 'bad_request') when a
 * required field is missing, not a string, or too long. The message is
 * truncated to MESSAGE_MAX rather than rejected.
 */
function cleanTemplateData_(template, data) {
  if (!data || typeof data !== 'object') throw templateError_('data missing');
  var out = {};
  for (var i = 0; i < template.required.length; i++) {
    var key = template.required[i];
    var v = data[key];
    if (typeof v !== 'string' || v.trim() === '') throw templateError_('missing field ' + key);
    if (key === 'event_message') {
      if (v.length > MESSAGE_MAX) v = v.slice(0, MESSAGE_MAX - 1) + '…';
    } else if (key === 'action_url') {
      if (v.length > URL_MAX) throw templateError_('field too long ' + key);
    } else if (v.length > FIELD_MAX) {
      throw templateError_('field too long ' + key);
    }
    out[key] = v;
  }
  return out;
}

// Replaces {{key}} only for known keys; anything else is left as written.
function fill_(str, data, escape) {
  return str.replace(/\{\{([a-z_]+)\}\}/g, function (match, key) {
    if (TEMPLATE_REQUIRED.indexOf(key) === -1 || !Object.prototype.hasOwnProperty.call(data, key)) return match;
    return escape ? escapeHtml_(data[key]) : data[key];
  });
}

/**
 * Renders a template to {subject, text, html}. Every value is HTML-escaped in
 * html (no raw HTML from data), and the subject never contains CR/LF.
 */
function render(template, data) {
  var clean = cleanTemplateData_(template, data);
  var oneLine = {};
  for (var k in clean) oneLine[k] = clean[k].replace(/[\r\n]+/g, ' ');
  return {
    subject: fill_(template.subject, oneLine, false).replace(/[\r\n]+/g, ' ').trim(),
    text: fill_(template.text, clean, false),
    html: fill_(template.html, clean, true)
  };
}

if (typeof module !== 'undefined') {
  module.exports = { TEMPLATES: TEMPLATES, render: render, escapeHtml_: escapeHtml_, MESSAGE_MAX: MESSAGE_MAX };
}
