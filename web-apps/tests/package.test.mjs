import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('internal Claude plugin metadata stays versionless', async () => {
  const manifest = JSON.parse(await read('../.claude-plugin/plugin.json'))
  assert.equal(manifest.name, 'web-apps')
  assert.equal(Object.hasOwn(manifest, 'version'), false)
})

test('Gateway package declares owner-local Projects contributions', async () => {
  const manifest = JSON.parse(await read('../plugin.json'))
  assert.deepEqual(manifest.projectViews, [{ id: 'web-apps', label: 'Web Apps', icon: 'globe', order: 30, panelId: 'web-apps' }])
  assert.deepEqual(manifest.directoryContextActions, [{ id: 'create-web-app', label: 'Create Web App', icon: 'globe', order: 40, wizardPanelId: 'create-web-app' }])
  const panels = new Set(manifest.panels.map(panel => panel.id))
  assert.ok(panels.has(manifest.projectViews[0].panelId))
  assert.ok(panels.has(manifest.directoryContextActions[0].wizardPanelId))
})

test('owner-local module contains the required workspace and creation states', async () => {
  const module = await read('../webappplugin/panel.mjs')
  for (const text of [
    '.bytedesk-webapp.json', 'Files', 'Create Web App', 'Plan', 'Build',
    'Queue message', 'Stop services', 'Preview is stopped', 'Reference files',
  ]) assert.match(module, new RegExp(text.replaceAll('.', '\\.')))
  assert.match(module, /host\.request\(OPERATIONS\.eligibility/)
  assert.match(module, /host\.signal\.addEventListener\('abort'/)
  assert.doesNotMatch(module, /child_process|exec\(|spawn\(|node:fs/)
})

test('responsive shell exposes one reachable pane at narrow widths', async () => {
  const css = await read('../webappplugin/styles.css')
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /data-mobile-pane="chat"/)
  assert.match(css, /data-mobile-pane="preview"/)
  assert.match(css, /prefers-reduced-motion/)
})

test('v1 marker schema matches the strict Gateway configuration shape', async () => {
  const schema = JSON.parse(await read('../schema/bytedesk-webapp.schema.json'))
  assert.deepEqual(schema.required, ['schemaVersion', 'id', 'name', 'description'])
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.schemaVersion.const, 1)
  assert.equal(schema.$defs.service.additionalProperties, false)
  assert.deepEqual(schema.$defs.service.required, ['id', 'run'])
  assert.equal(schema.$defs.service.properties.portHint.maximum, 65535)
  assert.equal(schema.$defs.readiness.properties.path.pattern, '^(?:$|/)')
  assert.equal(schema.$defs.readiness.properties.timeoutSeconds.minimum, 0)
  assert.equal(schema.$defs.readiness.properties.intervalMillis.minimum, 0)
  const placeholders = new RegExp(schema.$defs.commandArgument.pattern)
  for (const value of ['npm', '--port=${PORT}', 'http://127.0.0.1:${services.api.port}', '$HOME']) assert.ok(placeholders.test(value), value)
  for (const value of ['${PORT+1}', '${services.api.host}', '${UNKNOWN}', '${PORT']) assert.equal(placeholders.test(value), false, value)
})
