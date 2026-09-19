const OPERATIONS = Object.freeze({
  list: 'cmd.web-apps.v1.list',
  create: 'cmd.web-apps.v1.create',
  eligibility: 'cmd.web-apps.v1.creation-eligibility',
  send: 'cmd.web-apps.v1.conversation.send',
  approve: 'cmd.web-apps.v1.conversation.approve',
  answer: 'cmd.web-apps.v1.conversation.answer',
  stopRun: 'cmd.web-apps.v1.run.stop',
  startServices: 'cmd.web-apps.v1.services.start',
  stopServices: 'cmd.web-apps.v1.services.stop',
  logs: 'cmd.web-apps.v1.services.logs',
  preview: 'cmd.web-apps.v1.preview.resolve',
  previewNavigate: 'cmd.web-apps.v1.preview.navigate',
  previewExternal: 'cmd.web-apps.v1.preview.open-external',
})

function node(document, tag, className, text) {
  const value = document.createElement(tag)
  if (className) value.className = className
  if (text != null) value.textContent = text
  return value
}

function button(document, label, className = 'wa-button wa-button--quiet') {
  const value = node(document, 'button', className, label)
  value.type = 'button'
  return value
}

function operationError(error) {
  return error instanceof Error ? error.message : 'The host did not complete this request.'
}

function contextFrom(host) {
  const location = host.location()
  return {
    projectId: location.params?.projectId ?? '',
    checkoutId: location.params?.checkoutId ?? '',
    directory: location.params?.directory ?? '',
  }
}

function createGettingStarted(document) {
  const empty = node(document, 'section', 'wa-empty')
  empty.setAttribute('aria-labelledby', 'wa-empty-title')
  const mark = node(document, 'div', 'wa-empty__mark', '{}')
  mark.setAttribute('aria-hidden', 'true')
  const title = node(document, 'h2', '', 'Create your first web app')
  title.id = 'wa-empty-title'
  empty.append(mark, title)
  empty.append(node(document, 'p', '', 'A web app starts with a .bytedesk-webapp.json marker in its application root.'))
  const steps = node(document, 'ol', 'wa-steps')
  for (const copy of [
    'Open Files and choose the directory that should become the app root.',
    'Choose Create Web App and describe what you want to build.',
    'Review the plan in Chat. Generation starts only after you approve it.',
  ]) steps.append(node(document, 'li', '', copy))
  empty.append(steps)
  return empty
}

