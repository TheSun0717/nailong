const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const file = process.argv[2];
  const out = process.argv[3] || path.join(process.cwd(), 'shot.png');
  const W = Number(process.argv[4]) || 1100;
  const H = Number(process.argv[5]) || 820;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const win = new BrowserWindow({
      width: W, height: H, show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await win.loadFile(file);
    await wait(1400);
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    console.log('shot ->', out);
  } catch (e) {
    console.error('shot failed:', e.message);
    process.exitCode = 1;
  }
  app.quit();
});
