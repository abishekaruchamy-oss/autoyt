import https from 'https';

async function checkReelEmbed(code: string) {
  const url = `https://www.instagram.com/p/${code}/embed/captioned/`;
  console.log('Checking embed URL:', url);
  return new Promise((resolve) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          console.log('Status:', res.statusCode);
          console.log('Body length:', body.length);
          const titleMatch = body.match(/<title>(.*?)<\/title>/i);
          console.log('Title:', titleMatch ? titleMatch[1] : 'None');
          const videoMatch = body.match(/video_url["']?\s*:\s*["']([^"']+)["']/);
          console.log('Has video_url:', !!videoMatch);
          const captionMatch = body.match(/class=["']Caption["'][^>]*>(.*?)<\/div>/is);
          console.log('Has Caption class:', !!captionMatch);
          resolve(true);
        });
      }
    );
  });
}

// Check with a known public post ID (e.g., from Instagram official or NASA)
checkReelEmbed('C8xQ9yKm3Z0');
checkReelEmbed('Cw847K_r2r4');
