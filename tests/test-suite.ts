import assert from 'assert';
import http from 'http';
import { encryptToken, decryptToken, maskToken } from '../src/lib/crypto';
import { Repository } from '../src/server/db/repository';
import { formatBytes, getTokenExpiryInfo, formatRelativeTime } from '../src/lib/utils';
import {
  normalizeProfileUrl,
  formatCaptionForYouTube,
  StandardPublicWebAdapter,
  PermittedSandboxAdapter,
  ReelDeduplicationStore,
} from '../src/server/monitoring/adapter';
import {
  getGoogleAuthUrl,
  saveGoogleCredentials,
  getValidAccessToken,
  isGoogleConnected,
  disconnectGoogle,
} from '../src/server/services/googleAuthService';
import { GoogleDriveService } from '../src/server/services/googleDriveService';
import { YouTubeService } from '../src/server/services/youtubeService';
import { PipelineService } from '../src/server/services/pipelineService';

async function runTests() {
  console.log('====================================================');
  console.log('AUTOSHORTS COMPREHENSIVE AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  // Test 1: AES-256-GCM Encryption & Decryption
  console.log('[Test 1] Testing AES-256-GCM Token Encryption & Decryption...');
  const sampleToken = 'EAAB_test_meta_graph_api_token_1234567890_abcdef';
  const encrypted = encryptToken(sampleToken);
  assert.notStrictEqual(encrypted, sampleToken, 'Encrypted token must not match plaintext');
  assert.strictEqual(encrypted.split(':').length, 3, 'Encrypted format must be iv:tag:ciphertext');

  const decrypted = decryptToken(encrypted);
  assert.strictEqual(decrypted, sampleToken, 'Decrypted token must exactly match original plaintext');

  const masked = maskToken(sampleToken);
  assert.ok(masked.startsWith('EAAB'), 'Masked token should start with first 4 characters');
  assert.ok(masked.endsWith('cdef'), 'Masked token should end with last 4 characters');
  console.log('✓ Token cryptography & masking verified');

  // Test 2: URL Normalization & Validation
  console.log('\n[Test 2] Testing URL Normalization & Validation...');
  const urlTests = [
    { input: 'https://www.instagram.com/creators/', expected: 'creators' },
    { input: 'https://instagram.com/tech_trends?igsh=123', expected: 'tech_trends' },
    { input: '@fitnessfuel_pro', expected: 'fitnessfuel_pro' },
    { input: 'streetstyle_ny/', expected: 'streetstyle_ny' },
  ];
  for (const t of urlTests) {
    const res = normalizeProfileUrl(t.input);
    assert.strictEqual(res.username, t.expected, `Expected ${t.expected} for ${t.input}`);
    assert.strictEqual(res.cleanUrl, `https://www.instagram.com/${t.expected}/`);
  }
  console.log('✓ URL normalization passed for all standard input formats');

  // Test 3: Caption Formatting for YouTube Shorts
  console.log('\n[Test 3] Testing YouTube Shorts Title & Description Extraction...');
  const multiLineCaption = `🔥 5 Best Developer Tools in 2026 That You Must Try!
Here is the full breakdown of why these tools will change your daily productivity.
1. SuperDev AI
2. Cloudflare D1
3. Next.js App Router

Tag a developer friend! #tech #developer #coding #productivity`;

  const formatted = formatCaptionForYouTube(multiLineCaption, 'techtrends_daily');
  assert.ok(formatted.title.includes('#shorts'), 'Title must contain #shorts tag');
  assert.ok(formatted.title.startsWith('🔥 5 Best Developer Tools'), 'Title must be extracted from the first line');
  assert.ok(formatted.description.includes(multiLineCaption), 'Description must preserve the full original caption');
  assert.ok(formatted.description.includes('@techtrends_daily'), 'Description must include source attribution');
  console.log(`✓ YouTube Title: "${formatted.title}"`);
  console.log('✓ Caption formatting strictly adheres to first-line title & full-caption description rules');

  // Test 4: Public Monitored Profiles Lifecycle & Source Switching
  console.log('\n[Test 4] Testing Public Monitored Profiles Lifecycle...');
  Repository.resetDemo();
  const initialProfiles = await Repository.getMonitoredProfiles();
  assert.ok(initialProfiles.length >= 3, 'Should have initial monitored profiles in demo store');

  // Add new profile
  const newProfile = await Repository.addMonitoredProfile(
    'https://www.instagram.com/travel_nomad_official/',
    'Travel Nomad Official'
  );
  assert.strictEqual(newProfile.username, 'travel_nomad_official');
  assert.strictEqual(newProfile.status, 'ACTIVE');
  console.log(`✓ Added public profile @${newProfile.username}`);

  // Pause monitoring
  const paused = await Repository.toggleProfileMonitoring(newProfile.id, true);
  assert.strictEqual(paused?.status, 'PAUSED', 'Profile status must be PAUSED');
  console.log(`✓ Paused monitoring for @${newProfile.username}`);

  // Resume monitoring
  const resumed = await Repository.toggleProfileMonitoring(newProfile.id, false);
  assert.strictEqual(resumed?.status, 'ACTIVE', 'Profile status must be ACTIVE');
  console.log(`✓ Resumed monitoring for @${newProfile.username}`);

  // Manual Check Now
  const checked = await Repository.checkProfileNow(newProfile.id);
  assert.ok(checked?.last_checked_at, 'Last checked timestamp must be updated');
  console.log(`✓ Checked @${newProfile.username} -> Status: "${checked?.status_reason}"`);

  // Switch active profile
  const switched = await Repository.setActiveMonitoredProfile(newProfile.id);
  assert.strictEqual(switched?.is_active_source, true, 'Profile must be active source');
  const activeProf = await Repository.getActiveMonitoredProfile();
  assert.strictEqual(activeProf?.id, newProfile.id, 'Active profile in store must match');
  console.log(`✓ Successfully switched active source to @${activeProf?.username} without changing workflow config`);

  // Remove profile
  const removed = await Repository.removeMonitoredProfile(newProfile.id);
  assert.strictEqual(removed, true, 'Removal must return true');
  const afterRemoval = await Repository.getMonitoredProfileById(newProfile.id);
  assert.strictEqual(afterRemoval, null, 'Profile must be deleted');
  console.log(`✓ Profile removed cleanly`);

  // Test 5: Overlapping Execution Mutex Lock
  console.log('\n[Test 5] Testing Overlapping Execution Lock (Mutex)...');
  await Repository.releaseAutomationLock(true);
  const lock1 = await Repository.acquireAutomationLock();
  assert.strictEqual(lock1, true, 'First lock acquisition must succeed');

  const lock2 = await Repository.acquireAutomationLock();
  assert.strictEqual(lock2, false, 'Second overlapping lock attempt must be blocked');

  await Repository.releaseAutomationLock(true);
  const lock3 = await Repository.acquireAutomationLock();
  assert.strictEqual(lock3, true, 'Lock should be acquirable again after release');
  await Repository.releaseAutomationLock(true);
  console.log('✓ Mutex concurrency protection successfully prevents overlapping runs');

  // Test 6: Reel Deduplication Store
  console.log('\n[Test 6] Testing Reel Deduplication Store...');
  const dedup = new ReelDeduplicationStore();
  assert.strictEqual(dedup.register('reel_xyz_100'), true, 'First register must return true');
  assert.strictEqual(dedup.register('reel_xyz_100'), false, 'Duplicate register must return false');
  assert.strictEqual(dedup.isDuplicate('reel_xyz_100'), true, 'isDuplicate must return true');
  assert.strictEqual(dedup.isDuplicate('reel_xyz_999'), false, 'Unseen reel must return false');
  assert.strictEqual(dedup.count, 1, 'Total tracked count must be 1');
  console.log('✓ Deduplication store prevents duplicate Reel ingestion');

  // Test 7: Upload Job Retry Mechanism
  console.log('\n[Test 7] Testing Upload Job History & Retry Mechanism...');
  const failedJobs = await Repository.getUploadJobs({ status: 'FAILED' });
  assert.ok(failedJobs.length > 0, 'Should find at least 1 failed job in demo set');

  const targetJob = failedJobs[0];
  const initialRetryCount = targetJob.retry_count;

  const retriedJob = await Repository.retryUploadJob(targetJob.id);
  assert.ok(retriedJob, 'Retried job must be returned');
  assert.strictEqual(retriedJob?.status, 'RETRYING', 'Job status must transition to RETRYING');
  assert.strictEqual(retriedJob?.retry_count, initialRetryCount + 1, 'Retry count must increment by 1');
  console.log(`✓ Job retry triggered successfully for reel #${retriedJob?.reel_id}`);

  // Test 8: Utility Functions
  console.log('\n[Test 8] Testing Utility Functions...');
  assert.strictEqual(formatBytes(1073741824), '1 GB');
  assert.strictEqual(formatBytes(52428800), '50 MB');
  console.log('✓ Utilities test passed');

  // Test 9: Google OAuth Authorization URL and Encrypted Credentials Management
  console.log('\n[Test 9] Testing Google OAuth Flow & Encrypted Token Storage...');
  process.env.GOOGLE_CLIENT_ID = 'test-client-id-12345.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-abcde';

  const { url: driveAuthUrl, state: driveState } = getGoogleAuthUrl('http://localhost:3000/api/auth/google/callback', 'drive');
  assert.ok(driveAuthUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'Auth URL must point to Google OAuth endpoint');
  assert.ok(driveAuthUrl.includes('drive.file'), 'Drive Auth URL must request drive.file scope');
  assert.ok(!driveAuthUrl.includes('youtube.upload'), 'Drive Auth URL must NOT bundle youtube scopes');
  assert.ok(driveAuthUrl.includes(`state=${driveState}`), 'Must include CSRF state parameter');

  const { url: ytAuthUrl, state: ytState } = getGoogleAuthUrl('http://localhost:3000/api/auth/google/callback', 'youtube');
  assert.ok(ytAuthUrl.includes('youtube.upload'), 'YouTube Auth URL must request youtube.upload scope');
  assert.ok(!ytAuthUrl.includes('drive.file'), 'YouTube Auth URL must NOT bundle drive scopes');
  assert.ok(ytAuthUrl.includes('access_type=offline'), 'Must request offline access for refresh token');
  assert.ok(ytAuthUrl.includes(`state=${ytState}`), 'Must include CSRF state parameter');
  console.log('✓ Google OAuth authorization URLs properly formed with separated Drive & YouTube scopes');

  // Test Credential storage & freshness
  const mockTokens = {
    access_token: 'ya29.test_google_access_token_99999',
    refresh_token: '1//04test_google_refresh_token_88888',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/youtube.upload',
    obtained_at: Date.now(),
  };

  await Repository.saveGoogleCredentials({
    encryptedAccessToken: encryptToken(mockTokens.access_token),
    encryptedRefreshToken: encryptToken(mockTokens.refresh_token),
    expiresAt: Date.now() + 3600 * 1000,
    email: 'autoshorts.creator@gmail.com',
    channelId: 'UC_TestShortsChannel123',
    channelTitle: 'AutoShorts Channel',
    updatedAt: new Date().toISOString(),
  });

  const isConn = await isGoogleConnected();
  assert.strictEqual(isConn, true, 'isGoogleConnected must return true');

  const validToken = await getValidAccessToken();
  assert.strictEqual(validToken, mockTokens.access_token, 'Retrieved valid token must match original decrypted token');

  // Test disconnect
  await disconnectGoogle();
  const isConnAfterDisconnect = await isGoogleConnected();
  assert.strictEqual(isConnAfterDisconnect, false, 'isGoogleConnected must return false after disconnect');
  console.log('✓ Google encrypted credential storage, retrieval, and disconnect verified');

  // Test 10: Google Drive Resumable Chunk Streaming
  console.log('\n[Test 10] Testing Google Drive Resumable Chunk Streaming...');
  let receivedRanges: string[] = [];
  const mockDriveServer = http.createServer((req, res) => {
    if (req.method === 'PUT') {
      const range = req.headers['content-range'] as string;
      receivedRanges.push(range);

      if (range.startsWith('bytes 0-5242879/')) {
        // First chunk accepted, incomplete (308)
        res.writeHead(308, { Range: 'bytes=0-5242879' });
        res.end();
      } else {
        // Final chunk complete (200)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'drive_file_abc_123', name: 'reel_video.mp4' }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => mockDriveServer.listen(0, '127.0.0.1', () => resolve()));
  const drivePort = (mockDriveServer.address() as any).port;
  const sessionUrl = `http://127.0.0.1:${drivePort}/upload-session`;

  const totalSize = 7 * 1024 * 1024; // 7 MB
  const chunk1 = new Uint8Array(5 * 1024 * 1024); // 5 MB
  const chunk2 = new Uint8Array(2 * 1024 * 1024); // 2 MB

  const res1 = await GoogleDriveService.uploadStreamChunk(sessionUrl, chunk1, 0, totalSize);
  assert.strictEqual(res1, null, 'Incomplete chunk upload must return null (status 308)');

  const res2 = await GoogleDriveService.uploadStreamChunk(sessionUrl, chunk2, 5 * 1024 * 1024, totalSize);
  assert.ok(res2, 'Completed chunk upload must return file metadata');
  assert.strictEqual(res2?.fileId, 'drive_file_abc_123', 'Returned file ID must match Drive payload');
  assert.strictEqual(receivedRanges[0], 'bytes 0-5242879/7340032', 'Range header must match 5MB chunk');
  assert.strictEqual(receivedRanges[1], 'bytes 5242880-7340031/7340032', 'Range header must match second chunk');

  mockDriveServer.close();
  console.log('✓ Google Drive 5MB resumable chunked upload protocol verified');

  // Test 11: Pipeline Orchestrator Concurrency & Ingestion
  console.log('\n[Test 11] Testing Pipeline Orchestrator (runSync)...');
  Repository.resetDemo();
  const syncResult = await PipelineService.runSync({
    force: true,
    sandbox: true, // Use PermittedSandboxAdapter to test end-to-end ingestion
  });

  assert.strictEqual(syncResult.success, true, 'runSync must succeed');
  assert.ok(syncResult.profilesChecked >= 1, 'Should check at least 1 profile');
  assert.ok(syncResult.reelsDetected >= 1, 'Should detect reels in sandbox mode');
  assert.ok(syncResult.jobsProcessed >= 1, 'Should create upload jobs for detected reels');

  const jobs = await Repository.getUploadJobs();
  const detectedJobs = jobs.filter((j) => j.status === 'DETECTED' || j.status === 'COMPLETED');
  assert.ok(detectedJobs.length > 0, 'New jobs must be present in upload jobs table');
  console.log(`✓ Pipeline runSync: ${syncResult.profilesChecked} profile(s) checked, ${syncResult.reelsDetected} reel(s) detected, ${syncResult.jobsProcessed} job(s) created`);

  // Test 12: Pipeline Deduplication on Subsequent Sync Run
  console.log('\n[Test 12] Testing Pipeline Deduplication on Subsequent Run...');
  const secondSync = await PipelineService.runSync({
    force: true,
    sandbox: true,
  });

  assert.strictEqual(secondSync.success, true, 'Second run must succeed');
  assert.strictEqual(secondSync.jobsProcessed, 0, 'Second run must process 0 jobs because of deduplication');
  assert.ok(
    secondSync.details.some((d) => d.includes('Skipping already-seen Reel')),
    'Second run details must record deduplication skips'
  );
  console.log('✓ Pipeline deduplication verified: Zero duplicate jobs created on identical media');

  console.log('\n====================================================');
  console.log('ALL 12 TEST SUITES PASSED CLEANLY (100% OK)');
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

