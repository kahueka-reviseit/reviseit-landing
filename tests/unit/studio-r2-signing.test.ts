// @vitest-environment node
// Signature Version 4 against AWS's published examples (S3 documentation, "Authenticating Requests:
// Using Query Parameters" and "Using the Authorization Header"). This checks the signing code only;
// it is not a test of Cloudflare R2. The R2 adapter's live behaviour remains unproved.
import { test, expect } from 'vitest';
import { signV4, R2StudioStorage } from '../../lib/studio/storage/r2';

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') };
test('presigned GET matches the published example signature', () => {
  const s = signV4({ ...credentials, method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: {}, payloadHash: 'UNSIGNED-PAYLOAD', presignExpires: 86400 });
  expect(s.signature).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});
test('header-signed GET with a range matches the published example signature', () => {
  const s = signV4({ ...credentials, method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  expect(s.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});
test('only provisional keys can be signed for upload, and plain HTTP is refused outside loopback', async () => {
  const r2 = new R2StudioStorage({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'studio-private', accessKeyId: 'a', secretAccessKey: 'b' });
  await expect(r2.presignPut('studio/blobs/m/' + 'a'.repeat(64), { expiresSeconds: 60, contentType: 'application/pdf' })).rejects.toThrow(/Only provisional upload keys/);
  const signed = await r2.presignPut('studio/uploads/m/00000000-0000-4000-8000-000000000001', { expiresSeconds: 60, contentType: 'application/pdf' });
  expect(signed.url).toMatch(/^https:\/\/account\.r2\.cloudflarestorage\.com\/studio-private\/studio\/uploads\/m\/.*X-Amz-Expires=60/);
  expect(() => new R2StudioStorage({ endpoint: 'http://example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 'b' })).toThrow(/HTTPS/);
});
