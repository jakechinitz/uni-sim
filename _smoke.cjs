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
  await new Promise(r => setTimeout(r, 2000));
  if (err) console.error('PAGE ERROR:', err);
  // Hover over the time slider to check tooltip
  await page.mouse.move(360, 660);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: '/tmp/sm-tip.png' });
  console.log('boot ok');
  await browser.close();
})();
