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
  let next = 0
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
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
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text)
    return answer.result.value
  }
  return { call, run }
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
  const existing = join(directory, '双音轨 语音样片.srt')
  const live = env.W3F7_CAPTION_DESKTOP_LIVE === '1'
  let child
  let socket
  const server = createServer(async (request, response) => {
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
  if (!live) await writeFile(existing, '1\n00:00:00,150 --> 00:00:03,500\nThis is a synthetic test for the subtitle workspace.\n')
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
  const { call, run } = session(socket)
  await call('Runtime.enable')
  const active = "[data-page-state='active']"
  const click = (label) => run((selector, text) => {
    const button = [...document.querySelectorAll(selector + ' button')].find((item) => item.textContent.trim() === text && !item.disabled)
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
  const change = (label, value) => run((selector, text, next) => {
    const field = [...document.querySelectorAll(selector + ' label')].find((item) => item.firstElementChild?.textContent === text)
    const select = field?.querySelector('select')
    if (!select) return false
    select.value = next
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === next
  }, active, label, value)
  await until(() => page('home'), '首页启动')
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
  const model = await run(async (port) => {
    const api = window.videoTools.transcription
    const settings = await api.settings()
    settings.llm.base = 'http://127.0.0.1:' + port
    await api.save({ ...settings, llmKey: 'fixture-desktop-key' })
    return api.testModel()
  }, server.address().port)
  assert.match(model, /已连接.*deepseek-flash/)
  assert.ok(!(await readFile(join(profile, 'transcription', 'settings.json'), 'utf8')).includes('fixture-desktop-key'))
  assert.equal(await nav('语音转录'), true)
  await until(() => page('transcription'), '打开语音转录')
  await call('Emulation.setDeviceMetricsOverride', { width: 760, height: 650, deviceScaleFactor: 1, mobile: false })
  assert.equal(await run((selector) => {
    const page = document.querySelector(selector)
    return page.scrollWidth <= page.clientWidth
  }, active), true)
  await call('Emulation.clearDeviceMetricsOverride')
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
  await call('DOM.setFileInputFiles', { nodeId: element.nodeId, files: live ? [input] : [input, existing] })
  await run((selector) => {
    const files = new DataTransfer()
    for (const file of document.querySelector('#w3f7-test-file').files) files.items.add(file)
    document.querySelector(selector + ' .caption-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }))
  }, active)
  await until(() => run((selector) => document.querySelector(selector + ' .caption-assets')?.textContent.includes('双音轨'), active), '导入双音轨样本')
  assert.equal(await change('音轨', '2'), true)
  assert.equal(await click('开始处理'), true)
  assert.equal(await nav('模型与 API'), true)
  await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]?.state === 'review' || tasks[0]?.state === 'failed')),
    live ? '真实必剪任务转录与断句' : '已有字幕与视频配对', 40_000)
  assert.equal(await nav('语音转录'), true)
  const review = await run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]))
  assert.equal(review.state, 'review', review.message)
  assert.match(review.cues.map(({ text }) => text).join(' '), /synthetic test|subtitle workspace/i)
  assert.equal(await run((selector) => {
    const field = document.querySelector(selector + ' textarea[aria-label="原文 1"]')
    if (!field) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '字幕校对')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, active), true)
  await until(() => click('保存校对'), '保存校对')
  await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) => tasks[0]?.cues[0]?.text === '字幕校对')), '校对已提交')
  assert.equal(await change('成品字幕类型', 'rounded'), true)
  assert.equal(await click('合成视频'), true)
  const terminal = await until(() => run(() => window.videoTools.transcription.tasks().then((tasks) =>
    ['done', 'failed', 'warning'].includes(tasks[0]?.state) && tasks[0])), '实际 Chromium Canvas 硬字幕合成', 45_000)
  assert.ok(['done', 'warning'].includes(terminal.state), terminal.message)
  const items = await readdir(directory)
  const output = join(directory, items.find((item) => item.includes('字幕成片')))
  const srt = join(directory, items.find((item) => item.endsWith('_字幕.srt')))
  assert.match(await readFile(srt, 'utf8'), /字幕校对/)
  const frame = (file) => ffmpeg('-ss', '1', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'framehash', '-')
    .toString().split('\n').find((row) => /^\d,/.test(row))?.split(',').at(-1)
  assert.ok(frame(output))
  assert.notEqual(frame(output), frame(input))
  const saved = await run(() => window.videoTools.settings())
  assert.equal(saved.reduceMotion, true, 'isolated profile was used')
  assert.equal(saved.theme, 'light')
  assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).theme, 'light')
  await run(() => window.close()).catch(() => {})
})
