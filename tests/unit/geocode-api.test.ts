import { describe, expect, it } from 'vitest';
import { handleGeocode, verifyIdToken } from '../../server/http/geocodeApi';

const signedIn = async () => 'uid-1';
const anonymous = async () => undefined;

describe('geocode API (Vercel function)', () => {
  it('requires a signed-in user', async () => {
    expect((await handleGeocode(new URL('http://x/api/geocode?q=Recife'), undefined, anonymous)).status).toBe(401);
    // A malformed or foreign token never passes.
    expect(await verifyIdToken('Bearer not-a-jwt', 'sand-test')).toBeUndefined();
    expect(await verifyIdToken(undefined, 'sand-test')).toBeUndefined();
  });

  it('validates coordinates and unknown paths', async () => {
    expect((await handleGeocode(new URL('http://x/api/geocode/reverse?lat=200&lon=0'), 'Bearer t', signedIn)).status).toBe(400);
    expect((await handleGeocode(new URL('http://x/api/geocode/other'), 'Bearer t', signedIn)).status).toBe(404);
  });

  it('short queries answer without calling the geocoder', async () => {
    const r = await handleGeocode(new URL('http://x/api/geocode?q=a'), 'Bearer t', signedIn);
    expect(r).toMatchObject({ status: 200, body: { results: [] } });
  });
});
