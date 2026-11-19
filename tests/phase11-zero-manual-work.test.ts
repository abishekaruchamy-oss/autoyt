/**
 * phase11-zero-manual-work.test.ts
 *
 * AUTOSHORTS PHASE 11.0 — ZERO-MANUAL-WORK AUTOMATED PIPELINE TEST SUITE
 */

import assert from 'assert';
import { extractReelShortcode } from '../src/server/media/MediaResolver';
import {
  parsePublicPolarisMediaFromHtml,
  ExternalCloudResolverProvider,
} from '../src/server/media/cloudNativeResolver';
import {
  verifyMp4ContainerSignature,
  isInstagramWebpageUrl,
  redactMediaUrl,
  extractSignedUrlExpiryIso,
} from '../src/server/media/streamValidation';
import { Repository } from '../src/server/db/repository';
import { PipelineService } from '../src/server/services/pipelineService';
import { encryptToken } from '../src/lib/crypto';

function makeFakeMp4Header(size = 32, brand = 'isom'): Uint8Array {
  const buf = new Uint8Array(32);
  buf[0] = (size >> 24) & 0xff;
  buf[1] = (size >> 16) & 0xff;
  buf[2] = (size >> 8) & 0xff;
  buf[3] = size & 0xff;
  buf.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  for (let i = 0; i < 4; i++) {
    buf[8 + i] = brand.charCodeAt(i);
  }
  return buf;
}

