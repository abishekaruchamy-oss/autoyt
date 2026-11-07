import https from 'https';

async function inspectHtml(urlStr: string) {
  return new Promise((resolve) => {
    https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          console.log('--- HTML Inspection for', urlStr, '---');
          // Look for meta tags
          const metaMatches = body.match(/<meta[^>]+>/gi) || [];
          console.log(`Found ${metaMatches.length} meta tags:`);
          metaMatches.forEach((m) => {
            if (m.includes('og:') || m.includes('description') || m.includes('title') || m.includes('robots')) {
              console.log(' ', m);
            }
          });

          // Look for script tags with JSON or data
          const scriptMatches = body.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis) || [];
          console.log(`Found ${scriptMatches.length} ld+json script tags.`);
          scriptMatches.forEach((s) => console.log(' ld+json content:', s.substring(0, 300)));

          // Look for sharedData or require blocks
          const sharedData = body.match(/_sharedData\s*=\s*({.*?});<\/script>/);
          console.log('sharedData present:', !!sharedData);

          // Check if page contains login requirement text
          const hasLoginText = body.includes('Log In') || body.includes('login');
          console.log('Has "login" text:', hasLoginText);

          resolve(true);
        });
      }
    );
  });
}

inspectHtml('https://www.instagram.com/nasa/');
