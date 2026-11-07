import assert from 'assert';
import { encryptToken, decryptToken, maskToken } from '../src/lib/crypto';
import { Repository } from '../src/server/db/repository';
import { formatBytes, getTokenExpiryInfo, formatRelativeTime } from '../src/lib/utils';
import {
  normalizeProfileUrl,
  formatCaptionForYouTube,
  StandardPublicWebAdapter,
  ReelDeduplicationStore,
} from '../src/server/monitoring/adapter';

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

  console.log('\n====================================================');
  console.log('ALL 8 TEST SUITES PASSED CLEANLY (100% OK)');
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
