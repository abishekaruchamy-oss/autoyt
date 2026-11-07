import https from 'https';

async function fetchUrl(urlStr: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; finalUrl: string }> {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
            finalUrl: res.headers.location || urlStr,
          });
        });
      }
    );
    req.on('error', (err) => {
      resolve({
        status: 0,
        headers: {},
        body: err.message,
        finalUrl: urlStr,
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        status: 408,
        headers: {},
        body: 'Timeout after 10000ms',
        finalUrl: urlStr,
      });
    });
  });
}

async function run() {
  console.log('--- Probing Public Instagram Endpoints (Standard Permitted GET) ---');

  const targets = [
    { name: 'Public Profile (instagram)', url: 'https://www.instagram.com/instagram/' },
    { name: 'Public Profile (nasa)', url: 'https://www.instagram.com/nasa/' },
    { name: 'Non-existent Profile', url: 'https://www.instagram.com/non_existent_profile_xyz_99812739/' },
    { name: 'Public Embed', url: 'https://www.instagram.com/p/C-public-test/embed/' },
  ];

  for (const t of targets) {
    console.log(`\nTesting: ${t.name} -> ${t.url}`);
    const res = await fetchUrl(t.url);
    console.log(`Status: ${res.status}`);
    console.log(`Redirect / Location: ${res.headers.location || 'None'}`);
    console.log(`Content-Type: ${res.headers['content-type']}`);
    console.log(`Body length: ${res.body.length}`);

    // Check for open graph tags or login redirect
    const isLoginRedirect = res.headers.location?.includes('/accounts/login/') || res.body.includes('/accounts/login/');
    console.log(`Login wall / redirect detected: ${isLoginRedirect}`);

    const ogTitleMatch = res.body.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["'](.*?)["']/i);
    const ogDescMatch = res.body.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["'](.*?)["']/i);
    const ogImageMatch = res.body.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["'](.*?)["']/i);

    if (ogTitleMatch) console.log(`og:title: ${ogTitleMatch[1]}`);
    if (ogDescMatch) console.log(`og:description: ${ogDescMatch[1]}`);
    if (ogImageMatch) console.log(`og:image: ${ogImageMatch[1].substring(0, 80)}...`);

    // Check title tag
    const titleMatch = res.body.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) console.log(`HTML Title: ${titleMatch[1]}`);
  }
}

run();
