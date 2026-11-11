/**
 * Deterministic secret scan over every string in an IR document. Labels and notes are
 * user- and code-derived, so a credential can land in a diagram by accident. Every finding
 * is a warning with a `kind`; the pipeline decides what each kind stops:
 *
 *   uri-credential, token-pattern   a credential by its form: no target writes it
 *   assignment, high-entropy,       a guess ("token: required", a hash, an id, an address):
 *   personal-data                   written to a local file with the warning, refused for
 *                                   FigJam, whose labels leave the machine
 *
 * Labels are written in the user's language, so the words that introduce a secret are known
 * in English, Vietnamese (with and without diacritics) and Japanese. The matched value is
 * never echoed in full.
 */

/** The kinds that are a credential by their form; the others are guesses. */
export const DEFINITE_KINDS = new Set(['uri-credential', 'token-pattern']);

/**
 * Words that name a secret, followed by `=` or `:` and a value. A Latin word needs a word
 * boundary; Japanese is written without spaces, so its words match anywhere.
 */
const SECRET_WORDS_LATIN = [
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'token', 'api[_-]?key', 'access[_-]?key', 'secret[_-]?key', 'private[_-]?key', 'client[_-]?secret',
  'mật khẩu', 'mat khau', 'mật mã', 'mat ma', 'mã bí mật', 'ma bi mat', 'khóa bí mật', 'khoá bí mật', 'khoa bi mat', 'khóa api', 'khoá api', 'khoa api', 'mã truy cập', 'ma truy cap',
];
const SECRET_WORDS_CJK = ['パスワード', 'パスフレーズ', '暗証番号', '秘密鍵', '秘密キー', 'シークレット', 'トークン', 'APIキー', 'アクセスキー', '認証キー', '合言葉'];
const SECRET_ASSIGNMENT = new RegExp(`(?:(?<![\\p{L}\\p{N}_])(?:${SECRET_WORDS_LATIN.join('|')})|(?:${SECRET_WORDS_CJK.join('|')}))\\s*[=:＝：]\\s*['"「『]?[^\\s'"」』]{6,}`, 'iu');

const PATTERNS = [
  { kind: 'uri-credential', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, what: 'URI with embedded credentials (scheme://user:password@host)' },
  { kind: 'token-pattern', re: /\bAKIA[0-9A-Z]{16}\b/, what: 'AWS access key id' },
  { kind: 'token-pattern', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/, what: 'GitHub token' },
  { kind: 'token-pattern', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/, what: 'GitHub fine-grained token' },
  { kind: 'token-pattern', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/, what: 'API secret key (sk- prefix)' },
  { kind: 'token-pattern', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, what: 'Slack token' },
  { kind: 'token-pattern', re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'Google API key' },
  { kind: 'token-pattern', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/, what: 'GitLab token' },
  { kind: 'token-pattern', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'private key block' },
  { kind: 'token-pattern', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, what: 'JSON Web Token' },
  { kind: 'token-pattern', re: SECRET_ASSIGNMENT, what: 'key=value assignment of a password, token or secret' },
];

/**
 * Personal data that a label has no reason to carry: a mail address, and a telephone number
 * written the way one is dialled (international prefix, or groups of digits joined by spaces,
 * dots or hyphens with a leading 0 or an area code in brackets). A date, a port, an amount
 * and an id have no such form.
 */
const PERSONAL = [
  { re: /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/, what: 'e-mail address' },
  { re: /(?<![\w+])\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]?\d{2,4}){1,3}(?!\d)/, what: 'telephone number' },
  { re: /(?<![\w.-])(?:\(0\d{1,3}\)|0\d{1,3})[ .-]\d{3,4}[ .-]\d{3,4}(?![\d.-])/, what: 'telephone number' },
  // A mobile number written without separators: 10 or 11 digits from a leading 0.
  { re: /(?<![\w.+-])0\d{9,10}(?![\w.-])/, what: 'telephone number' },
];
/** Addresses that stand for "an address": documentation domains and obvious placeholders. */
const PLACEHOLDER_MAIL = /@(?:example\.(?:com|org|net)|[\w.-]+\.(?:example|test|invalid|localhost))$|^(?:user|name|email|someone|xxx+)@/i;

const TOKEN_RE = /[A-Za-z0-9+/=_-]{20,}/g;
const HEX_RE = /\b[0-9a-f]{32,}\b/i;
const ENTROPY_THRESHOLD = 4.2;

function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * A path or identifier made of words, numbers and short word+number pairs joined by `/`,
 * `-`, `_` or `.` (`diagrams/20261105_order-payment-api-flow`, `v2/orders/20261105`) is
 * structured text, not a token, whatever its entropy. A base64 segment mixes letters and
 * digits inside one word, so it still counts.
 */
function isStructured(token) {
  const segments = token.split(/[/_.\-]+/).filter(Boolean);
  if (segments.length < 2) return false;
  return segments.every((seg) => /^[A-Za-z]+$/.test(seg) || /^[0-9]+$/.test(seg) || /^[A-Za-z]{1,3}[0-9]{1,4}$/.test(seg));
}

function looksRandom(token) {
  if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) return false;
  if (isStructured(token)) return false;
  return shannonEntropy(token) >= ENTROPY_THRESHOLD;
}

function preview(value) {
  const s = String(value);
  return s.length <= 6 ? `${s.slice(0, 2)}…` : `${s.slice(0, 4)}…(${s.length} chars)`;
}

function* strings(value, path) {
  if (typeof value === 'string') {
    yield { path: path || '/', value };
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}/${i}`);
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) yield* strings(value[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  }
}

/**
 * @param {unknown} ir
 * @returns {{ warnings: Array<{ path: string, kind: string, message: string }> }}
 */
export function scanSecrets(ir) {
  const warnings = [];
  for (const { path, value } of strings(ir, '')) {
    let flagged = false;
    for (const p of PATTERNS) {
      const m = value.match(p.re);
      if (m) {
        // "password: required" names a rule, not a password: a value of plain lower-case
        // letters is reported as a guess.
        const plainWord = p.re === SECRET_ASSIGNMENT && /[=:＝：]\s*['"「『]?\p{Ll}+$/u.test(m[0]);
        warnings.push({ path, kind: plainWord ? 'assignment' : p.kind, message: `possible ${p.what} (${preview(m[0])}); remove it before sharing the diagram` });
        flagged = true;
        break;
      }
    }
    if (flagged) continue;
    for (const p of PERSONAL) {
      const m = value.match(p.re);
      if (!m || (p.what === 'e-mail address' && PLACEHOLDER_MAIL.test(m[0]))) continue;
      warnings.push({ path, kind: 'personal-data', message: `possible ${p.what} (${preview(m[0])}); a diagram names roles and systems, not people: replace it with a placeholder such as <customer e-mail>` });
      flagged = true;
      break;
    }
    if (flagged) continue;
    const hex = value.match(HEX_RE);
    if (hex) {
      warnings.push({ path, kind: 'high-entropy', message: `long hexadecimal string (${preview(hex[0])}) looks like a key or hash; confirm it is not a secret` });
      continue;
    }
    for (const m of value.matchAll(TOKEN_RE)) {
      if (looksRandom(m[0])) {
        warnings.push({ path, kind: 'high-entropy', message: `high-entropy string (${preview(m[0])}) looks like a token; confirm it is not a secret` });
        break;
      }
    }
  }
  return { warnings };
}
