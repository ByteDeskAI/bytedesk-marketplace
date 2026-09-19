import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { chromium } = playwrightModule.default ?? playwrightModule
const moduleBytes = await readFile(new URL('../webappplugin/panel.mjs', import.meta.url))
const cssBytes = await readFile(new URL('../webappplugin/styles.css', import.meta.url))
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'")
  if (request.url === '/p/web-apps/assets/panel.mjs') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.end(moduleBytes)
    return
  }
  if (request.url === '/p/web-apps/assets/styles.css') {
    response.setHeader('Content-Type', 'text/css; charset=utf-8')
    response.end(cssBytes)
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="panel"></main></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(async () => {
    const { mount, OPERATIONS } = await import('/p/web-apps/assets/panel.mjs')
    const controller = new AbortController()
    let location = { pathname: '/projects/demo/web-apps', search: '', hash: '', params: { projectId: 'demo', checkoutId: 'main' } }
    let locationHandler
    let mode = 'empty'
    const calls = []
    const host = {
      identity: { generation: 'g1' }, signal: controller.signal,
      location: () => location,
      navigate: href => calls.push(['navigate', href]),
      subscribe(type, handler) { if (type === 'host.location') locationHandler = handler; return () => { locationHandler = null } },
      async request(operation, body) {
        calls.push([operation, body])
        if (operation === OPERATIONS.list) {
          if (mode === 'empty') return { checkoutLabel: 'main', apps: [] }
          return { checkoutLabel: 'main', selectedAppId: 'app-1', apps: [{ id: 'app-1', name: 'Demo', description: 'Demo app', providers: [{ id: 'codex', label: 'Codex' }], effortOptions: ['medium'], run: { active: true, id: 'run-1', activity: 'Editing the home page' }, services: [{ id: 'web', status: 'running', port: 5173 }], preview: { url: '/preview', inspectionSupported: false } }] }
        }
        return {}
      },
    }
    const element = document.getElementById('panel')
    const cleanup = mount(element, host)
    await new Promise(resolve => setTimeout(resolve, 20))
    const empty = element.textContent.includes('.bytedesk-webapp.json') && element.textContent.includes('Create Web App')
    mode = 'app'
    await locationHandler(location)
    await new Promise(resolve => setTimeout(resolve, 20))
    const app = element.querySelector('select')?.value === 'app-1' && element.textContent.includes('Stop services')
    element.querySelector('.wa-mobile-nav__item:nth-child(2)').click()
    const preview = element.querySelector('.wa-shell').dataset.mobilePane === 'preview'
    location = { pathname: '/projects/demo/web-apps/create', search: '', hash: '', params: { projectId: 'demo', checkoutId: 'main', directory: 'web' } }
    await locationHandler(location)
    await new Promise(resolve => setTimeout(resolve, 0))
    const wizard = element.querySelector('form')?.textContent.includes('Reference files')
    cleanup()
    return { empty, app, preview, wizard, withdrawn: element.childElementCount === 0, calls: calls.length }
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(result, { empty: true, app: true, preview: true, wizard: true, withdrawn: true, calls: 2 })
  console.log(JSON.stringify({ ...result, browser: await browser.version() }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
