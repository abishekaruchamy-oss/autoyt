const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targets = ['.next', 'out', 'tests/fixtures', '.turbo', '.open-next'];

for (const target of targets) {
  const fullPath = path.join(__dirname, '..', target);
  if (fs.existsSync(fullPath)) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 3 });
      console.log(`[Clean] Purged ${target}`);
    } catch {
      // Fallback on Windows if file is locked by OneDrive / background sync
      if (process.platform === 'win32') {
        try {
          execSync(`powershell -Command "Remove-Item -Recurse -Force '${fullPath}' -ErrorAction SilentlyContinue"`, { stdio: 'ignore' });
          console.log(`[Clean] Purged ${target} via PowerShell fallback`);
        } catch {
          console.warn(`[Clean] Notice: ${target} is locked by background process.`);
        }
      }
    }
  }
}
console.log('[Clean] Minimum SSD cleanup complete.');
