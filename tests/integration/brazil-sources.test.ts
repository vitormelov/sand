import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConnectors, DEFAULT_RSS_FEEDS, G1_STATES } from '../../server/config';
import { analyzeArticle } from '../../server/analysis/rules';
import { normalizeItem, parseDate } from '../../server/normalization/normalize';
import { brDateTime, parseAneelFlags, parseIbge, parseInfoDengue, parseRsbr } from '../../server/sources/brazil';
import { decodeBody } from '../../server/sources/http';
import { rssConnector } from '../../server/sources/rss';

/** Fixtures captured from the real services on 2026-10-24 (trimmed). */
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const OCT_2026 = Date.parse('2026-10-24T18:00:00Z');

describe('IBGE news API', () => {
  it('maps items with Brasília-time dates and https links', () => {
    const items = parseIbge(fx('ibge.json'));
    expect(items).toHaveLength(2);
    expect(items[0].title).toBeTruthy();
    expect(items[0].url).toMatch(/^https:\/\/agenciadenoticias\.ibge\.gov\.br\//);
    expect(items[0].publishedAt).toMatch(/^2026-10-\d\dT/);
    expect(items[0].hints?.eventKey).toMatch(/^ibge:\d+$/);
  });

  it('parses dd/mm/yyyy hh:mm:ss as Brasília time', () => {
    expect(brDateTime('23/10/2026 02:30:54')).toBe('2026-10-23T05:30:54.000Z');
    expect(brDateTime('ontem')).toBeUndefined();
  });
});

describe('ANEEL tariff flag', () => {
  it('announces the return to green after a costlier month, only for the current month', () => {
    const items = parseAneelFlags(fx('aneel-bandeira.json'), OCT_2026);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('ANEEL: bandeira tarifária volta a verde em outubro de 2026');
    expect(items[0].summary).toContain('no mês anterior a bandeira era amarela');
    expect(items[0].hints?.eventKey).toBe('aneel-bandeira:2026-10');
  });

  it('says nothing when green follows green, and reports the surcharge of a costlier flag', () => {
    const data = (records: object[]) => JSON.stringify({ result: { records } });
    expect(parseAneelFlags(data([{ DatCompetencia: '2026-09-01', NomBandeiraAcionada: 'Verde' }, { DatCompetencia: '2026-10-01', NomBandeiraAcionada: 'Verde', VlrAdicionalBandeira: ',00' }]), OCT_2026)).toEqual([]);
    const [red] = parseAneelFlags(data([{ DatCompetencia: '2026-10-01', NomBandeiraAcionada: 'Vermelha Patamar 2', VlrAdicionalBandeira: '78,77' }]), OCT_2026);
    expect(red.summary).toContain('R$ 7,88 a cada 100 kWh');
    expect(red.hints?.severity).toBe(0.6);
  });
});

describe('InfoDengue', () => {
  it('turns an orange-level week into an item located in the capital', () => {
    const [item] = parseInfoDengue(fx('infodengue-bh.json'), { geocode: 3106200, name: 'Belo Horizonte', uf: 'MG' });
    expect(item.title).toBe('InfoDengue: alerta laranja de dengue em Belo Horizonte (MG), semana 41');
    expect(item.url).toBe('https://info.dengue.mat.br/alerta/3106200/dengue?se=202641');
    expect(item.hints?.locations?.[0]).toMatchObject({ level: 'city', admin1: 'MG' });
    expect(item.hints?.channels?.[0].channel).toBe('public_health');
  });

  it('stays quiet at green and yellow levels', () => {
    const quiet = JSON.stringify([{ SE: 202641, nivel: 2, municipio_nome: 'Fortaleza' }]);
    expect(parseInfoDengue(quiet, { geocode: 2304400, name: 'Fortaleza', uf: 'CE' })).toEqual([]);
  });
});

describe('Sismologia USP (RSBR)', () => {
  it('keeps only tremors inside Brazil (City/UF) and links each event page', () => {
    const items = parseRsbr(fx('rsbr.txt'));
    expect(items.map((i) => i.hints?.eventKey)).toEqual(['rsbr:usp2026twuv', 'rsbr:usp2026ridc', 'rsbr:usp2026owdm', 'rsbr:usp2026mzud', 'rsbr:usp2026mspe']);
    expect(items[0].title).toBe('Tremor de magnitude 3,2 em Nuporanga (SP)');
    expect(items[0].url).toBe('https://moho.iag.usp.br/eq/event/usp2026twuv');
    expect(items[3].title).toBe('Tremor de magnitude 3,0 na plataforma continental (RJ)');
    expect(items[0].hints?.locations?.[0]).toMatchObject({ countryCode: 'BR', admin1: 'SP' });
  });
});

describe('feed decoding', () => {
  it('reads ISO-8859-1 feeds that do not declare it (UOL, Folha)', () => {
    const latin1 = Uint8Array.from([...'<rss><title>Not'].map((c) => c.charCodeAt(0)).concat([0xed, 0x63, 0x69, 0x61, 0x73]));
    expect(decodeBody(latin1, 'text/xml')).toContain('Notícias');
    expect(decodeBody(new TextEncoder().encode('Notícias'), 'text/xml; charset=utf-8')).toBe('Notícias');
  });

  it('understands dates with Portuguese month names (Mongabay)', () => {
    expect(parseDate('23 Out 2026 07:04:13 +0000', OCT_2026)).toBe('2026-10-23T07:04:13.000Z');
    expect(parseDate('Sex, 23 Out 2026 07:04:13 +0000', OCT_2026)).toBe('2026-10-23T07:04:13.000Z');
  });

  it('places news from federal bodies in Brazil, whatever the text mentions', async () => {
    const xml = '<rss><channel><item><title>Copom reduz a taxa Selic para 13,75% a.a.</title><link>https://www.bcb.gov.br/detalhenoticia/1/x</link><description>Conflito no Oriente Médio segue no radar.</description></item></channel></rss>';
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } })) as typeof fetch;
    try {
      const c = rssConnector({ id: 'bcb-copom', name: 'Banco Central — Copom', url: 'https://example.test/feed', kind: 'official', reliability: 0.95, country: 'BR', national: true });
      const { items } = await c.fetch({ signal: new AbortController().signal, state: {}, now: OCT_2026 });
      const art = normalizeItem(items[0], c, new Date(OCT_2026).toISOString(), OCT_2026)!;
      const a = analyzeArticle(art);
      expect(a.locations[0]).toMatchObject({ name: 'Brasil', level: 'country' });
      expect(a.affectedScope).toBe('national');
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe('default source list', () => {
  afterEach(() => {
    delete process.env.ENABLE_INTERNATIONAL;
    delete process.env.GDELT_ENABLED;
  });

  it('has unique ids, a g1 feed per state (27) and a group for every source', () => {
    const ids = buildConnectors().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(G1_STATES).toHaveLength(27);
    expect(DEFAULT_RSS_FEEDS.filter((f) => /^g1-[a-z]{2}$/.test(f.id))).toHaveLength(27);
    expect(ids).toContain('g1-ce'); // kept from before, so saved per-user choices still apply
    expect(buildConnectors().filter((c) => !c.group)).toEqual([]);
  });

  it('is Brazil-only by default: international feeds and GDELT stay off unless asked for', () => {
    const list = buildConnectors();
    expect(list.map((c) => c.id)).not.toContain('bbc-world');
    expect(list.find((c) => c.id === 'gdelt')?.enabled).toBe(false);
    process.env.ENABLE_INTERNATIONAL = '1';
    process.env.GDELT_ENABLED = '1';
    const all = buildConnectors();
    expect(all.map((c) => c.id)).toContain('guardian-world');
    expect(all.find((c) => c.id === 'gdelt')?.enabled).toBe(true);
  });
});
