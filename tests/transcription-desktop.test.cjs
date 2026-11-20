const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { setTimeout: wait } = require('node:timers/promises')

async function until(check, label, timeout = 16_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await check()
      if (last) return last
    } catch (error) { last = error.message }
    await wait(75)
  }
  assert.fail(label + ' · ' + String(last))
}

function session(ws) {
  const pending = new Map()
  const transcriptionScripts = new Set()
  let next = 0
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Debugger.scriptParsed' && /\/assets\/TranscriptionPage-.*\.js$/.test(message.params.url)) {
      transcriptionScripts.add(message.params.scriptId)
    }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  ws.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('调试窗口已关闭。'))
    pending.clear()
  })
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++next
    pending.set(id, { resolve: resolveCall, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const run = async (action, ...args) => {
    const expression = '(' + action.toString() + ')(...' + JSON.stringify(args) + ')'
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text)
    return answer.result.value
  }
  return { call, run, transcriptionScripts }
}

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { windowsHide: true })
const root = resolve(__dirname, '..')
const env = process.env

test('isolated Electron opens the subtitle workflow and saves a Canvas subtitle video', {
  skip: process.platform !== 'win32' || env.W3F7_CAPTION_DESKTOP !== '1', timeout: 120_000,
}, async (t) => {
  const parent = await realpath(tmpdir())
  const directory = await mkdtemp(join(parent, 'W3F7 字幕桌面-'))
  const profile = join(directory, '测试 profile')
  const appPath = resolve(env.W3F7_CAPTION_APP_PATH || root)
  const binary = env.W3F7_CAPTION_EXE || require('electron')
  const packaged = Boolean(env.W3F7_CAPTION_EXE)
  const bootstrap = join(directory, 'launch.cjs')
  const input = join(directory, '双音轨 语音样片.mp4')
  const wav = join(directory, '合成语音.wav')
  const live = env.W3F7_CAPTION_DESKTOP_LIVE === '1'
  let child
  let socket
  let recognitionRequests = 0
  let recognitionDelay = 900
  const server = createServer(async (request, response) => {
    if (request.url === '/audio/transcriptions') {
      for await (const _ of request) { /* Consume only the generated fixture audio. */ }
      recognitionRequests++
      await wait(recognitionDelay)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ segments: [{ start: .15, end: 3.5, text: 'This is a synthetic test for the subtitle workspace.' }] }))
      return
    }
    let raw = ''
    for await (const chunk of request) raw += chunk
    const posted = JSON.parse(raw)
    if (request.url !== '/chat/completions' || request.headers.authorization !== 'Bearer fixture-desktop-key' ||
        posted.model !== 'deepseek-flash') {
      response.writeHead(400).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.close()
    socket?.close()
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await Promise.race([exited, wait(3000)])
    }
    const target = await realpath(directory).catch(() => '')
    if (target && dirname(target) === parent) await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
  })
  await mkdir(profile)
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({
    theme: 'dark', welcomeSeen: true, reduceMotion: true, outputDirectory: directory,
  }))
  if (!packaged) {
    await writeFile(bootstrap, "const { app } = require('electron'); const { join } = require('node:path'); " +
      "app.setPath('userData', process.env.W3F7_DESKTOP_PROFILE); app.setAppPath(process.env.W3F7_DESKTOP_APP); " +
      "require(join(app.getAppPath(), 'dist-electron', 'main.cjs'))")
  }
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.SetOutputToWaveFile($env:W3F7_CAPTION_WAVE); $voice.Speak('This is a synthetic test for the subtitle workspace.'); $voice.Dispose()"],
  { windowsHide: true, env: { ...env, W3F7_CAPTION_WAVE: wav } })
  ffmpeg('-f', 'lavfi', '-i', 'color=blue:size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000', '-i', wav,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-metadata:s:a:1', 'language=eng',
    '-c:v', 'libx264', '-c:a', 'aac', '-t', '5', input)
  async function openDesktop() {
    let diagnostics = ''
    const args = ['--remote-debugging-port=0', '--user-data-dir=' + profile, ...(packaged ? [] : [bootstrap])]
    child = spawn(binary, args, { windowsHide: true, env: { ...env, W3F7_DESKTOP_PROFILE: profile, W3F7_DESKTOP_APP: appPath },
      stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr.setEncoding('utf8').on('data', (message) => { diagnostics += message })
    child.on('error', (error) => { diagnostics += error.message })
    const port = await until(() => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(diagnostics)?.[1], '启动 Electron')
      .catch((error) => { throw new Error(error.message + '\n' + diagnostics) })
    const tab = await until(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
      .find((item) => item.type === 'page' && item.url.includes('index.html')), '发现应用页面')
    socket = new WebSocket(tab.webSocketDebuggerUrl)
    await once(socket, 'open')
    const connected = session(socket)
    await connected.call('Runtime.enable')
    await connected.call('Debugger.enable')
    return connected
  }
  let { call, run, transcriptionScripts } = await openDesktop()
  const screenshot = async (name) => {
    if (!env.W3F7_CAPTION_SCREENSHOTS) return
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    await mkdir(env.W3F7_CAPTION_SCREENSHOTS, { recursive: true })
    await writeFile(join(env.W3F7_CAPTION_SCREENSHOTS, name + '.png'), Buffer.from(data, 'base64'))
  }
  const active = "[data-page-state='active']"
  const click = (label) => run((selector, text) => {
    const button = [...document.querySelectorAll(selector + ' button')].find((item) => item.textContent.trim() === text && !item.disabled && item.getClientRects().length)
    if (!button) return false
    button.click()
    return true
  }, active, label)
  const nav = (name) => run((text) => {
    const button = [...document.querySelectorAll('button[aria-label]')].find((item) => item.getAttribute('aria-label') === text)
    if (!button) return false
    button.click()
    return true
  }, name)
  const page = (name) => run((selector, target) => document.querySelector(selector)?.dataset.page === target, active, name)
  const queueTasks = () => run(() => window.videoTools.transcription.tasks())
  const queueDialog = () => run(() => document.querySelector('[role="alertdialog"]')?.textContent)
  const closeSidebar = () => run((selector) => document.querySelector(selector + ' .page-layout')?.click(), active)
  const pinned = () => run(() => document.querySelector('button[aria-label="切换侧栏"]')?.getAttribute('aria-pressed') === 'true')
  const setPinned = async (next) => {
    if (await pinned() === next) return
    await run(() => document.querySelector('button[aria-label="切换侧栏"]').click())
    await until(async () => await pinned() === next, '切换固定侧栏')
  }
  const clickDialog = (label) => run((text) => {
    const button = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find((item) => item.textContent === text && !item.disabled)
    if (!button) return false
    button.click()
    return true
  }, label)
  async function dismissSystemMotionNotice() {
    if (!await run(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    await until(() => clickDialog('知道了'), '关闭系统减少动效提示')
    await until(() => run(() => !document.querySelector('.startup-dialog')), '启动提示已关闭')
  }
  const presetName = (name) => run((value) => {
    const input = document.querySelector('[role="dialog"] input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, name)
  const aligned = (view) => run((name) => {
    const track = document.querySelector('.caption-tabs-list')
    const tab = track?.querySelector('[data-view-tab="' + name + '"]')
    const slider = track?.querySelector('.caption-tab-selection')
    if (tab?.getAttribute('aria-selected') !== 'true' || !slider) return false
    const a = tab.getBoundingClientRect()
    const b = slider.getBoundingClientRect()
    return Math.abs(a.left - b.left) < 1.05 && Math.abs(a.top - b.top) < 1.05 && Math.abs(a.width - b.width) < 1.05
  }, view)
  const tabPoint = (view) => run((name) => {
    const rect = document.querySelector('[data-view-tab="' + name + '"]').getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  }, view)
  const tabHeights = () => run(() => {
    const bounds = (selector) => {
      const { top, height } = document.querySelector(selector).getBoundingClientRect()
      return { top, height }
    }
    return { rail: bounds('.caption-tabs-list'), thumb: bounds('.caption-tab-selection') }
  })
  const pointer = (type, point) => call('Input.dispatchMouseEvent', {
    type, ...point, button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1,
  })
  async function pointerTab(view, expectedHeights) {
    const point = await tabPoint(view)
    await pointer('mousePressed', point)
    await pointer('mouseReleased', point)
    if (expectedHeights) assert.deepEqual(await tabHeights(), expectedHeights, 'vertical position while snapping to ' + view)
    await until(() => aligned(view), '短按滑块对齐 ' + view)
    if (expectedHeights) assert.deepEqual(await tabHeights(), expectedHeights, 'vertical position after snapping to ' + view)
  }
  const change = (label, value) => run((selector, text, next) => {
    const field = [...document.querySelectorAll(selector + ' label')].find((item) => item.firstElementChild?.textContent === text && item.getClientRects().length)
    const select = field?.querySelector('select')
    if (!select) return false
    select.value = next
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === next
  }, active, label, value)
  await until(() => page('home'), '首页启动')
  await dismissSystemMotionNotice()
  assert.equal(transcriptionScripts.size, 0, 'startup does not load transcription code')
  assert.equal(await run(() => document.querySelector('[data-page="transcription"]') === null), true)
  assert.equal(await run(() => [...document.querySelectorAll('.home-description p')].length === 2 &&
    [...document.querySelectorAll('.home-description p')].every((item) => !item.textContent.trim().endsWith('。'))), true)
  assert.equal(await run(() => window.videoTools.settings().then((settings) => settings.outputDirectory)), directory, 'isolated profile was used')
  const initial = await run(() => window.videoTools.transcription.settings())
  assert.equal(initial.llm.model, 'deepseek-flash')
  assert.equal(initial.llm.hasKey, false)
  assert.equal(await run(() => {
    const toggle = document.querySelector('button[aria-label="切换侧栏"]')
    if (!toggle) return false
    toggle.click()
    return true
  }), true)
  await until(() => run(() => document.querySelector('button[aria-label="切换侧栏"]')?.getAttribute('aria-pressed') === 'true'), '固定侧栏')
  assert.equal(await nav('语音转录'), true)
  await until(() => aligned('jobs'), '首次载入深色转录工作台')
  assert.equal(transcriptionScripts.size, 1, 'first visit loads the separate transcription bundle')
  assert.equal(await run(() => document.documentElement.classList.contains('dark') &&
    document.querySelectorAll('.caption-tabs-list [role="tab"]').length === 3), true)
  const reducedHeights = await tabHeights()
  await pointerTab('polish', reducedHeights)
  await pointerTab('synthesis', reducedHeights)
  await pointerTab('jobs', reducedHeights)
  assert.equal(await run(() => document.querySelector('.caption-tabs-list').dataset.animated), 'false')
  assert.equal(await run(() => getComputedStyle(document.querySelector('.caption-tab-selection')).getPropertyValue('--caption-light-tail').trim()), '#a78bfa')
  const touch = await tabPoint('polish')
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
  assert.equal(await aligned('jobs'), true)
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await until(() => aligned('polish'), '减少动效下点按触屏切换')
  assert.equal(await run(() => document.querySelector('.caption-tab-light')), null)
  await pointerTab('jobs')
  await setPinned(false)
  await screenshot('task-settings-dark')
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '打开设置')
  await until(() => run(() => {
    const theme = document.querySelector('[data-page-state="active"] button[aria-label="浅色主题"]')
    if (!theme) return false
    theme.click()
    return true
  }), '切到浅色设置')
  await until(() => run(() => !document.documentElement.classList.contains('dark')), '浅色主题生效')
  assert.equal(await nav('引擎说明'), true)
  await until(() => page('engines'), '打开引擎说明')
  assert.match(await run((selector) => document.querySelector(selector).textContent, active), /必剪 · 免 Key/)
  assert.equal(await nav('模型与 API'), true)
  await until(() => page('models'), '打开模型设置')
  await until(() => run((selector) => [...document.querySelectorAll(selector + ' input')].some((input) => input.value === 'deepseek-flash'), active), '默认模型可见')
  await setPinned(true)
  await run((selector) => document.querySelector(selector + ' input').click(), active)
  assert.equal(await pinned(), true, '点击输入控件时保持侧栏')
  await run((selector) => document.querySelector(selector + ' [data-slot="card-content"]').click(), active)
  await until(async () => !await pinned(), '模型页卡片内边距收起侧栏')
  const model = await run(async (port) => {
    const api = window.videoTools.transcription
    const settings = await api.settings()
    settings.llm.base = 'http://127.0.0.1:' + port
    settings.whisper.base = 'http://127.0.0.1:' + port
    await api.save({ ...settings, llmKey: 'fixture-desktop-key' })
    return api.testModel()
  }, server.address().port)
  assert.match(model, /已连接.*deepseek-flash/)
  assert.ok(!(await readFile(join(profile, 'transcription', 'settings.json'), 'utf8')).includes('fixture-desktop-key'))
  assert.equal(await nav('语音转录'), true)
  await until(() => page('transcription'), '打开语音转录')
  await setPinned(true)
  await run((selector) => document.querySelector(selector + ' .caption-processing-scroll').click(), active)
  await until(async () => !await pinned(), '转录滚动区空白收起侧栏')
  assert.equal(await run((selector) => {
    const page = document.querySelector(selector)
    const rect = (part) => page.querySelector(part).getBoundingClientRect()
    const input = rect('.caption-input-card')
    const queue = rect('.caption-queue-card')
    const output = rect('.caption-processing-card')
    const start = page.querySelector('.caption-processing-footer button')
    const scroller = page.querySelector('.caption-processing-scroll')
    return Math.abs(input.left - queue.left) < 1 && Math.abs(input.right - queue.right) < 1 &&
      input.bottom < queue.top && queue.right < output.left && Math.abs(queue.bottom - output.bottom) < 2 &&
      start.getBoundingClientRect().bottom < output.bottom && scroller.scrollHeight > scroller.clientHeight
  }, active), true)
  await screenshot('task-settings-wide')
  await call('Emulation.setDeviceMetricsOverride', { width: 750, height: 650, deviceScaleFactor: 1, mobile: false })
  assert.equal(await run((selector) => {
    const page = document.querySelector(selector)
    const rect = (part) => page.querySelector(part).getBoundingClientRect()
    const input = rect('.caption-input-card')
    const output = rect('.caption-processing-card')
    const queue = rect('.caption-queue-card')
    return page.scrollWidth <= page.clientWidth && Math.abs(input.left - queue.left) < 1 &&
      input.bottom < output.top && output.bottom < queue.top
  }, active), true)
  await until(() => aligned('jobs'), '窄窗滑块对齐')
  const narrowHeights = await tabHeights()
  await pointerTab('polish', narrowHeights)
  await pointerTab('synthesis', narrowHeights)
  await pointerTab('jobs', narrowHeights)
  await screenshot('task-settings-narrow')
  await call('Emulation.clearDeviceMetricsOverride')
  assert.equal(await change('字幕断句', 'original'), true)
  assert.equal(await click('保存为预设'), true)
  await presetName('视频校对 V1')
  await until(() => clickDialog('保存预设'), '命名保存预设')
  const preset = await until(() => run(() => window.videoTools.transcription.listPresets().then((items) => items[0])), '预设写入')
  assert.equal(preset.options.split, 'original')
  assert.equal(await change('字幕断句', 'rules'), true)
  assert.equal(await change('选用预设', preset.id), true)
  assert.equal(await run(() => [...document.querySelectorAll('.caption-processing-scroll label')].find((label) =>
    label.firstElementChild.textContent === '字幕断句').querySelector('select').value), 'original')
  assert.equal(await change('字幕断句', 'rules'), true)
  assert.equal(await click('保存为预设'), true)
  await presetName(preset.name)
  await until(() => clickDialog('保存预设'), '尝试保存同名预设')
  await until(() => clickDialog('确认覆盖'), '明确确认覆盖')
  await until(() => run(() => window.videoTools.transcription.listPresets().then((items) => items[0]?.options.split === 'rules')), '预设已覆盖')
  await call('DOM.enable')
  await run(() => {
    const input = document.createElement('input')
    input.id = 'w3f7-test-file'
    input.type = 'file'
    input.multiple = true
    document.body.append(input)
  })
  const dom = await call('DOM.getDocument')
  const element = await call('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#w3f7-test-file' })
  await call('DOM.setFileInputFiles', { nodeId: element.nodeId, files: live ? [input] : [input, wav] })
  await run((selector) => {
    const files = new DataTransfer()
    for (const file of document.querySelector('#w3f7-test-file').files) files.items.add(file)
    document.querySelector(selector + ' .caption-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }))
  }, active)
  await until(() => run((selector) => document.querySelector(selector + ' .caption-assets')?.textContent.includes('双音轨'), active), '导入双音轨样本')
  assert.equal(await change('音轨', '2'), true)
  if (!live) assert.equal(await change('识别引擎', 'whisper-api'), true)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '打开动效设置')
  await run(() => document.querySelector('#reduce-motion').click())
  await until(() => run(() => window.videoTools.settings().then((value) => !value.reduceMotion)), '启用应用动效')
  assert.equal(await nav('语音转录'), true)
  await until(() => page('transcription'), '返回任务设置')
  await closeSidebar()
  await wait(380)
  const wideHeights = await tabHeights()
  assert.equal(await run(() => getComputedStyle(document.querySelector('.caption-tab-selection')).getPropertyValue('--caption-light-head').trim()), '#ffaf35')
  await pointerTab('polish', wideHeights)
  await pointerTab('synthesis', wideHeights)
  await pointerTab('jobs', wideHeights)
  const first = await tabPoint('jobs')
  const last = await tabPoint('synthesis')
  await pointer('mousePressed', last)
  await wait(220)
  assert.equal(await aligned('jobs'), true, 'pressing an inactive tab alone has no effect')
  await pointer('mouseMoved', first)
  await pointer('mouseReleased', first)
  assert.equal(await aligned('jobs'), true, 'dragging across tabs does not switch')
  await pointer('mousePressed', first)
  await pointer('mouseMoved', last)
  await pointer('mouseReleased', last)
  assert.equal(await aligned('jobs'), true, 'reverse drag does not switch either')
  await pointerTab('jobs')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await until(() => aligned('polish'), '方向键切换')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  assert.equal(await aligned('polish'), true)
  await until(() => run(() => document.querySelectorAll('.caption-tab-light').length === 0), '前置切换流光淡出')
  await pointerTab('polish')
  assert.equal(await run(() => document.querySelectorAll('.caption-tab-light').length), 0, 'reselecting the current tab does not animate')
  await run(() => {
    window.fixtureTabFades = []
    document.querySelector('.caption-tabs-list').addEventListener('animationend', (event) => {
      if (event.animationName === 'caption-light-fade') window.fixtureTabFades.push(event.target.dataset.direction)
    })
  })
  assert.equal(await click('字幕视频合成'), true)
  assert.equal(await click('字幕优化与翻译'), true)
  assert.equal(await click('任务设置'), true)
  assert.deepEqual(await run(() => [...document.querySelectorAll('.caption-tab-light')].map((sweep) => sweep.dataset.direction)),
    ['right', 'left', 'left'], 'each rapid switch starts an independent sweep')
  assert.deepEqual(await run(() => [...document.querySelectorAll('.caption-tab-light')].map((sweep) => {
    const band = sweep.querySelector('.caption-tab-light-band')
    const travel = band.getAnimations()[0]
    const fade = sweep.getAnimations()[0]
    const travelTime = travel.currentTime
    const fadeTime = fade.currentTime
    const position = (time) => {
      travel.currentTime = time
      return band.getBoundingClientRect().left - sweep.getBoundingClientRect().left
    }
    const start = position(0)
    const fast = position(135)
    const slow = position(405)
    const end = position(540)
    fade.currentTime = 450
    const fading = Number(getComputedStyle(sweep).opacity)
    travel.currentTime = travelTime
    fade.currentTime = fadeTime
    return [end > start ? 'right' : 'left', Math.abs(fast - start) > Math.abs(end - slow), fading > 0 && fading < 1]
  })), [['right', true, true], ['left', true, true], ['left', true, true]])
  await screenshot('caption-slider-sweeps')
  await until(() => aligned('jobs'), '连续点击后的滑块对齐')
  assert.deepEqual(await tabHeights(), wideHeights)
  await until(() => run(() => window.fixtureTabFades.length === 3 && !document.querySelector('.caption-tab-light')), '连续切换后流光分别淡出')
  assert.deepEqual(await run(() => window.fixtureTabFades), ['right', 'left', 'left'])
  await call('Emulation.setDeviceMetricsOverride', { width: 750, height: 650, deviceScaleFactor: 1, mobile: false })
  await until(() => aligned('jobs'), '动效下缩放到 750 像素')
  const animatedNarrowHeights = await tabHeights()
  const narrowPress = await tabPoint('synthesis')
  await pointer('mousePressed', narrowPress)
  await wait(200)
  assert.equal(await aligned('jobs'), true)
  const narrowRelease = await tabPoint('polish')
  await pointer('mouseMoved', narrowRelease)
  await pointer('mouseReleased', narrowRelease)
  assert.equal(await aligned('jobs'), true)
  await pointerTab('polish', animatedNarrowHeights)
  await pointerTab('synthesis', animatedNarrowHeights)
  await pointerTab('jobs', animatedNarrowHeights)
  assert.equal(await run(() => {
    const scroller = document.querySelector('.caption-job-scroll')
    scroller.scrollTop = scroller.scrollHeight
    const innerScrolled = scroller.scrollTop > 0
    scroller.scrollTop = 0
    return innerScrolled && document.querySelector('[data-page="transcription"]').scrollTop === 0
  }), true, 'narrow layout scrolls below the rail')
  assert.deepEqual(await tabHeights(), animatedNarrowHeights)
  await call('Emulation.clearDeviceMetricsOverride')
  await until(() => aligned('jobs'), '动效下恢复宽窗')
  await run(() => {
    window.fixtureChimeNotes = 0
    const original = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      window.fixtureChimeNotes++
      return original.call(this)
    }
  })
  assert.equal(await click(live ? '开始处理' : '添加 2 项任务'), true)
  await until(() => run(() => document.querySelector('.caption-progress-shine')?.getClientRects().length > 0), '实际进度与流光')
  assert.equal(await run(() => {
    const list = document.querySelector('.caption-queue')
    const row = list?.querySelector('li')
    return row && list.clientHeight >= row.offsetHeight
  }), true, '宽窗有素材时队列仍显示至少一整行')
  await screenshot('task-settings-progress')
  assert.equal(await nav('模型与 API'), true)
  await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]?.state === 'review' || tasks[0]?.state === 'failed')),
    live ? '真实必剪任务转录与断句' : '模拟上传与字幕校对', 40_000)
  assert.equal(await nav('语音转录'), true)
  await until(() => page('transcription'), '返回转录工作台')
  await closeSidebar()
  const review = await run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]))
  assert.equal(review.state, 'review', review.message)
  assert.match(review.cues.map(({ text }) => text).join(' '), /synthetic test|subtitle workspace/i)
  await until(() => run(() => document.querySelector('.caption-queue-progress [role="progressbar"]')?.getAttribute('aria-valuenow') === '100'), '批次进度完成')
  await until(() => run(() => window.fixtureChimeNotes === 2), '仅播放一次两音符提示')
  assert.equal(recognitionRequests, live ? 0 : 2)
  assert.equal(await click('字幕优化与翻译'), true)
  await until(() => run(() => document.querySelector('.caption-preview video')?.getClientRects().length > 0), '校对播放器显示')
  assert.equal(await run(() => document.querySelector('.caption-queue-card').getClientRects().length), 0)
  await run(async () => { const video = document.querySelector('.caption-preview video'); video.currentTime = .6; await video.play() })
  await until(() => run(() => document.querySelector('.caption-row[data-current=true]') !== null), '播放实时高亮字幕')
  await screenshot('subtitle-review-playing')
  assert.equal(await run((selector) => {
    const field = document.querySelector(selector + ' textarea[aria-label="原文 1"]')
    if (!field) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '字幕校对。')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, active), true)
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '带校对草稿切离转录页')
  assert.equal(await nav('语音转录'), true)
  await until(async () => await page('transcription') && await aligned('polish'), '返回转录后仍在校对页')
  assert.equal(transcriptionScripts.size, 1, 'revisiting does not reload the transcription bundle')
  assert.equal(await run((selector) => document.querySelector(selector + ' textarea[aria-label="原文 1"]').value, active), '字幕校对。')
  assert.equal(await click('任务设置'), true)
  assert.equal(await click('清空列表'), true)
  assert.match(await queueDialog(), /未保存的校对草稿将丢失/)
  await until(() => clickDialog('取消'), '取消清空并保留校对')
  assert.equal((await queueTasks()).length, live ? 1 : 2)
  assert.equal(await click('字幕优化与翻译'), true)
  assert.equal(await run(() => document.querySelector('textarea[aria-label="原文 1"]').value), '字幕校对。')
  assert.equal(await click('字幕视频合成'), true)
  await until(() => run(() => document.querySelector('.caption-preview video')?.paused), '切离校对暂停播放')
  assert.equal(await click('合成视频'), false, 'unsaved draft blocks synthesis')
  assert.equal(await click('返回校对'), true)
  assert.equal(await run(() => document.querySelector('textarea[aria-label="原文 1"]').value), '字幕校对。')
  await until(() => click('保存校对'), '保存校对')
  await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]?.cues[0]?.text === '字幕校对。')), '校对已提交')
  assert.equal(await click('字幕视频合成'), true)
  await until(() => run(() => document.querySelector('.caption-pane[data-state="active"]')?.textContent.includes('成品字幕类型')), '打开合成设置')
  await screenshot('subtitle-synthesis')
  assert.equal(await change('成品字幕类型', 'rounded'), true)
  assert.equal(await click('合成视频'), true)
  const terminal = await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) =>
    ['done', 'failed', 'warning'].includes(tasks[0]?.state) && tasks[0])), '实际 Chromium Canvas 硬字幕合成', 45_000)
  assert.ok(['done', 'warning'].includes(terminal.state), terminal.message)
  const items = await readdir(directory)
  const output = join(directory, items.find((item) => item.includes('字幕成片')))
  const srt = join(directory, items.find((item) => item.endsWith('_字幕.srt')))
  assert.match(await readFile(srt, 'utf8'), /字幕校对。/)
  const frame = (file) => ffmpeg('-ss', '1', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'framehash', '-')
    .toString().split('\n').find((row) => /^\d,/.test(row))?.split(',').at(-1)
  assert.ok(frame(output))
  assert.notEqual(frame(output), frame(input))
  assert.equal(await run(() => window.fixtureChimeNotes), 2, 'manually synthesizing did not replay the recognition sound')
  assert.equal(await click('任务设置'), true)
  assert.equal(await nav('删除任务 ' + review.name), true)
  assert.ok((await queueDialog()).includes(review.name), 'single deletion names the task')
  await until(() => clickDialog('确认删除'), '确认删除已完成任务')
  await until(() => run((id) => window.videoTools.transcription.tasks().then((tasks) => !tasks.some((item) => item.id === id)), review.id), '移除已完成任务')
  if (!live) {
    assert.equal(await run(() => document.querySelectorAll('.caption-queue-select[aria-pressed="true"]').length), 1, 'a neighbouring task is selected')
    assert.equal(await click('清空列表'), true)
    assert.match(await queueDialog(), /1 项任务记录/)
    await until(() => clickDialog('确认清空'), '清空剩余成品任务')
    await until(async () => (await queueTasks()).length === 0, '队列恢复为空')
    assert.equal(await click('添加 2 项任务'), true)
    await until(async () => (await queueTasks())[0]?.state === 'review', '再建待校对任务')
    assert.equal(await click('字幕优化与翻译'), true)
    await until(() => run(() => Boolean(document.querySelector('textarea[aria-label="原文 1"]')?.getClientRects().length)), '重新打开字幕校对')
    await run(() => {
      const field = document.querySelector('textarea[aria-label="原文 1"]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '待删除的草稿')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal(await click('任务设置'), true)
    assert.equal(await nav('删除任务 ' + review.name), true)
    assert.match(await queueDialog(), /未保存的校对草稿将丢失/)
    await until(() => clickDialog('确认删除'), '删除待校对任务和草稿')
    await until(async () => (await queueTasks()).length === 1, '校对项已移除')
    await until(() => click('清空列表'), '清理剩余测试任务')
    await until(() => clickDialog('确认清空'), '确认清理剩余测试任务')
    await until(async () => (await queueTasks()).length === 0, '准备测试清空活跃队列')
    recognitionDelay = 3500
    assert.equal(await change('音频语言', 'en'), true)
    assert.equal(await click('添加 2 项任务'), true)
    await until(async () => (await queueTasks()).map(({ state }) => state).join(',') === 'running,queued', '运行中和排队任务并存')
    const chimes = await run(() => window.fixtureChimeNotes)
    await until(() => click('清空列表'), '打开清空活跃任务的确认框')
    assert.match(await queueDialog(), /2 项运行中或排队任务会先停止/)
    await screenshot('task-queue-clear')
    await until(() => clickDialog('确认清空'), '停止并清空活跃任务')
    await until(async () => (await queueTasks()).length === 0, '排队项和运行项均已移除')
    await until(() => run(() => !document.querySelector('.caption-queue-progress') &&
      document.querySelector('.caption-assets').textContent.includes('双音轨')), '清空后隐藏旧进度并保留素材')
    assert.equal(await run(() => window.fixtureChimeNotes), chimes, 'clearing a batch does not chime')
  }
  assert.ok(frame(output), 'exported video is still on disk after deletion')
  assert.match(await readFile(srt, 'utf8'), /字幕校对。/)
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '打开深色流光测试设置')
  await until(() => nav('浅色主题'), '关闭浅色主题')
  await until(() => run(() => document.documentElement.classList.contains('dark')), '深色已应用')
  assert.equal(await nav('语音转录'), true)
  await until(async () => await page('transcription') && await aligned('jobs'), '打开深色转录')
  await wait(320)
  await pointerTab('synthesis')
  assert.equal(await run(() => document.querySelector('.caption-tab-light')?.dataset.direction), 'right')
  assert.equal(await run(() => getComputedStyle(document.querySelector('.caption-tab-selection')).getPropertyValue('--caption-light-head').trim()), '#efffff')
  await screenshot('caption-slider-dark')
  await pointerTab('jobs')
  assert.equal(await run(() => [...document.querySelectorAll('.caption-tab-light')].at(-1)?.dataset.direction), 'left')
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '打开浅色主题设置')
  await until(() => nav('浅色主题'), '恢复浅色主题')
  await until(() => run(() => !document.documentElement.classList.contains('dark')), '浅色已恢复')
  const exited = once(child, 'exit')
  await run(() => window.close()).catch(() => {})
  assert.equal((await exited)[0], 0)
  ;({ call, run, transcriptionScripts } = await openDesktop())
  await until(() => page('home'), '重新启动 Electron')
  await dismissSystemMotionNotice()
  assert.equal(transcriptionScripts.size, 0)
  assert.equal(await run((id) => window.videoTools.transcription.tasks().then((tasks) => tasks.some((item) => item.id === id)), review.id), false)
  assert.match(await readFile(srt, 'utf8'), /字幕校对/)
  assert.equal(await nav('语音转录'), true)
  await until(() => page('transcription'), '重新进入转录并读取预设')
  await until(() => change('选用预设', preset.id), '重启后选择磁盘中的预设')
  assert.equal(await nav('删除选中预设'), true)
  await until(() => clickDialog('确认删除'), '确认删除操作预设')
  await until(() => run(() => window.videoTools.transcription.listPresets().then((items) => !items.length)), '删除持久化')
  assert.equal(await nav('设置'), true)
  await until(() => page('settings'), '重新打开设置')
  await run(() => document.querySelector('#reduce-motion').click())
  await until(() => run(() => window.videoTools.settings().then((value) => value.reduceMotion)), '恢复减少动效')
  await until(() => run(() => document.body.textContent.includes('当前转录缓存位置')), '转录缓存设置显示')
  assert.ok((await run(() => window.videoTools.transcription.cacheStatus())).bytes > 0)
  assert.equal(await click('清理闲置缓存'), true)
  await until(() => run(() => {
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((item) => item.textContent === '确认清理')
    if (!confirm) return false
    confirm.click()
    return true
  }), '确认清理闲置转录缓存')
  await until(() => run(() => window.videoTools.transcription.cacheStatus().then((status) => status.bytes === 0)), '缓存占用清零')
  assert.match(await readFile(srt, 'utf8'), /字幕校对/)
  const saved = await run(() => window.videoTools.settings())
  assert.equal(saved.reduceMotion, true, 'isolated profile was used')
  assert.equal(saved.theme, 'light')
  assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).theme, 'light')
  await run(() => window.close()).catch(() => {})
})
