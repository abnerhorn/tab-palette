#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const help = `Render a deterministic local UI film; no server is started.
Required: --input index.html --output capture-directory
Options: --frames (default: stills only), --stills 1000,3000, --api caseMotion
         --density 3 --fps 30 --width 1080 --height 588 --duration-ms 1000
         --playwright-module PATH --browser PATH --forbidden JSON_ARRAY_FILE
Runtime alternatives: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE.
The page must expose caseMotion/hero/movie.duration and renderAt(milliseconds).`;
const values = new Set(['input','output','stills','api','density','fps','width','height','duration-ms','playwright-module','browser','forbidden']);
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'help') { console.log(help); process.exit(0); }
  if (key === 'frames') { options.frames = true; continue; }
  if (!values.has(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${process.argv[i]}\n${help}`);
  options[key] = process.argv[++i];
}
if (!options.input || !options.output) throw new Error(help);
const width = Number(options.width || 1080), height = Number(options.height || 588);
const density = Number(options.density || 3), fps = Number(options.fps || 30);
for (const [name,value] of Object.entries({width,height,density,fps})) if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
if ((width*density)%2 || (height*density)%2) throw new Error('Export dimensions must be even for yuv420p.');
const input = path.resolve(options.input), output = path.resolve(options.output);
await fs.access(input); await fs.mkdir(output, { recursive: true });
const frameDir = path.join(output, 'frames');
if (options.frames && (await fs.readdir(frameDir).catch(() => [])).length) throw new Error('Use a fresh output directory; existing frames could contaminate capture.');
const spec = options['playwright-module'] || process.env.PLAYWRIGHT_MODULE || 'playwright';
let runtime;
try { runtime = await import(spec); } catch { runtime = require(spec); }
const { chromium } = runtime.default || runtime;
if (!chromium) throw new Error('The provided Playwright module has no chromium runtime.');
const executablePath = options.browser || process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--allow-file-access-from-files'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: density, reducedMotion: 'no-preference' });
  const errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => { remote.push(route.request().url()); return route.abort(); });
  const url = pathToFileURL(input); url.searchParams.set('manual', '');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  const api = await page.evaluate(preferred => [preferred, 'caseMotion', 'hero', 'movie'].filter(Boolean).find(key => typeof window[key]?.renderAt === 'function'), options.api);
  if (!api) throw new Error('No deterministic renderAt API found.');
  const sourceDuration = await page.evaluate(key => window[key].duration, api);
  const durationMs = Number(options['duration-ms'] || sourceDuration);
  if (!(durationMs > 0) || !Number.isFinite(durationMs) || durationMs > sourceDuration) throw new Error('Duration must be positive and no longer than the source film.');
  const frameCount = Math.round(durationMs / 1000 * fps);
  if (frameCount < 1) throw new Error('Duration is shorter than one frame.');
  const stage = await page.locator('#stage').evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), background: getComputedStyle(element).backgroundColor }));
  if (Math.abs(stage.rect.x) > .1 || Math.abs(stage.rect.y) > .1 || Math.abs(stage.rect.width-width) > .1 || Math.abs(stage.rect.height-height) > .1) throw new Error('Stage must fill the requested viewport at origin 0,0.');
  if (options.forbidden) {
    const forbidden = JSON.parse(await fs.readFile(options.forbidden, 'utf8'));
    if (!Array.isArray(forbidden) || forbidden.some(value => typeof value !== 'string' || !value)) throw new Error('Forbidden file must be a JSON array of nonempty strings.');
    const hits = await page.evaluate(list => {
      const text = document.body.textContent + ' ' + [...document.querySelectorAll('*')].flatMap(element => [...element.attributes].map(attribute => attribute.value)).join(' ') + ' ' + [...document.querySelectorAll('input,textarea')].map(element => element.value).join(' ');
      return list.filter(value => text.toLowerCase().includes(value.toLowerCase()));
    }, forbidden);
    if (hits.length) throw new Error(`Source privacy guard failed for ${hits.length} forbidden strings. Review source before capturing.`);
  }
  const draw = async ms => { await page.evaluate(({api,ms}) => window[api].renderAt(ms), {api,ms}); };
  // Seeking must reset state, rather than depend on the last captured frame.
  const checkAt = Math.min(durationMs-1, durationMs*.61);
  await draw(checkAt); const first = await page.screenshot(); await draw(0); await draw(checkAt);
  if (!first.equals(await page.screenshot())) throw new Error('Repeated seek produced different pixels. Remove time-dependent state/transitions.');
  const stills = options.stills ? options.stills.split(',').map(Number) : [0,.25,.5,.75].map(fraction => Math.floor(durationMs*fraction));
  await fs.mkdir(path.join(output,'stills'), { recursive: true });
  for (const ms of stills) {
    if (!(ms >= 0 && ms < durationMs)) throw new Error(`Still time ${ms} is outside the film.`);
    await draw(ms); await page.screenshot({ path: path.join(output,'stills',`${String(Math.round(ms)).padStart(5,'0')}.png`) });
  }
  if (options.frames) {
    await fs.mkdir(frameDir, { recursive: true });
    for (let frame=0;frame<frameCount;frame++) {
      await draw(frame*1000/fps);
      await page.screenshot({ path: path.join(frameDir,`${String(frame).padStart(5,'0')}.png`) });
      if (frame%90===0) console.log(`Frame ${frame}/${frameCount}`);
    }
  }
  if (errors.length || remote.length) throw new Error(`Capture failed: ${JSON.stringify({errors,remote})}`);
  const metadata = { version:1, input, api, width, height, density, exportWidth:width*density, exportHeight:height*density, fps, durationMs, frameCount, capturedFrames:options.frames?frameCount:0, stills, stage, deterministicSeek:true, remoteResources:0, pageErrors:0 };
  await fs.writeFile(path.join(output,'capture.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log(`Saved ${options.frames?frameCount+' frames':'stills'} at ${width*density}×${height*density}; browser closing.`);
} finally { await browser.close(); }
