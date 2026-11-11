import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require('../scripts/guard-production-build.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const GUARD_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'guard-production-build.js');

const EXPECTED_PROTECTED_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
  '.env.production',
  '.env.production.local',
  '.dev.vars',
  '.dev.vars.local',
] as const;

console.log('====================================================');
console.log('AUTOSHORTS PRODUCTION BUILD ENVIRONMENT GUARD TESTS');
console.log('====================================================\n');

function createIsolatedTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autoshorts-build-guard-'));
}

async function runTests() {
  // -----------------------------------------------------------
  // Test 1: Clean directory without dotenv files passes cleanly
  // -----------------------------------------------------------
  console.log('[Test 1] Verifying clean directory without recognized dotenv files passes...');
  const cleanDir = createIsolatedTempDir();
  try {
    fs.writeFileSync(path.join(cleanDir, '.env.example'), 'TOKEN_ENCRYPTION_KEY=example\n', 'utf8');

    const unitResult = guard.checkProductionBuildEnvironment(cleanDir);
    assert.strictEqual(unitResult.ok, true);
    assert.deepStrictEqual(unitResult.detectedFiles, []);
    assert.strictEqual(unitResult.errorMessage, null);

    const cliResult = spawnSync(process.execPath, [GUARD_SCRIPT_PATH], {
      cwd: cleanDir,
      encoding: 'utf8',
    });
    assert.strictEqual(cliResult.status, 0, `Expected exit 0, got ${cliResult.status}: ${cliResult.stderr}`);
    assert.ok(cliResult.stdout.includes('Clean environment verified'));
    console.log('✓ Clean directory passes guard (.env.example ignored as non-prohibited).');
  } finally {
    fs.rmSync(cleanDir, { recursive: true, force: true });
  }

  // -----------------------------------------------------------
  // Test 2: Populated .env.local is blocked without exposing contents
  // -----------------------------------------------------------
  console.log('\n[Test 2] Verifying populated .env.local triggers guard without exposing secret contents...');
  const envLocalDir = createIsolatedTempDir();
  const secretSentinel = 'SENTINEL_SECRET_VALUE_SHOULD_NEVER_PRINT_9f8e7d6c5b4a';
  const clientSecretSentinel = 'GOCSPX-TEST_CLIENT_SECRET_NEVER_PRINT_12345';
  try {
    fs.writeFileSync(
      path.join(envLocalDir, '.env.local'),
      `TOKEN_ENCRYPTION_KEY=${secretSentinel}\nGOOGLE_CLIENT_SECRET=${clientSecretSentinel}\n`,
      'utf8'
    );

    const unitResult = guard.checkProductionBuildEnvironment(envLocalDir);
    assert.strictEqual(unitResult.ok, false);
    assert.deepStrictEqual(unitResult.detectedFiles, ['.env.local']);
    assert.ok(unitResult.errorMessage?.includes('.env.local'));
    assert.ok(unitResult.errorMessage?.includes('outside the repository'));
    assert.ok(!unitResult.errorMessage?.includes(secretSentinel));
    assert.ok(!unitResult.errorMessage?.includes(clientSecretSentinel));
    assert.ok(!unitResult.errorMessage?.includes('TOKEN_ENCRYPTION_KEY'));
    assert.ok(!unitResult.errorMessage?.includes('GOOGLE_CLIENT_SECRET'));

    const cliResult = spawnSync(process.execPath, [GUARD_SCRIPT_PATH], {
      cwd: envLocalDir,
      encoding: 'utf8',
    });
    const combinedOutput = `${cliResult.stdout || ''}\n${cliResult.stderr || ''}`;
    assert.notStrictEqual(cliResult.status, 0, 'Expected non-zero exit code when .env.local exists');
    assert.ok(combinedOutput.includes('.env.local'));
    assert.ok(combinedOutput.includes('outside the repository'));
    assert.ok(!combinedOutput.includes(secretSentinel), 'Guard must never leak dotenv secret values');
    assert.ok(!combinedOutput.includes(clientSecretSentinel), 'Guard must never leak dotenv secret values');
    assert.ok(!combinedOutput.includes('TOKEN_ENCRYPTION_KEY'), 'Guard must never read or leak dotenv keys');
    console.log('✓ Guard blocked build on .env.local and printed filename only without leaking contents.');
  } finally {
    fs.rmSync(envLocalDir, { recursive: true, force: true });
  }

  // -----------------------------------------------------------
  // Test 3: Every single one of the 10 protected filenames triggers individually without leakage
  // -----------------------------------------------------------
  console.log('\n[Test 3] Verifying each of the 10 protected filenames is detected individually with zero secret leakage...');
  assert.deepStrictEqual(guard.RECOGNIZED_DOTENV_FILES, [...EXPECTED_PROTECTED_FILES]);

  for (const filename of EXPECTED_PROTECTED_FILES) {
    const singleFileDir = createIsolatedTempDir();
    const sentinelKey = `SECRET_KEY_${filename.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
    const sentinelVal = `SENTINEL_VAL_${filename}_DO_NOT_EXPOSED_778899`;
    try {
      fs.writeFileSync(path.join(singleFileDir, filename), `${sentinelKey}=${sentinelVal}\n`, 'utf8');

      const unitResult = guard.checkProductionBuildEnvironment(singleFileDir);
      assert.strictEqual(unitResult.ok, false, `Expected unit guard failure for ${filename}`);
      assert.deepStrictEqual(unitResult.detectedFiles, [filename]);
      assert.ok(!unitResult.errorMessage?.includes(sentinelKey));
      assert.ok(!unitResult.errorMessage?.includes(sentinelVal));

      const cliResult = spawnSync(process.execPath, [GUARD_SCRIPT_PATH], {
        cwd: singleFileDir,
        encoding: 'utf8',
      });
      const combinedOutput = `${cliResult.stdout || ''}\n${cliResult.stderr || ''}`;
      assert.notStrictEqual(cliResult.status, 0, `Expected non-zero exit code for ${filename}`);
      assert.ok(combinedOutput.includes(filename), `Expected detected filename ${filename}`);
      assert.ok(!combinedOutput.includes(sentinelKey), `Guard leaked key for ${filename}`);
      assert.ok(!combinedOutput.includes(sentinelVal), `Guard leaked secret sentinel for ${filename}`);
    } finally {
      fs.rmSync(singleFileDir, { recursive: true, force: true });
    }
  }
  console.log(`✓ All ${EXPECTED_PROTECTED_FILES.length} protected filenames verified individually without exposing contents.`);

  // -----------------------------------------------------------
  // Test 4: All 10 recognized dotenv/dev-vars files detected together
  // -----------------------------------------------------------
  console.log('\n[Test 4] Verifying all 10 protected filenames detected simultaneously...');
  const allEnvDir = createIsolatedTempDir();
  try {
    for (const filename of EXPECTED_PROTECTED_FILES) {
      fs.writeFileSync(path.join(allEnvDir, filename), `SECRET_${filename}=DO_NOT_EXPOSE_BATCH_VALUE\n`, 'utf8');
    }

    const cliResult = spawnSync(process.execPath, [GUARD_SCRIPT_PATH], {
      cwd: allEnvDir,
      encoding: 'utf8',
    });
    const combinedOutput = `${cliResult.stdout || ''}\n${cliResult.stderr || ''}`;
    assert.notStrictEqual(cliResult.status, 0);
    for (const filename of EXPECTED_PROTECTED_FILES) {
      assert.ok(combinedOutput.includes(filename), `Expected detected filename ${filename}`);
    }
    assert.ok(!combinedOutput.includes('DO_NOT_EXPOSE_BATCH_VALUE'));
    console.log('✓ All 10 recognized dotenv filenames detected simultaneously with zero content exposure.');
  } finally {
    fs.rmSync(allEnvDir, { recursive: true, force: true });
  }

  // -----------------------------------------------------------
  // Test 5: Verify package.json build, build:worker, deploy:dry-run, and deploy hooks
  // -----------------------------------------------------------
  console.log('\n[Test 5] Verifying package.json production build/deploy guard integration...');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const requiredPrefix = 'node scripts/guard-production-build.js &&';
  for (const scriptName of ['build', 'build:worker', 'deploy:dry-run', 'deploy']) {
    const scriptCmd: string | undefined = pkgJson.scripts?.[scriptName];
    assert.ok(
      typeof scriptCmd === 'string' && scriptCmd.startsWith(requiredPrefix),
      `Expected package.json script "${scriptName}" to start with "${requiredPrefix}", got: ${scriptCmd}`
    );
  }
  console.log('✓ package.json integrates environment guard into build, build:worker, deploy:dry-run, and deploy.');

  console.log('\n====================================================');
  console.log('ALL 5 PRODUCTION BUILD GUARD TESTS PASSED (100% OK)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Guard test suite failed:', err);
  process.exit(1);
});
