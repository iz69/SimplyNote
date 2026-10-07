// API responses are synthetic; no deployed API or note data is used.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const home = process.env.SIMPLYNOTE_TEST_UI_URL;
const configuredApi = process.env.SIMPLYNOTE_TEST_API_BASE_PATH;
assert.ok(home && configuredApi, 'set the UI URL and API base for browser tests');
const browser = process.env.BROWSER_CDP_URL
  ? await chromium.connectOverCDP(process.env.BROWSER_CDP_URL)
  : await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,
    args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});

async function checkLogin(savedApi) {
  const context = await browser.newContext({locale:'ja-JP'});
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  const api = new URL(savedApi || configuredApi, home);
  const prefix = api.pathname.replace(/\/+$/, '');
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (savedApi) await page.addInitScript(value => {
      localStorage.setItem('api_base_url', value);
    }, savedApi);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === api.origin && url.pathname === prefix + '/auth/token') {
        requests.push(url.pathname);
        return route.fulfill({contentType:'application/json',body:JSON.stringify({
          access_token:'synthetic-token',refresh_token:'synthetic-refresh',
        })});
      }
      if (url.origin === api.origin && [prefix+'/notes',prefix+'/tags'].includes(url.pathname)) {
        requests.push(url.pathname);
        return route.fulfill({contentType:'application/json',body:'[]'});
      }
      if (url.origin !== new URL(home).origin) return route.abort();
      return route.continue();
    });
    await page.goto(home + 'login/');
    await page.getByPlaceholder('ユーザー名',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => document.baseURI), home);
    assert.equal(await page.locator('input[type=text]').first().inputValue(), savedApi || configuredApi);
    assert.equal(await page.getByText('Google Drive接続',{exact:true}).count(), 0);
    await page.reload();
    await page.getByPlaceholder('ユーザー名',{exact:true}).fill('synthetic-user');
    await page.getByPlaceholder('パスワード',{exact:true}).fill('synthetic-password');
    const notesLoaded = page.waitForResponse(response => response.url() === api.origin + prefix + '/notes');
    await page.getByRole('button',{name:'ログイン',exact:true}).click();
    await page.waitForURL(home);
    await notesLoaded;
    await page.waitForFunction(() => localStorage.getItem('token') === 'synthetic-token');
    await page.waitForFunction(() => document.querySelector('input') !== null);
    assert.ok(requests.includes(prefix + '/auth/token'));
    assert.ok(requests.includes(prefix + '/notes'));
    await page.goto(home + 'nested/route');
    await page.waitForFunction(() => document.querySelector('input') !== null);
    assert.equal(await page.evaluate(() => document.baseURI), home);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

try {
  await checkLogin();
  await checkLogin('/saved-api');
  console.log('PASS browser: login, reload, default and saved API, home and nested route');
} finally {
  await browser.close();
}
