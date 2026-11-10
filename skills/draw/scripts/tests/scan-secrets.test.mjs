import { describe, it, expect } from 'vitest';
import { scanSecrets } from '../src/scan-secrets.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

const kinds = (ir) => scanSecrets(ir).warnings.map((w) => `${w.path}:${w.kind}`);

describe('scanSecrets', () => {
  it('is quiet on the ordinary fixtures', () => {
    for (const { kind, name, ir } of validFixtures()) {
      if (kind === 'adversarial') continue;
      expect(kinds(ir), `${kind}/${name}`).toEqual([]);
    }
  });

  it('flags the connection string and the token in the adversarial fixture without echoing them', () => {
    const { warnings } = scanSecrets(loadFixture('adversarial', 'labels'));
    expect(warnings.map((w) => `${w.path}:${w.kind}`)).toEqual([
      '/meta/notes/0:uri-credential',
      '/nodes/6/label:uri-credential',
      '/nodes/7/label:token-pattern',
    ]);
    for (const w of warnings) {
      expect(w.message).not.toContain('Sup3rS3cret');
      expect(w.message).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab');
    }
  });

  it('flags common token shapes and key=value assignments', () => {
    const ir = {
      a: 'AKIAIOSFODNN7EXAMPLE',
      b: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      c: 'password = hunter2hunter2',
      d: '-----BEGIN RSA PRIVATE KEY-----',
      e: 'xoxb-123456789012-abcdefghijkl',
      f: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123',
    };
    expect(kinds(ir)).toEqual(['/a:token-pattern', '/b:token-pattern', '/c:token-pattern', '/d:token-pattern', '/e:token-pattern', '/f:token-pattern']);
  });

  it('flags high-entropy and long hexadecimal strings but not prose or uuids', () => {
    expect(kinds({ x: 'Q7v9kLm2Xp4sR8tW1yZ3bN6cD0fG5hJ' })).toEqual(['/x:high-entropy']);
    expect(kinds({ x: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' })).toEqual(['/x:high-entropy']);
    expect(kinds({ x: 'Validate the shopping cart before capturing the payment' })).toEqual([]);
    expect(kinds({ x: '123e4567-e89b-12d3-a456-426614174000' })).toEqual([]);
    expect(kinds({ x: 'order-service-production-eu-west-1' })).toEqual([]);
  });

  it('does not flag run folder or source paths made of words and dates, but still flags base64 with slashes', () => {
    expect(kinds({ meta: { notes: ['Derived from diagrams/20261105_order-payment-api-flow.'] } })).toEqual([]);
    expect(kinds({ x: 'diagrams/20261105_order-payment-api-flow/source/login-01-mfa.ir.json' })).toEqual([]);
    expect(kinds({ x: 'api/v2/orders/20261105/items' })).toEqual([]);
    expect(kinds({ x: 'src/Services/OrderService.cs' })).toEqual([]);
    expect(kinds({ x: 'aGVsbG8gd29y/bGQgdGhpcyBp+cyBhIHRva2Vu' })).toEqual(['/x:high-entropy']);
    expect(kinds({ x: 'Q7v9kLm2Xp4sR8tW1yZ3bN6cD0fG5hJ/K2m' })).toEqual(['/x:high-entropy']);
  });

  it('uses JSON-pointer paths with escaping', () => {
    expect(scanSecrets({ 'a/b': { 'c~d': ['postgres://u:p@h/db'] } }).warnings[0].path).toBe('/a~1b/c~0d/0');
  });
});
