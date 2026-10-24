import { describe, expect, it } from 'vitest';
import { eventPoints } from '../../src/map/eventPoints';
import { fitWorld, largestPolygonCentroid } from '../../src/map/projection';
import { loadWorld } from '../../src/map/worldData';
import { analysis, event } from '../helpers';

describe('map markers', () => {
  it('finds a representative point for each gazetteer country inside its real area', async () => {
    const { centroids } = await loadWorld();
    const near = (cc: string, lon: number, lat: number, tol = 12) => {
      const c = centroids.get(cc)!;
      expect(c, cc).toBeTruthy();
      expect(Math.abs(c[0] - lon), `${cc} lon`).toBeLessThan(tol);
      expect(Math.abs(c[1] - lat), `${cc} lat`).toBeLessThan(tol);
    };
    near('CL', -71, -35);
    near('RU', 95, 62, 20);
    near('US', -99, 39);
    near('BR', -53, -10);
    near('FR', 2.5, 46.5, 4); // mainland, not French Guiana
    near('JP', 138, 37);
    near('CD', 23, -3);
    expect(centroids.size).toBeGreaterThan(100);
  });

  it('marks the most precise location first and never invents one', async () => {
    const { centroids } = await loadWorld();
    const quake = event({
      analysis: analysis({ locations: [{ name: 'epicentro', level: 'city', lat: -33.4, lon: -70.6, countryCode: 'CL', confidence: 0.9, via: 'official-feed' }, { name: 'Chile', level: 'country', countryCode: 'CL', confidence: 0.8, via: 'text' }] }),
    });
    const pts = eventPoints(quake, centroids);
    expect(pts[0]).toMatchObject({ lon: -70.6, lat: -33.4 });
    expect(pts).toHaveLength(1); // the epicentre is enough; Chile's centre is not marked too
    const russia = eventPoints(event({ analysis: analysis({ locations: [{ name: 'Rússia', level: 'country', countryCode: 'RU', confidence: 0.8, via: 'text' }] }) }), centroids);
    expect(russia).toHaveLength(1);
    const state = eventPoints(event({ analysis: analysis({ locations: [{ name: 'CE', level: 'state', countryCode: 'BR', admin1: 'CE', confidence: 0.8, via: 'official-feed' }] }) }), centroids);
    expect(state[0]).toMatchObject({ lat: -3.73, lon: -38.53 });
    expect(eventPoints(event({ analysis: analysis({ locations: [] }) }), centroids)).toEqual([]);
  });

  it('projects consistently: east is right, north is up, all inside the viewport', () => {
    const p = fitWorld(1200, 800);
    const [xChile, yChile] = p(-71, -35);
    const [xJapan, yJapan] = p(138, 37);
    expect(xJapan).toBeGreaterThan(xChile);
    expect(yJapan).toBeLessThan(yChile);
    for (const [lon, lat] of [[-180, 83], [180, -56]]) {
      const [x, y] = p(lon, lat);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1200);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(800);
    }
  });

  it('centroid of the largest polygon', () => {
    const square = (x: number, y: number, s: number) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
    expect(largestPolygonCentroid([square(0, 0, 1), square(10, 10, 4)])).toEqual([12, 12]);
  });
});
