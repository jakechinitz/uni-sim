const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-angle=swiftshader','--use-gl=swiftshader','--enable-webgl'],
    headless: 'new',
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  let err = null;
  page.on('pageerror', e => err = e.message);
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2500));
  if (err) console.error('PAGE ERROR:', err);
  console.log('ok');
  await browser.close();
})();
