/* メールの形を作る。Email Routing の send_email に渡す EmailMessage の中身（MIME）。
   index.js（相談）と monitor.js（先行モニター）で使う。 */

/* 日本語の件名は、そのままだと文字化けする。RFC 2047 の形にする */
export function encodeSubject(s) {
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return '=?UTF-8?B?' + b + '?=';
}

export function mime({ from, to, subject, body, replyTo, fromName = 'yhasegawa.com フォーム' }) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
  const wrapped = b64.match(/.{1,76}/g).join('\r\n');
  const id = '<' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) +
             '@yhasegawa.com>';
  const head = [
    'From: ' + encodeSubject(fromName) + ' <' + from + '>',
    'To: <' + to + '>',
    replyTo ? 'Reply-To: <' + replyTo + '>' : null,
    'Subject: ' + encodeSubject(subject),
    'Message-ID: ' + id,
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return head.join('\r\n') + '\r\n\r\n' + wrapped + '\r\n';
}

/* ------------------------------------------------------------------ */
