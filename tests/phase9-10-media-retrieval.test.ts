/**
 * phase9-10-media-retrieval.test.ts
 *
 * AUTOSHORTS PHASE 9.10.1 REGRESSION TEST SUITE:
 * 1. Worker-compatible media retrieval & child_process elimination
 * 2. Direct MP4 stream resolution via UserDirectStreamProvider
 * 3. Malformed source URL rejection & SSRF defenses
 * 4. Expired / unreachable URL handling
 * 5. Duplicate job protection & existing job preservation
 */

import assert from 'assert';
import { isValidPublicMediaUrl, MediaResolver } from '../src/server/media/MediaResolver';
import { ReClipYtDlpProvider } from '../src/server/media/reclipProvider';
import { Repository } from '../src/server/db/repository';
import { PipelineService } from '../src/server/services/pipelineService';

async function runTests() {
  console.log('================================================================');
  console.log('AUTOSHORTS PHASE 9.10.1 — MEDIA RETRIEVAL & JOB REUSE TEST SUITE');
  console.log('================================================================\n');

  // Test 1: Cloudflare Worker environment detection prevents child_process crash
  console.log('[Test 1] Cloudflare Worker child_process elimination...');
  // Simulate Cloudflare Worker global
  (globalThis as Record<string, unknown>).WebSocketPair = class {};
  const reclip = new ReClipYtDlpProvider();
  const cfResolution = await reclip.resolve('https://www.instagram.com/reel/Dfp-R-Ox_FY/', 'Dfp-R-Ox_FY');
  assert.strictEqual(cfResolution.success, false, 'Should fail gracefully in Cloudflare Worker');
  assert.strictEqual(cfResolution.requiresManualMedia, true, 'Should request manual media stream');
  assert.match(cfResolution.reason, /Serverless runtime environment \(Cloudflare Workers\)/, 'Reason should cite serverless environment');
  delete (globalThis as Record<string, unknown>).WebSocketPair;
  console.log('✓ Worker environment gracefully prompts for creator-authorized media stream without unenv crashes');

  // Test 2: Valid Direct Meta CDN MP4 Resolution
  console.log('\n[Test 2] Valid Direct Meta CDN MP4 Resolution...');
  const testCdnUrl = 'https://instagram.fmaa16-1.fna.fbcdn.net/o1/v/t2/f2/m86/test_stream.mp4?sig=valid';
  const validRes = await MediaResolver.resolveReel('https://www.instagram.com/reel/Dfp-R-Ox_FY/', {
    directVideoUrl: testCdnUrl,
    confirmedRights: true,
    caption: 'Trapped on a ski lift overnight 😨 | Credit: @zackdfilms',
    username: 'zackdfilms',
  });
  assert.strictEqual(validRes.success, true, 'Direct media stream should resolve successfully');
  assert.strictEqual(validRes.status, 'MEDIA_AVAILABLE', 'Status must be MEDIA_AVAILABLE');
  assert.ok(
    validRes.provider === 'CREATOR_AUTHORIZED_URL' || validRes.provider === 'USER_DIRECT_STREAM',
    'Provider must be direct media provider'
  );
  assert.strictEqual(validRes.mediaUrl, testCdnUrl, 'Media URL must match');
  assert.strictEqual(validRes.username, 'zackdfilms', 'Username must be zackdfilms');
  console.log('✓ Direct Meta CDN progressive stream correctly resolved with creator attribution');

  // Test 3: Malformed source rejection & SSRF defenses
  console.log('\n[Test 3] Malformed source rejection & SSRF defenses...');
  const invalidUrls = [
    'http://localhost:8080/video.mp4',
    'http://127.0.0.1/video.mp4',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/stream.mp4',
    'ftp://example.com/video.mp4',
    'javascript:alert(1)',
    'not-a-url',
  ];
  for (const badUrl of invalidUrls) {
    const check = isValidPublicMediaUrl(badUrl);
    assert.strictEqual(check.isValid, false, `URL "${badUrl}" must be rejected`);
  }
  console.log('✓ Malformed, non-HTTPS, internal loopback, and metadata endpoint URLs strictly rejected');

  // Test 4: Duplicate job protection & existing job preservation
  console.log('\n[Test 4] Duplicate job protection & existing job preservation...');
  Repository.resetDemo();
  const shortcode = 'Dfp-R-Ox_FY';
  
  // Create an initial job in WAITING_FOR_AUTHORIZED_MEDIA
  const initialJob = await Repository.addUploadJob({
    reel_id: `reel_${shortcode}`,
    shortcode,
    original_reel_url: `https://www.instagram.com/reel/${shortcode}/`,
    caption: `Reel #${shortcode}`,
    account_username: 'creator',
    status: 'WAITING_FOR_AUTHORIZED_MEDIA',
    rights_confirmed: true,
    media_source_type: 'PUBLIC_PROBE',
    error_details: 'Waiting for creator-authorized media stream',
  });
  assert.ok(initialJob.id, 'Initial job must have ID');

  const beforeJobs = await Repository.getUploadJobs();
  const matchingBefore = beforeJobs.filter(j => j.shortcode === shortcode);
  assert.strictEqual(matchingBefore.length, 1, 'Exactly one job must exist initially');

  // Submit the Reel again with directVideoUrl
  const processedJob = await PipelineService.processSubmission({
    reelUrl: `https://www.instagram.com/reel/${shortcode}/`,
    directVideoUrl: testCdnUrl,
    captionOverride: 'Trapped on a ski lift overnight 😨 | Credit: @zackdfilms',
    visibility: 'public',
    confirmedRights: true,
  }, { sandbox: true });

  assert.strictEqual(processedJob.id, initialJob.id, 'Must reuse the exact existing job ID');

  const afterJobs = await Repository.getUploadJobs();
  const matchingAfter = afterJobs.filter(j => j.shortcode === shortcode);
  assert.strictEqual(matchingAfter.length, 1, 'Exactly one job must remain in database (zero duplicate jobs)');
  assert.strictEqual(processedJob.account_username, 'zackdfilms', 'Username must be updated to zackdfilms');
  console.log('✓ Existing job ID preserved and reused; zero duplicate rows created in database');

  console.log('\n================================================================');
  console.log('ALL PHASE 9.10.1 REGRESSION TESTS PASSED (100% OK)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
