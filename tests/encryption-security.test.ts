import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  encryptToken,
  decryptToken,
  validateEncryptionKey,
  getEncryptionKey,
  DEFAULT_DEV_KEY,
} from '../src/lib/crypto';

console.log('====================================================');
console.log('AUTOSHORTS ENCRYPTION & TOKEN SECURITY TEST SUITE');
console.log('====================================================\n');

async function runTests() {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  try {
    // -----------------------------------------------------------
    // Test 1: Production Enforces TOKEN_ENCRYPTION_KEY Requirement
    // -----------------------------------------------------------
    console.log('[Test 1] Testing Production Requirement for TOKEN_ENCRYPTION_KEY...');
    process.env.NODE_ENV = 'production';
    delete process.env.TOKEN_ENCRYPTION_KEY;

    const valMissing = validateEncryptionKey(undefined, true);
    assert.strictEqual(valMissing.valid, false);
    assert.ok(valMissing.error?.includes('mandatory in production'));

    assert.throws(
      () => getEncryptionKey(),
      /TOKEN_ENCRYPTION_KEY environment variable is mandatory in production/
    );
    console.log('✓ Missing TOKEN_ENCRYPTION_KEY throws fatal error in production.');

    // -----------------------------------------------------------
    // Test 2: Production Rejects Default Development Fallback Key
    // -----------------------------------------------------------
    console.log('\n[Test 2] Testing Production Rejection of Default Dev Key...');
    process.env.TOKEN_ENCRYPTION_KEY = DEFAULT_DEV_KEY;

    const valDevKey = validateEncryptionKey(DEFAULT_DEV_KEY, true);
    assert.strictEqual(valDevKey.valid, false);
    assert.ok(valDevKey.error?.includes('cannot use the default development key'));

    assert.throws(
      () => getEncryptionKey(),
      /cannot use the default development key in production/
    );
    console.log('✓ Default development key is strictly blocked in production.');

    // -----------------------------------------------------------
    // Test 3: Production Rejects Weak or Non-256-bit Keys
    // -----------------------------------------------------------
    console.log('\n[Test 3] Testing Production Rejection of Non-256-Bit Keys...');
    const invalidKeys = [
      'short_secret_key',
      '12345',
      'a'.repeat(63), // 63 chars (not 64)
      'g'.repeat(64), // 64 chars but non-hex ('g')
      'bm90X3RoaXJ0eV90d29fYnl0ZXM=', // Base64 of < 32 bytes
    ];

    for (const key of invalidKeys) {
      process.env.TOKEN_ENCRYPTION_KEY = key;
      assert.throws(
        () => getEncryptionKey(),
        /FATAL CONFIGURATION ERROR/,
        `Key "${key}" should have been rejected in production`
      );
    }
    console.log('✓ Weak and improperly formatted keys are strictly rejected in production.');

    // -----------------------------------------------------------
    // Test 4: Production Accepts Valid 64-Hex Characters
    // -----------------------------------------------------------
    console.log('\n[Test 4] Testing Production Acceptance of Valid 64-Hex Key...');
    const validHexKey = crypto.randomBytes(32).toString('hex');
    assert.strictEqual(validHexKey.length, 64);
    process.env.TOKEN_ENCRYPTION_KEY = validHexKey;

    const keyBuf = getEncryptionKey();
    assert.strictEqual(keyBuf.length, 32);

    const secretData = 'my_secret_oauth_refresh_token_xyz_123';
    const encrypted = encryptToken(secretData);
    assert.notStrictEqual(encrypted, secretData);
    assert.ok(encrypted.includes(':'));

    const decrypted = decryptToken(encrypted);
    assert.strictEqual(decrypted, secretData);
    console.log('✓ Valid 64-char hex key successfully encrypts and decrypts with AES-256-GCM in production.');

    // -----------------------------------------------------------
    // Test 5: Production Accepts Valid 32-Byte Base64 Key
    // -----------------------------------------------------------
    console.log('\n[Test 5] Testing Production Acceptance of Valid 32-Byte Base64 Key...');
    const validB64Key = crypto.randomBytes(32).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY = validB64Key;

    const b64KeyBuf = getEncryptionKey();
    assert.strictEqual(b64KeyBuf.length, 32);

    const secretData2 = 'second_token_payload_abc';
    const enc2 = encryptToken(secretData2);
    const dec2 = decryptToken(enc2);
    assert.strictEqual(dec2, secretData2);
    console.log('✓ Valid 32-byte Base64 key successfully encrypts and decrypts with AES-256-GCM in production.');

    // -----------------------------------------------------------
    // Test 6: Development Mode Allows Default Fallback
    // -----------------------------------------------------------
    console.log('\n[Test 6] Testing Development Mode Isolated Fallback...');
    process.env.NODE_ENV = 'development';
    delete process.env.TOKEN_ENCRYPTION_KEY;

    const devKeyBuf = getEncryptionKey();
    assert.strictEqual(devKeyBuf.length, 32);
    assert.strictEqual(devKeyBuf.toString('hex'), DEFAULT_DEV_KEY);

    const devData = 'local_dev_token_testing';
    const devEnc = encryptToken(devData);
    const devDec = decryptToken(devEnc);
    assert.strictEqual(devDec, devData);
    console.log('✓ Development mode cleanly allows isolated fallback key without failing.');

    // -----------------------------------------------------------
    // Test 7: Decryption Failure Never Leaks Secrets or Keys
    // -----------------------------------------------------------
    console.log('\n[Test 7] Testing Safe Failure on Tampered Ciphertext...');
    const tamperedParts = devEnc.split(':');
    tamperedParts[2] = 'deadbeef' + tamperedParts[2].slice(8); // Corrupt ciphertext
    const tamperedEnc = tamperedParts.join(':');

    assert.throws(
      () => decryptToken(tamperedEnc),
      /Decryption failed: Token is corrupt or key mismatch/
    );
    console.log('✓ Corrupt ciphertext fails safely with clean generic message (zero token leak).');

    // -----------------------------------------------------------
    // Test 8: YouTube Resumable Upload Session URI Encryption
    // -----------------------------------------------------------
    console.log('\n[Test 8] Testing YouTube Resumable Upload Session URI Encryption and Decryption...');
    process.env.NODE_ENV = 'production';
    process.env.TOKEN_ENCRYPTION_KEY = validHexKey;

    const rawSessionUri =
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=AEnB2UpmXYZ_SecretSessionBearer999';
    const encryptedSessionUri = encryptToken(rawSessionUri);

    assert.notStrictEqual(encryptedSessionUri, rawSessionUri, 'Session URI must not be stored in plaintext');
    assert.strictEqual(encryptedSessionUri.includes('AEnB2UpmXYZ_SecretSessionBearer999'), false, 'Ciphertext must not leak URI fragments');
    assert.strictEqual(encryptedSessionUri.split(':').length, 3, 'Must match iv:tag:ciphertext format');

    const recoveredSessionUri = decryptToken(encryptedSessionUri);
    assert.strictEqual(recoveredSessionUri, rawSessionUri, 'Decryption must recover exact original session URI');

    // Safe handling of empty/null
    assert.strictEqual(encryptToken(''), '', 'Empty string produces empty string');
    assert.strictEqual(decryptToken(''), '', 'Empty string decrypts to empty string');

    console.log('✓ YouTube resumable upload session URI encrypts and decrypts with AES-256-GCM zero plaintext leakage.');

    console.log('\n====================================================');
    console.log('ALL 8 ENCRYPTION & SECURITY TESTS PASSED (100% OK)');
    console.log('====================================================');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalKey) {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
