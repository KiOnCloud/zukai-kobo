/**
 * Deterministic secret scan over every string in an IR document. Labels and notes are
 * user- and code-derived, so a credential can land in a diagram by accident. The scan
 * returns warnings for every target; the figjam target turns them into a hard gate.
 * The matched value is never echoed in full.
 */

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
  { kind: 'token-pattern', re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[=:]\s*['"]?[^\s'"]{6,}/i, what: 'key=value assignment of a password, token or secret' },
];

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
        warnings.push({ path, kind: p.kind, message: `possible ${p.what} (${preview(m[0])}); remove it before sharing the diagram` });
        flagged = true;
        break;
      }
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
