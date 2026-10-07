// Verify multiple public paths with exactly the same compiled Docker image.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const image = process.env.SIMPLYNOTE_TEST_UI_IMAGE || 'simplynote-ui:distribution-test';
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const imageId = docker('image','inspect','--format','{{.Id}}',image);
const source = docker('run','--rm','--entrypoint','cat',image,'/opt/simplynote/dist/index.html');
assert.match(source, /<base href="\.\/"\s*\/?>/);
const digests = new Map();
const deployments = [
  ['/simplynote/','/simplynote-api'],
  ['/','/'],
  ['/tools/notes/','/tools/notes-api'],
  ['/login/','/custom-api'],
  ['/v1.0+notes/','/notes-api'],
  ['/ノート 管理/','https://api.example.test/notes-api'],
];
async function ready(url, container) {
  for (let i=0; i<100; i++) {
    try { if ((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok) return; } catch {}
    if(docker('inspect','--format','{{.State.Running}}',container)!=='true') {
      throw new Error(docker('logs',container));
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('UI did not start at '+url);
}
for (const [ui,api] of deployments) {
  const container = docker('run','-d','-p','127.0.0.1::5173',
    '-e','UI_BASE_PATH='+ui,'-e','API_BASE_PATH='+api,'-e','ENABLE_DRIVE=false',image);
  try {
    const port = docker('port',container,'5173/tcp').split(':').at(-1);
    const origin = 'http://127.0.0.1:'+port;
    const path = ui.split('/').map(encodeURIComponent).join('/');
    const home = origin+path;
    await ready(home,container);
    assert.equal(docker('inspect','--format','{{.Image}}',container),imageId);
    docker('exec',container,'nginx','-t');
    const response = await fetch(home);
    const document = await response.text();
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.ok(document.includes('<base href="'+path+'"'));
    assert.ok(document.indexOf('runtime-config.js')<document.indexOf('type="module"'));
    const configResponse = await fetch(new URL('runtime-config.js',home));
    assert.match(configResponse.headers.get('cache-control'),/no-store/);
    const config = JSON.parse((await configResponse.text()).replace(/^window\.__SIMPLYNOTE_CONFIG__ = /,'').trim().replace(/;$/,''));
    assert.deepEqual(config,{uiBasePath:path,apiBasePath:api==='/'?'':api});
    const settings = await fetch(new URL('config.json',home));
    assert.match(settings.headers.get('cache-control'),/no-store/);
    assert.deepEqual(await settings.json(),{enableApi:true,enableDrive:false});
    const assets = [...document.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(match=>match[1]);
    assert.ok(assets.length>=2);
    for (const asset of assets) {
      const result = await fetch(new URL(asset,home));
      assert.equal(result.status,200);
      assert.match(result.headers.get('cache-control'),/immutable/);
      const digest = createHash('sha256').update(Buffer.from(await result.arrayBuffer())).digest('hex');
      if (digests.has(asset)) assert.equal(digest,digests.get(asset));
      digests.set(asset,digest);
      assert.equal((await fetch(new URL(asset,origin+'/'))).status,200);
    }
    const icon = await fetch(new URL('favicon.png',home));
    assert.equal(icon.status,200);
    assert.match(icon.headers.get('content-type'),/image\/png/);
    assert.equal((await fetch(new URL('assets/missing.js',home))).status,404);
    assert.equal(await (await fetch(home+'login/')).text(),document);
    if(path!=='/') {
      const redirect = await fetch(origin+path.slice(0,-1)+'?test=1',{redirect:'manual'});
      assert.equal(redirect.status,308);
      assert.equal(redirect.headers.get('location'),path+'?test=1');
    }
    const browser = spawnSync(process.execPath,['tests/browserRegression.mjs'],{
      stdio:'inherit',env:{...process.env,SIMPLYNOTE_TEST_UI_URL:home,SIMPLYNOTE_TEST_API_BASE_PATH:api},
    });
    if(browser.error) throw browser.error;
    assert.equal(browser.status,0,'browser regression failed at '+ui);
    if(ui==='/tools/notes/') {
      docker('restart',container);
      const restartedPort=docker('port',container,'5173/tcp').split(':').at(-1);
      const restartedHome='http://127.0.0.1:'+restartedPort+path;
      await ready(restartedHome,container);
      assert.equal(await (await fetch(restartedHome)).text(),document);
    }
    console.log('PASS same image: UI='+ui+' API='+api);
  } finally {
    docker('rm','-f',container);
  }
}
const directory=mkdtempSync(join(tmpdir(),'simplynote-mounted-config-'));
let container;
try {
  const file=join(directory,'config.json');
  writeFileSync(file,JSON.stringify({enableApi:false,enableDrive:true}));
  container=docker('run','-d','-p','127.0.0.1::5173','-e','ENABLE_DRIVE=false',
    '-v',file+':/usr/share/nginx/html/config.json:ro',image);
  const port=docker('port',container,'5173/tcp').split(':').at(-1);
  const home='http://127.0.0.1:'+port+'/simplynote/';
  await ready(home,container);
  assert.deepEqual(await (await fetch(home+'config.json')).json(),{enableApi:false,enableDrive:true});
  writeFileSync(file,JSON.stringify({enableApi:true,enableDrive:false}));
  assert.deepEqual(await (await fetch(home+'config.json')).json(),{enableApi:true,enableDrive:false});
  console.log('PASS existing config.json mount and live feature updates');
} finally {
  if(container) docker('rm','-f',container);
  rmSync(directory,{recursive:true,force:true});
}
for (const environment of ['UI_BASE_PATH=//invalid','ENABLE_DRIVE=invalid']) {
  const invalid=spawnSync('docker',['run','--rm','-e',environment,image],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stdout+invalid.stderr,/SimplyNote UI configuration error/);
}
console.log('PASS identical image and JS/CSS across all deployments; invalid settings fail at startup');
