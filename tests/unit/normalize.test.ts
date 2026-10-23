import { describe, expect, it } from 'vitest';
import { canonicalUrl, normalizeItem, parseDate, safeHttpUrl, toPlainText } from '../../server/normalization/normalize';
import { NOW } from '../helpers';

const source = { id: 's', name: 'Fonte', kind: 'outlet' as const, reliability: 0.8, country: 'BR', language: 'pt' };

describe('canonical URLs', () => {
  it('removes tracking, fragments, mobile hosts and trailing slashes', () => {
    expect(canonicalUrl('http://www.g1.globo.com/a/b/?utm_source=x&b=2&a=1#top')).toBe('https://g1.globo.com/a/b?a=1&b=2');
    expect(canonicalUrl('https://m.example.com/x/amp')).toBe('https://example.com/x');
    expect(canonicalUrl('https://example.com/x?fbclid=1')).toBe(canonicalUrl('https://example.com/x/'));
  });
  it('rejects non-http schemes', () => {
    expect(canonicalUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,<b>x</b>')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
  });
});

describe('plain text', () => {
  it('strips markup, scripts and decodes entities — never keeps HTML', () => {
    const s = toPlainText('<p>Olá &amp; <b>mundo</b><script>alert(1)</script><img src=x onerror=alert(1)> &#8212; fim</p>');
    expect(s).toBe('Olá & mundo — fim');
    expect(s).not.toMatch(/[<>]/);
  });
  it('handles double-encoded markup from feeds', () => {
    expect(toPlainText('&lt;p&gt;Texto &lt;strong&gt;forte&lt;/strong&gt;&lt;/p&gt;')).toBe('Texto forte');
  });
  it('truncates at a word boundary', () => {
    const s = toPlainText('palavra '.repeat(100), 50);
    expect(s.length).toBeLessThanOrEqual(51);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('dates', () => {
  it('parses RFC 822, ISO and GDELT formats', () => {
    expect(parseDate('Fri, 23 Oct 2026 19:00:42 GMT', NOW)).toBe('2026-10-23T19:00:42.000Z');
    expect(parseDate('2026-10-23T18:00:00-03:00', NOW)).toBe('2026-10-23T21:00:00.000Z');
    expect(parseDate('20261023T201500Z', NOW)).toBe('2026-10-23T20:15:00.000Z');
  });
  it('rejects missing, invalid, future-dated and implausible dates', () => {
    expect(parseDate(undefined, NOW)).toBeUndefined();
    expect(parseDate('ontem', NOW)).toBeUndefined();
    expect(parseDate(new Date(NOW + 3_600_000).toISOString(), NOW)).toBeUndefined();
    expect(parseDate('1970-01-01T00:00:00Z', NOW)).toBeUndefined();
  });
});

describe('normalizeItem', () => {
  it('produces the unified model with distinct timestamps', () => {
    const fetchedAt = new Date(NOW).toISOString();
    const a = normalizeItem({ title: ' <b>Título</b> da notícia ', url: 'https://example.com/n?utm_medium=rss', summary: '<p>Resumo</p>', publishedAt: 'Fri, 23 Oct 2026 19:00:42 GMT' }, source, fetchedAt, NOW)!;
    expect(a.title).toBe('Título da notícia');
    expect(a.summary).toBe('Resumo');
    expect(a.canonicalUrl).toBe('https://example.com/n');
    expect(a.publishedAt).toBe('2026-10-23T19:00:42.000Z');
    expect(a.fetchedAt).toBe(fetchedAt);
    expect(a.occurredAt).toBeUndefined();
    expect(a.sourceCountry).toBe('BR');
  });
  it('drops items without a usable title or URL', () => {
    const at = new Date(NOW).toISOString();
    expect(normalizeItem({ title: 'curto', url: 'https://example.com/a' }, source, at, NOW)).toBeNull();
    expect(normalizeItem({ title: 'Um título suficientemente longo', url: 'javascript:void(0)' }, source, at, NOW)).toBeNull();
    expect(normalizeItem({ title: 'Um título suficientemente longo' }, source, at, NOW)).toBeNull();
  });
  it('keeps items with missing dates and summaries (no invented values)', () => {
    const a = normalizeItem({ title: 'Notícia sem data nem resumo', url: 'https://example.com/b' }, source, new Date(NOW).toISOString(), NOW)!;
    expect(a.publishedAt).toBeUndefined();
    expect(a.summary).toBeUndefined();
  });
  it('gives the same id to the same story behind different tracking URLs', () => {
    const at = new Date(NOW).toISOString();
    const a = normalizeItem({ title: 'Mesma matéria publicada', url: 'https://www.ex.com/x?utm_source=a' }, source, at, NOW)!;
    const b = normalizeItem({ title: 'Mesma matéria publicada', url: 'https://ex.com/x#comentarios' }, source, at, NOW)!;
    expect(a.id).toBe(b.id);
  });
});