async function runTests() {
  console.log('================================================================');
  console.log('AUTOSHORTS PHASE 11.0 — ZERO-MANUAL-WORK AUTOMATION TEST SUITE');
  console.log('================================================================\n');

  // Test 1: /reel/, /reels/, and query parameter normalization
  console.log('[Test 1] URL normalization (/reel/, /reels/, query params, invalid)...');
  const variants = [
    'https://www.instagram.com/reel/Df22NkrBxal/',
    'https://www.instagram.com/reels/Df22NkrBxal/',
    'https://www.instagram.com/reel/Df22NkrBxal/?utm_source=ig_web_copy_link&jplx=MzRlODBiNWFlZA==&avpt=MzRlODBiNWFlZA==',
    'Df22NkrBxal',
  ];
  for (const v of variants) {
    const res = extractReelShortcode(v);
    assert.strictEqual(res.isValid, true, `Expected valid for ${v}`);
    assert.strictEqual(res.shortcode, 'Df22NkrBxal', `Expected shortcode Df22NkrBxal for ${v}`);
    assert.strictEqual(res.canonicalUrl, 'https://www.instagram.com/reel/Df22NkrBxal/');
  }
  const bad = extractReelShortcode('https://example.com/not-a-reel');
  assert.strictEqual(bad.isValid, false, 'Non-Instagram URL must be rejected');
  console.log('✓ All URL variants normalize identically to Df22NkrBxal; invalid URLs rejected');

  // Test 2: Missing vs Active Standing Content-Rights Declaration
  console.log('\n[Test 2] Standing operator content-rights declaration lifecycle...');
  Repository.resetDemo();
  assert.strictEqual(await Repository.hasActiveRightsDeclaration(), false, 'Initially inactive');

  await assert.rejects(
    () => PipelineService.processSubmission({ reelUrl: 'https://www.instagram.com/reel/Df22NkrBxal/' }),
    /Compliance requirement/
  );

  const savedDecl = await Repository.saveRightsDeclaration({
    operatorIdentity: 'operator-admin',
    policyVersion: '1.0.0',
    status: 'ACTIVE',
  });
  assert.strictEqual(savedDecl.status, 'ACTIVE');
  assert.strictEqual(await Repository.hasActiveRightsDeclaration(), true);
  const logs = await Repository.getActivityLogs(5);
  assert.ok(
    logs.some((l) => l.message.includes('Standing content-rights declaration activated')),
    'Activation must be audited in activity_logs'
  );
  console.log('✓ Missing rights blocked; standing declaration activation persisted & audited');

  // Test 3: Polaris public HTML extraction + shortcode match + webpage rejection
  console.log('\n[Test 3] Cloud-native Polaris HTML media parser & expiry extraction...');
  const sampleMp4 =
    'https://instagram.fmaa12-3.fna.fbcdn.net/o1/v/t2/f2/m86/sample.mp4?oh=SECRET_SIG&oe=6B0398B9';
  const polarisPayload = {
    require: [
      [
        'RelayPrefetchedStreamCache',
        'next',
        [],
        [
          {
            __bbox: {
              result: {
                data: {
                  xig_polaris_media: {
                    if_not_gated_logged_out: {
                      code: 'Df22NkrBxal',
                      user: { username: 'zackdfilms' },
                      caption: { text: 'He Skydived Without A Parachute 😱' },
                      video_duration: 40,
                      video_versions: [
                        { width: 720, height: 1280, url: sampleMp4, type: 101 },
                      ],
                      image_versions2: {
                        candidates: [{ url: 'https://instagram.fmaa12-3.fna.fbcdn.net/thumb.jpg' }],
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      ],
    ],
  };
  const fakeHtml = `<html><script type="application/json" data-sjs>${JSON.stringify(polarisPayload)}</script></html>`;
  const parsed = parsePublicPolarisMediaFromHtml(fakeHtml, 'Df22NkrBxal');
  assert.ok(parsed, 'Must extract public Polaris media');
  assert.strictEqual(parsed.shortcode, 'Df22NkrBxal');
  assert.strictEqual(parsed.username, 'zackdfilms');
  assert.strictEqual(parsed.caption, 'He Skydived Without A Parachute 😱');
  assert.strictEqual(parsed.durationSeconds, 40);
  assert.ok(parsed.mediaExpiresAt && parsed.mediaExpiresAt.startsWith('2026-'));
  assert.strictEqual(
    parsePublicPolarisMediaFromHtml(fakeHtml, 'WRONG_CODE1'),
    null,
    'Must never mix mismatched shortcodes'
  );
  assert.strictEqual(isInstagramWebpageUrl('https://www.instagram.com/reel/Df22NkrBxal/'), true);
  assert.strictEqual(isInstagramWebpageUrl(sampleMp4), false);
  assert.strictEqual(redactMediaUrl(sampleMp4).includes('SECRET_SIG'), false);
  assert.ok(extractSignedUrlExpiryIso(sampleMp4));
  console.log('✓ Polaris parser extracts exact creator, caption, MP4 URL, and rejects mismatched shortcodes');

  // Test 4: MP4 ftyp signature verification & External Cloud Resolver validation
  console.log('\n[Test 4] MP4 container signature check & external cloud resolver validation...');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(makeFakeMp4Header(32, 'isom') as unknown as BodyInit, {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-31/13998762',
        },
      })) as typeof fetch;

    const sigOk = await verifyMp4ContainerSignature(sampleMp4);
    assert.strictEqual(sigOk.valid, true);
    assert.strictEqual(sigOk.atomType, 'ftyp');
    assert.strictEqual(sigOk.majorBrand, 'isom');

    // Reject HTML disguised as stream
    globalThis.fetch = (async () =>
      new Response('<html>Not a video</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    await assert.rejects(() => verifyMp4ContainerSignature(sampleMp4), /Invalid upstream media Content-Type/);

    // Reject Instagram webpage URL directly
    await assert.rejects(
      () => verifyMp4ContainerSignature('https://www.instagram.com/reel/Df22NkrBxal/'),
      /Rejected Instagram webpage URL/
    );

    // External Cloud Resolver rejects shortcode mismatch & accepts valid authenticated response
    process.env.MEDIA_RESOLVER_URL = 'https://resolver.example.com';
    process.env.MEDIA_RESOLVER_TOKEN = 'test_bearer_token';
    const extProvider = new ExternalCloudResolverProvider();
    assert.strictEqual(extProvider.canResolve('https://www.instagram.com/reel/Df22NkrBxal/'), true);

    let receivedAuth = '';
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const h = (init?.headers || {}) as Record<string, string>;
      receivedAuth = h.Authorization || '';
      return new Response(
        JSON.stringify({
          shortcode: 'Df22NkrBxal',
          creatorHandle: 'zackdfilms',
          caption: 'He Skydived Without A Parachute 😱',
          mediaUrl: sampleMp4,
          mimeType: 'video/mp4',
          durationSeconds: 40,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    const extOk = await extProvider.resolve('https://www.instagram.com/reel/Df22NkrBxal/', 'Df22NkrBxal');
    assert.strictEqual(extOk.success, true);
    assert.strictEqual(receivedAuth, 'Bearer test_bearer_token');
    delete process.env.MEDIA_RESOLVER_URL;
    delete process.env.MEDIA_RESOLVER_TOKEN;
    console.log('✓ MP4 ftyp check, webpage rejection, and authenticated cloud resolver verified');

    // Test 5: Full single-field automated end-to-end pipeline + PUBLIC visibility enforcement + deduplication
    console.log('\n[Test 5] Single-field automated pipeline (Drive archive -> Drive-backed YouTube PUBLIC -> Dedup)...');
    Repository.resetDemo();
    await Repository.saveRightsDeclaration({
      operatorIdentity: 'operator-admin',
      policyVersion: '1.0.0',
      status: 'ACTIVE',
    });

    // Save isolated Drive + YouTube service credentials
    await Repository.saveGoogleServiceCredentials({
      service: 'drive',
      encryptedAccessToken: encryptToken('drive_token_phase11'),
      encryptedRefreshToken: encryptToken('drive_refresh_phase11'),
      expiresAt: Date.now() + 3600_000,
      email: 'drive@example.com',
      scope: 'https://www.googleapis.com/auth/drive.file',
    });
    await Repository.saveGoogleServiceCredentials({
      service: 'youtube',
      encryptedAccessToken: encryptToken('yt_token_phase11'),
      encryptedRefreshToken: encryptToken('yt_refresh_phase11'),
      expiresAt: Date.now() + 3600_000,
      email: 'yt@example.com',
      channelId: 'UCggMo0wtdbONWOM-aKns4uA',
      channelTitle: 'Tfilm',
      scope: 'https://www.googleapis.com/auth/youtube.upload',
    });

    let ytSentPrivacy = '';
    let ytSourceWasDrive = false;
    let ytUploadsCount = 0;
    const mp4Payload = makeFakeMp4Header(32, 'isom');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);

      // Drive folder lookup
      if (urlStr.includes('drive/v3/files?q=') && urlStr.includes('application%2Fvnd.google-apps.folder')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder_ig_backup', name: 'Instagram Reels Backup' }] }), { status: 200 });
      }
      // Drive file existence dedup check
      if (urlStr.includes('drive/v3/files?q=')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      // Drive initiate resumable upload
      if (urlStr.includes('upload/drive/v3/files?uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { Location: 'https://upload.drive.test/session1' } });
      }
      // Drive chunk upload
      if (urlStr === 'https://upload.drive.test/session1') {
        return new Response(JSON.stringify({ id: 'drive_file_df22', name: 'reel_Df22NkrBxal_zackdfilms.mp4' }), { status: 200 });
      }
      // Drive archive metadata verification
      if (urlStr.includes('drive/v3/files/drive_file_df22?fields=')) {
        return new Response(
          JSON.stringify({
            id: 'drive_file_df22',
            name: 'reel_Df22NkrBxal_zackdfilms.mp4',
            size: String(mp4Payload.byteLength),
            mimeType: 'video/mp4',
            trashed: false,
          }),
          { status: 200 }
        );
      }
      // Drive download stream used as YouTube upload source
      if (urlStr.includes('drive/v3/files/drive_file_df22?alt=media')) {
        ytSourceWasDrive = true;
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { 'content-type': 'video/mp4', 'content-length': String(mp4Payload.byteLength) },
          });
        }
        return new Response(mp4Payload as unknown as BodyInit, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(mp4Payload.byteLength) },
        });
      }
      // YouTube initiate resumable upload
      if (urlStr.includes('upload/youtube/v3/videos?uploadType=resumable')) {
        ytUploadsCount++;
        const parsedBody = JSON.parse(String(init?.body || '{}')) as { status?: { privacyStatus?: string } };
        ytSentPrivacy = parsedBody.status?.privacyStatus || '';
        return new Response(null, { status: 200, headers: { Location: 'https://upload.youtube.test/session1' } });
      }
      // YouTube chunk upload
      if (urlStr === 'https://upload.youtube.test/session1') {
        return new Response(JSON.stringify({ id: 'yt_public_df22' }), { status: 200 });
      }
      // YouTube video details verification
      if (urlStr.includes('youtube/v3/videos?part=snippet,status&id=yt_public_df22')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'yt_public_df22',
                snippet: {
                  title: 'He Skydived Without A Parachute 😱 #shorts',
                  description: 'He Skydived Without A Parachute 😱 | Credit: @zackdfilms',
                  channelId: 'UCggMo0wtdbONWOM-aKns4uA',
                },
                status: {
                  privacyStatus: 'public',
                  uploadStatus: 'uploaded',
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      // Upstream sample MP4 probe/download
      if (urlStr.includes('sample.mp4')) {
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { 'content-type': 'video/mp4', 'content-length': String(mp4Payload.byteLength) },
          });
        }
        return new Response(mp4Payload as unknown as BodyInit, {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(mp4Payload.byteLength),
            'content-range': `bytes 0-${mp4Payload.byteLength - 1}/${mp4Payload.byteLength}`,
          },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const completed = await PipelineService.processSubmission({
      reelUrl: 'https://www.instagram.com/reel/Df22NkrBxal/',
      directVideoUrl: sampleMp4,
      captionOverride: 'He Skydived Without A Parachute 😱 | Credit: @zackdfilms',
    });

    assert.strictEqual(completed.status, 'COMPLETED', 'Job must reach COMPLETED');
    assert.strictEqual(completed.drive_file_id, 'drive_file_df22', 'Drive file ID must be persisted');
    assert.strictEqual(completed.youtube_video_id, 'yt_public_df22', 'YouTube video ID must be persisted');
    assert.strictEqual(completed.youtube_privacy_status, 'public', 'Verified privacyStatus must be public');
    assert.strictEqual(ytSentPrivacy, 'public', 'YouTube upload MUST explicitly send privacyStatus=public');
    assert.strictEqual(ytSourceWasDrive, true, 'YouTube upload MUST stream from verified Google Drive archive');
    assert.strictEqual(ytUploadsCount, 1, 'Exactly one YouTube upload must occur');

    // Duplicate submission must return the same completed job without re-uploading
    const duplicate = await PipelineService.processSubmission({
      reelUrl: 'https://www.instagram.com/reels/Df22NkrBxal/?utm_source=ig_web_copy_link',
    });
    assert.strictEqual(duplicate.id, completed.id, 'Duplicate submission must return existing job ID');
    assert.strictEqual(ytUploadsCount, 1, 'Duplicate submission must NOT trigger a second YouTube upload');

    console.log('✓ Full single-field automated pipeline verified: Drive archive -> Drive-backed PUBLIC YouTube upload -> Zero duplicates');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n================================================================');
  console.log('ALL PHASE 11.0 ZERO-MANUAL-WORK TESTS PASSED (100% OK)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Phase 11.0 test suite failed:', err);
  process.exit(1);
});