function createWizard(document, host, root, announce) {
  const form = node(document, 'form', 'wa-wizard')
  form.setAttribute('aria-labelledby', 'wa-wizard-title')
  form.append(node(document, 'p', 'wa-kicker', 'Selected directory becomes the application root'))
  const title = node(document, 'h1', '', 'Create Web App')
  title.id = 'wa-wizard-title'
  form.append(title, node(document, 'p', 'wa-muted', 'Existing files stay in place. Gateway adds the marker and opens a planning conversation.'))
  const fields = [
    ['name', 'Name', 'Customer Portal', true],
    ['description', 'Initial description', 'What should this application help people do?', true],
    ['stackHint', 'Stack preference (optional)', 'For example: React with a .NET API', false],
  ]
  for (const [name, label, placeholder, required] of fields) {
    const group = node(document, 'label', 'wa-field')
    group.append(node(document, 'span', '', label))
    const control = name === 'description' ? node(document, 'textarea', '') : node(document, 'input', '')
    control.name = name
    control.placeholder = placeholder
    control.required = required
    if (name === 'description') control.rows = 4
    group.append(control)
    form.append(group)
  }
  const references = node(document, 'label', 'wa-field')
  references.append(node(document, 'span', '', 'Reference files (optional)'))
  const files = node(document, 'input', '')
  files.type = 'file'
  files.name = 'references'
  files.multiple = true
  references.append(files, node(document, 'small', '', 'Copies are stored under .bytedesk-webapp/references/.'))
  form.append(references)
  const actions = node(document, 'div', 'wa-wizard__actions')
  const cancel = button(document, 'Cancel')
  const submit = button(document, 'Save and open planning chat', 'wa-button wa-button--primary')
  submit.type = 'submit'
  actions.append(cancel, submit)
  form.append(actions)
  cancel.addEventListener('click', () => {
    const projectId = contextFrom(host).projectId
    host.navigate(projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects')
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    submit.disabled = true
    announce('Checking the selected directory…')
    try {
      const payload = Object.fromEntries(new FormData(form).entries())
      payload.references = [...files.files].map(file => ({ name: file.name, size: file.size, type: file.type }))
      const context = contextFrom(host)
      await host.request(OPERATIONS.eligibility, context)
      const created = await host.request(OPERATIONS.create, { ...context, ...payload })
      announce('Web app created. Opening planning chat.')
      host.navigate(created?.href ?? `/projects/${encodeURIComponent(context.projectId)}/web-apps`)
    } catch (error) {
      announce(operationError(error), true)
      submit.disabled = false
    }
  })
  root.replaceChildren(form)
}

function renderConversation(document, app, host, announce) {
  const pane = node(document, 'section', 'wa-pane wa-chat')
  pane.dataset.pane = 'chat'
  const header = node(document, 'header', 'wa-pane__header')
  const heading = node(document, 'div', '')
  heading.append(node(document, 'h2', '', 'Chat'), node(document, 'p', 'wa-muted', app.run?.active ? 'Agent working in this app and checkout' : 'Plan and build with an agent'))
  const mode = node(document, 'div', 'wa-segment')
  mode.setAttribute('aria-label', 'Conversation mode')
  const plan = button(document, 'Plan', 'wa-segment__item is-active')
  const build = button(document, 'Build', 'wa-segment__item')
  mode.append(plan, build)
  header.append(heading, mode)
  pane.append(header)
  const stream = node(document, 'div', 'wa-stream')
  stream.setAttribute('aria-label', 'Conversation history')
  const messages = app.messages?.length ? app.messages : [{ role: 'assistant', content: app.description || 'Describe what you want to build. I will prepare a plan for approval.' }]
  for (const message of messages) {
    const article = node(document, 'article', `wa-message wa-message--${message.role === 'user' ? 'user' : 'agent'}`)
    article.append(node(document, 'span', 'wa-message__role', message.role === 'user' ? 'You' : 'Agent'))
    article.append(node(document, 'p', '', message.content))
    if (message.kind === 'approval' && message.pending) {
      const actions = node(document, 'div', 'wa-card-actions')
      const decline = button(document, 'Decline')
      const approve = button(document, 'Approve', 'wa-button wa-button--primary')
      const decide = async approved => {
        decline.disabled = true
        approve.disabled = true
        try { await host.request(OPERATIONS.approve, { appId: app.id, requestId: message.id, approved }); announce(approved ? 'Approved.' : 'Declined.') }
        catch (error) { announce(operationError(error), true); decline.disabled = false; approve.disabled = false }
      }
      decline.addEventListener('click', () => void decide(false))
      approve.addEventListener('click', () => void decide(true))
      actions.append(decline, approve)
      article.append(actions)
    }
    if (message.kind === 'question' && message.pending) {
      const answer = node(document, 'form', 'wa-inline-answer')
      const field = node(document, 'input', '')
      field.setAttribute('aria-label', 'Answer')
      const submit = button(document, 'Answer', 'wa-button wa-button--primary')
      submit.type = 'submit'
      answer.append(field, submit)
      answer.addEventListener('submit', async event => {
        event.preventDefault()
        if (!field.value.trim()) return
        submit.disabled = true
        try { await host.request(OPERATIONS.answer, { appId: app.id, requestId: message.id, answer: field.value.trim() }); announce('Answer sent.') }
        catch (error) { announce(operationError(error), true); submit.disabled = false }
      })
      article.append(answer)
    }
    stream.append(article)
  }
  if (app.run?.activity) {
    const activity = node(document, 'div', 'wa-activity')
    activity.append(node(document, 'span', 'wa-status wa-status--active', 'Working'), node(document, 'span', '', app.run.activity))
    stream.append(activity)
  }
  pane.append(stream)
  const composer = node(document, 'form', 'wa-composer')
  const input = node(document, 'textarea', '')
  input.rows = 3
  input.placeholder = app.run?.active ? 'Queue a message or steer the current run…' : 'Ask for a plan or the next change…'
  input.setAttribute('aria-label', 'Message')
  const controls = node(document, 'div', 'wa-composer__controls')
  const attach = button(document, 'Attach')
  const attachmentInput = node(document, 'input', 'wa-visually-hidden')
  attachmentInput.type = 'file'
  attachmentInput.multiple = true
  attachmentInput.setAttribute('aria-label', 'Choose attachments')
  attach.addEventListener('click', () => attachmentInput.click())
  const provider = node(document, 'select', 'wa-provider')
  provider.setAttribute('aria-label', 'Agent provider')
  for (const item of app.providers ?? [{ id: 'auto', label: 'Available provider' }]) {
    const option = node(document, 'option', '', item.label)
    option.value = item.id
    option.selected = item.id === app.providerId
    provider.append(option)
  }
  const effort = node(document, 'select', 'wa-provider')
  effort.setAttribute('aria-label', 'Reasoning effort')
  for (const value of app.effortOptions ?? ['default']) {
    const option = node(document, 'option', '', value === 'default' ? 'Default effort' : value)
    option.value = value
    effort.append(option)
  }
  const stop = button(document, 'Stop', 'wa-button wa-button--danger')
  stop.hidden = !app.run?.active
  const send = button(document, app.run?.active ? 'Queue message' : 'Send', 'wa-button wa-button--primary')
  send.type = 'submit'
  controls.append(attach, attachmentInput, provider, effort, stop, send)
  composer.append(input, controls)
  composer.addEventListener('submit', async event => {
    event.preventDefault()
    const content = input.value.trim()
    if (!content) return
    send.disabled = true
    try {
      await host.request(OPERATIONS.send, {
        appId: app.id, content,
        mode: plan.classList.contains('is-active') ? 'plan' : 'build',
        providerId: provider.value,
        effort: effort.value,
        attachments: [...attachmentInput.files].map(file => ({ name: file.name, size: file.size, type: file.type })),
      })
      input.value = ''
      announce(app.run?.active ? 'Message queued.' : 'Message sent.')
    } catch (error) { announce(operationError(error), true) }
    finally { send.disabled = false }
  })
  stop.addEventListener('click', async () => {
    stop.disabled = true
    try { await host.request(OPERATIONS.stopRun, { appId: app.id, runId: app.run?.id }); announce('Agent run stopped.') }
    catch (error) { announce(operationError(error), true); stop.disabled = false }
  })
  plan.addEventListener('click', () => { plan.classList.add('is-active'); build.classList.remove('is-active') })
  build.addEventListener('click', () => { build.classList.add('is-active'); plan.classList.remove('is-active') })
  pane.append(composer)
  return pane
}

function renderPreview(document, app, host, announce) {
  const pane = node(document, 'section', 'wa-pane wa-preview')
  pane.dataset.pane = 'preview'
  const header = node(document, 'header', 'wa-pane__header wa-preview__header')
  const nav = node(document, 'div', 'wa-preview__nav')
  const address = node(document, 'input', 'wa-address')
  address.readOnly = true
  address.value = app.preview?.url ?? 'Preview unavailable'
  address.setAttribute('aria-label', 'Preview address')
  const back = button(document, 'Back')
  const forward = button(document, 'Forward')
  const refresh = button(document, 'Refresh')
  nav.append(back, forward, refresh, address)
  const tools = node(document, 'div', 'wa-preview__tools')
  const desktop = button(document, 'Desktop')
  const tablet = button(document, 'Tablet')
  const mobile = button(document, 'Mobile')
  const zoom = button(document, '100%')
  const fullscreen = button(document, 'Fullscreen')
  const external = button(document, 'Open')
  tools.append(desktop, tablet, mobile, zoom, fullscreen, external)
  tools.append(node(document, 'span', 'wa-inspection', app.preview?.inspectionSupported ? 'Agent inspection available' : 'Agent inspection unsupported'))
  header.append(nav, tools)
  pane.append(header)
  const stage = node(document, 'div', 'wa-preview__stage')
  let frame = null
  if (app.preview?.url && app.services?.some(service => service.status === 'running')) {
    frame = node(document, 'iframe', 'wa-preview__frame')
    frame.title = `${app.name} preview`
    frame.src = app.preview.url
    stage.append(frame)
  } else {
    const state = node(document, 'div', 'wa-preview-state')
    state.append(node(document, 'h2', '', app.services?.length ? 'Preview is stopped' : 'Preview is not configured'))
    state.append(node(document, 'p', 'wa-muted', app.services?.length ? 'Start the application services to open the preview.' : 'Finish the plan so the app can declare a preview service.'))
    if (app.services?.length) {
      const start = button(document, 'Start services', 'wa-button wa-button--primary')
      start.addEventListener('click', async () => {
        start.disabled = true
        try { await host.request(OPERATIONS.startServices, { appId: app.id }); announce('Services are starting.') }
        catch (error) { announce(operationError(error), true); start.disabled = false }
      })
      state.append(start)
    }
    stage.append(state)
  }
  const navigatePreview = async direction => {
    try { await host.request(OPERATIONS.previewNavigate, { appId: app.id, direction }) }
    catch (error) { announce(operationError(error), true) }
  }
  back.addEventListener('click', () => void navigatePreview('back'))
  forward.addEventListener('click', () => void navigatePreview('forward'))
  refresh.addEventListener('click', () => {
    if (frame) frame.src = frame.src
    else void navigatePreview('refresh')
  })
  const setWidth = width => {
    if (!frame) return
    frame.dataset.width = width
  }
  desktop.addEventListener('click', () => setWidth('desktop'))
  tablet.addEventListener('click', () => setWidth('tablet'))
  mobile.addEventListener('click', () => setWidth('mobile'))
  const zoomLevels = [100, 80, 60]
  let zoomIndex = 0
  zoom.addEventListener('click', () => {
    if (!frame) return
    zoomIndex = (zoomIndex + 1) % zoomLevels.length
    const level = zoomLevels[zoomIndex]
    frame.style.setProperty('--wa-preview-zoom', String(level / 100))
    zoom.textContent = `${level}%`
  })
  fullscreen.addEventListener('click', async () => {
    try { await stage.requestFullscreen() }
    catch (error) { announce(operationError(error), true) }
  })
  external.addEventListener('click', async () => {
    try { await host.request(OPERATIONS.previewExternal, { appId: app.id }); announce('Opened preview in a new window.') }
    catch (error) { announce(operationError(error), true) }
  })
  pane.append(stage)
  const serviceBar = node(document, 'footer', 'wa-services')
  const services = node(document, 'div', 'wa-services__list')
  for (const service of app.services ?? []) services.append(node(document, 'span', 'wa-service', `${service.id} · ${service.status}${service.port ? ` · ${service.port}` : ''}`))
  if (!app.services?.length) services.append(node(document, 'span', 'wa-muted', 'No services configured'))
  const serviceActions = node(document, 'div', '')
  const logs = button(document, 'Logs')
  const stop = button(document, 'Stop services', 'wa-button wa-button--danger')
  stop.disabled = !(app.services ?? []).some(service => service.status === 'running' || service.status === 'starting')
  serviceActions.append(logs, stop)
  logs.addEventListener('click', async () => {
    try { await host.request(OPERATIONS.logs, { appId: app.id }); announce('Opened service logs.') }
    catch (error) { announce(operationError(error), true) }
  })
  stop.addEventListener('click', async () => {
    stop.disabled = true
    try { await host.request(OPERATIONS.stopServices, { appId: app.id }); announce('Services stopped.') }
    catch (error) { announce(operationError(error), true); stop.disabled = false }
  })
  serviceBar.append(services, serviceActions)
  pane.append(serviceBar)
  return pane
}

function createWorkspace(document, host, root, announce, data) {
  const shell = node(document, 'section', 'wa-shell')
  const toolbar = node(document, 'header', 'wa-toolbar')
  const identity = node(document, 'div', 'wa-toolbar__identity')
  identity.append(node(document, 'h1', '', 'Web Apps'), node(document, 'p', 'wa-muted', data.checkoutLabel ?? 'Active project checkout'))
  const pickerLabel = node(document, 'label', 'wa-picker')
  pickerLabel.append(node(document, 'span', '', 'Application'))
  const picker = node(document, 'select', '')
  for (const app of data.apps ?? []) {
    const option = node(document, 'option', '', app.name)
    option.value = app.id
    option.selected = app.id === data.selectedAppId
    picker.append(option)
  }
  pickerLabel.append(picker)
  const activity = node(document, 'div', 'wa-toolbar__activity')
  const background = (data.apps ?? []).filter(app => app.run?.active || app.services?.some(service => service.status === 'running')).length
  if (background) activity.append(node(document, 'span', 'wa-status wa-status--active', `${background} active`))
  toolbar.append(identity, pickerLabel, activity)
  shell.append(toolbar)
  if (!data.apps?.length) {
    shell.append(createGettingStarted(document))
    root.replaceChildren(shell)
    return
  }
  const selected = data.apps.find(app => app.id === data.selectedAppId) ?? data.apps[0]
  const mobileNav = node(document, 'nav', 'wa-mobile-nav')
  mobileNav.setAttribute('aria-label', 'Workspace pane')
  const chatTab = button(document, 'Chat', 'wa-mobile-nav__item is-active')
  const previewTab = button(document, 'Preview', 'wa-mobile-nav__item')
  mobileNav.append(chatTab, previewTab)
  shell.append(mobileNav)
  const split = node(document, 'div', 'wa-split')
  const chat = renderConversation(document, selected, host, announce)
  const divider = node(document, 'div', 'wa-divider')
  divider.setAttribute('role', 'separator')
  divider.setAttribute('aria-orientation', 'vertical')
  divider.tabIndex = 0
  const preview = renderPreview(document, selected, host, announce)
  split.append(chat, divider, preview)
  shell.append(split)
  picker.addEventListener('change', () => host.navigate(`?app=${encodeURIComponent(picker.value)}`))
  const showPane = name => {
    shell.dataset.mobilePane = name
    chatTab.classList.toggle('is-active', name === 'chat')
    previewTab.classList.toggle('is-active', name === 'preview')
  }
  chatTab.addEventListener('click', () => showPane('chat'))
  previewTab.addEventListener('click', () => showPane('preview'))
  showPane('chat')
  let startX = 0
  let startWidth = 0
  divider.addEventListener('pointerdown', event => {
    startX = event.clientX
    startWidth = chat.getBoundingClientRect().width
    divider.setPointerCapture(event.pointerId)
  })
  divider.addEventListener('pointermove', event => {
    if (!divider.hasPointerCapture(event.pointerId)) return
    const total = split.getBoundingClientRect().width
    const next = Math.max(320, Math.min(total - 360, startWidth + event.clientX - startX))
    split.style.setProperty('--wa-chat-width', `${next}px`)
  })
  root.replaceChildren(shell)
}

/** @type {import('@bytedesk/gateway-plugin-ui').PluginUIModule['mount']} */
export function mount(element, host) {
  if (host.signal.aborted) return () => {}
  const document = element.ownerDocument
  const root = node(document, 'div', 'wa-root')
  root.dataset.bdProduct = 'gateway'
  const status = node(document, 'div', 'wa-live')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const announce = (message, error = false) => {
    status.textContent = message
    status.dataset.error = error ? 'true' : 'false'
  }
  const style = node(document, 'link', '')
  style.rel = 'stylesheet'
  style.href = '/p/web-apps/assets/styles.css'
  style.dataset.webAppsStyles = host.identity.generation
  document.head.append(style)
  element.replaceChildren(root, status)
  let disposed = false
  let unsubscribe = () => {}
  const render = async () => {
    const location = host.location()
    if (location.pathname.endsWith('/create') || location.params?.panel === 'create-web-app') {
      createWizard(document, host, root, announce)
      return
    }
    root.replaceChildren(node(document, 'p', 'wa-loading', 'Discovering web apps…'))
    try {
      const data = await host.request(OPERATIONS.list, { ...contextFrom(host), selectedAppId: new URLSearchParams(location.search).get('app') ?? '' })
      if (!disposed && !host.signal.aborted) createWorkspace(document, host, root, announce, data ?? { apps: [] })
    } catch (error) {
      if (disposed || host.signal.aborted) return
      const failure = node(document, 'section', 'wa-error')
      failure.append(node(document, 'h1', '', 'Web Apps could not load'), node(document, 'p', '', operationError(error)))
      root.replaceChildren(failure)
    }
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    host.signal.removeEventListener('abort', cleanup)
    try { unsubscribe() } finally { style.remove(); element.replaceChildren() }
  }
  try {
    unsubscribe = host.subscribe('host.location', () => void render())
    host.signal.addEventListener('abort', cleanup, { once: true })
    void render()
    if (host.signal.aborted) cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
  return cleanup
}

export { OPERATIONS }
