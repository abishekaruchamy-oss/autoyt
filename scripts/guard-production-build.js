/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AutoShorts Production Build & Deploy Environment Guard
 *
 * Prevents OpenNext (`@opennextjs/cloudflare`) and Next.js production builds
 * from reading and embedding local dotenv values into generated Worker defaults.
 *
 * Security invariant: Never read, parse, copy, or print the contents of any
 * detected dotenv file. Output detected filenames and developer guidance only.
 */

const fs = require('node:fs');
const path = require('node:path');

const RECOGNIZED_DOTENV_FILES = [
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
];

/**
 * Checks whether any recognized dotenv file exists in `targetDir`.
 * Only inspects path existence; never opens or reads file contents.
 *
 * @param {string} [targetDir]
 * @returns {string[]}
 */
function findDotenvFiles(targetDir = process.cwd()) {
  const detected = [];
  for (const filename of RECOGNIZED_DOTENV_FILES) {
    const candidate = path.join(targetDir, filename);
    try {
      fs.lstatSync(candidate);
      detected.push(filename);
    } catch {
      // File or symlink does not exist at candidate path
    }
  }
  return detected;
}

/**
 * Evaluates `targetDir` for prohibited dotenv files prior to production builds.
 * Never reads, copies, or displays file contents.
 *
 * @param {string} [targetDir]
 * @returns {{ ok: boolean, detectedFiles: string[], errorMessage: string | null }}
 */
function checkProductionBuildEnvironment(targetDir = process.cwd()) {
  const detectedFiles = findDotenvFiles(targetDir);
  if (detectedFiles.length === 0) {
    return {
      ok: true,
      detectedFiles: [],
      errorMessage: null,
    };
  }

  const lines = [
    '[Guard] Production build/deployment blocked: recognized dotenv file(s) detected:',
    ...detectedFiles.map((file) => `  - ${file}`),
    '',
    'OpenNext can serialize loaded dotenv values into generated Worker environment defaults.',
    'Move these dotenv file(s) manually outside the repository before running build, build:worker, or deploy.',
    'Configure production secrets exclusively with `wrangler secret put`.',
  ];

  return {
    ok: false,
    detectedFiles,
    errorMessage: lines.join('\n'),
  };
}

if (require.main === module) {
  const result = checkProductionBuildEnvironment(process.cwd());
  if (!result.ok) {
    console.error(result.errorMessage);
    process.exit(1);
  }
  console.log('[Guard] Clean environment verified: no recognized dotenv files present.');
}

module.exports = {
  RECOGNIZED_DOTENV_FILES,
  findDotenvFiles,
  checkProductionBuildEnvironment,
};
