const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { setTimeout: wait } = require('node:timers/promises')

const captions = require('../dist-electron/captions.cjs')
const services = require('../dist-electron/caption-services.cjs')
const media = require('../dist-electron/caption-media.cjs')
const { CaptionConfiguration, defaultCaptionSettings } = require('../dist-electron/caption-settings.cjs')
const { TranscriptionWorkspace } = require('../dist-electron/transcription.cjs')
const { CaptionCache } = require('../dist-electron/caption-cache.cjs')

const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', version: 'test' }
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { windowsHide: true })
const json = (value, init) => Response.json(value, init)
const credentials = (patch = {}) => ({ settings: structuredClone(defaultCaptionSettings), llmKey: '', whisperKey: '', ...patch })
const signal = () => AbortSignal.timeout(20_000)
const noProgress = () => {}
const cue = (start, end, text, timing = 'segment') => captions.cue(start, end, text, timing)

function defaults(changes = {}) {
  return {
    mode: 'full', engine: 'bijian', language: 'auto', split: 'rules', correct: false,
    translator: 'none', target: 'en', reflect: false, prompt: '', cjk: 12, words: 18, batch: 10, concurrency: 3,
    layout: 'source-first', formats: ['srt'], synthesis: 'soft', container: 'mp4', quality: 28, review: false,
    style: { ...captions.defaultStyle }, ...changes,
  }
}

async function folder(t) {
  const parent = await realpath(tmpdir())
  const path = await mkdtemp(join(parent, 'W3F7 字幕测试-'))
  t.after(async () => {
    const target = await realpath(path).catch(() => '')
    if (target && dirname(target) === parent) await rm(target, { recursive: true, force: true })
  })
  return path
}

function mockResponse(text) {
  return json({ choices: [{ message: { content: text } }] })
}

function paragraph() {
  return [{ transcript: 'This is test speech', start_time: 100, end_time: 1500, words: [
    { label: 'This', start_time: 100, end_time: 230 }, { label: 'is', start_time: 280, end_time: 420 },
    { label: 'test', start_time: 450, end_time: 850 }, { label: 'speech', start_time: 875, end_time: 1500 },
  ] }]
}

function bijianTransport({ requests = [], afterTask, partSize = 5 * 1024 ** 2, getResult } = {}) {
  return async (address, init) => {
    const url = new URL(address)
    const operation = url.pathname.split('/').at(-1)
    requests.push([init.method || 'GET', url.hostname, operation])
    if (url.hostname === 'jssz-boss.biliapi.net') {
      assert.equal(url.protocol, 'https:')
      assert.ok(init.body.byteLength <= partSize)
      return new Response(null, { headers: { etag: 'fixture-etag' } })
    }
    if (operation === 'create') {
      const { size } = JSON.parse(init.body)
      return json({ code: 0, data: { in_boss_key: 'boss', resource_id: 'asset', upload_id: 'upload', per_size: partSize,
        upload_urls: Array.from({ length: Math.ceil(size / partSize) }, (_, index) => 'http://jssz-boss.biliapi.net/part' + index) } })
    }
    if (operation === 'complete') {
      assert.match(init.body, /fixture-etag/)
      return json({ code: 0, data: { download_url: 'https://jssz-boss.biliapi.net/audio' } })
    }
    if (operation === 'task') {
      afterTask?.()
      return json({ code: 0, data: { task_id: 'task-1' } })
    }
    if (operation === 'result') {
      assert.equal(url.searchParams.get('task_id'), 'task-1')
      return getResult ? getResult() : json({ code: 0, data: { state: 4, result: JSON.stringify({ utterances: paragraph() }) } })
    }
    throw new Error('unexpected request ' + url.hostname)
  }
}

test('SRT, VTT, ASS and compatible JSON keep Unicode, layout and timing', () => {
  const input = [{ ...cue(36_000_321, 36_001_479, '中文 A < B & C\n下一行'), id: '1', translation: 'English' }]
  for (const format of ['srt', 'vtt', 'ass', 'json']) {
    const serialized = captions.serializeCaptions(input, format, 'translation-first')
    const [row] = captions.parseCaptions(serialized, format)
    assert.ok(Math.abs(row.start - input[0].start) < 10)
    assert.ok(Math.abs(row.end - input[0].end) < 10)
    assert.match(row.text, /中文 A < B & C\n下一行/)
    if (format === 'json') assert.equal(row.translation, 'English')
    else assert.ok(row.text.startsWith('English\n'))
  }
  const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.020\n<c>hi</c><00:00:00.500><c> there</c>\n'
  assert.deepEqual(captions.parseCaptions(vtt, 'vtt').map(({ start, end, timing }) => [start, end, timing]),
    [[0, 500, 'word'], [500, 1020, 'word']])
  const utf16 = Buffer.from('\ufeff测试', 'utf16le')
  assert.equal(captions.decodeSubtitle(utf16), '测试')
  assert.equal(captions.decodeSubtitle(Buffer.from([0xb2, 0xe2, 0xca, 0xd4])), '测试')
  assert.equal(captions.displayedText(input[0], 'source-first'), '中文 A < B & C\n下一行\nEnglish')
  assert.equal(captions.displayedText({ ...input[0], translation: '' }, 'translation'), input[0].text)
})

test('rule splitting, semantic validation and chunk merge preserve order and timing provenance', () => {
  const limits = { cjk: 6, words: 4 }
  const split = captions.splitWithRules(captions.wordCues([cue(0, 4200, '今天我们一起测试字幕。Then this is sample speech.')]), limits)
  assert.ok(split.length > 2)
  assert.ok(split.every((line) => line.end > line.start && line.timing === 'estimated'))
  assert.equal(split[0].start, 0)
  assert.equal(split.at(-1).end, 4200)
  const words = [cue(0, 100, 'one', 'word'), cue(120, 250, 'two', 'word'), cue(280, 420, 'three', 'word')]
  assert.equal(captions.alignSentences(words, ['one two', 'three'], limits).at(-1).start, 280)
  assert.equal(captions.alignSentences(words, ['one two', 'changed'], limits), null)
  const parts = [{ start: 0, cues: [cue(100, 800, 'before'), cue(9000, 9400, 'same'), cue(9600, 9900, 'phrase')] },
    { start: 9000, cues: [cue(0, 400, 'same'), cue(600, 900, 'phrase'), cue(1200, 1700, 'after')] }]
  assert.deepEqual(captions.joinChunks(parts, 1000).cues.map(({ text }) => text), ['before', 'same', 'phrase', 'after'])
  const fallback = [parts[0], { start: 9000, cues: [cue(0, 400, 'replacement')] }]
  assert.deepEqual(captions.joinChunks(fallback, 1000), { cues: captions.cleanCues([cue(100, 800, 'before'), cue(9000, 9400, 'replacement')]), fallback: 1 })
  assert.deepEqual(media.chunkPlan(1_235_000, 10).map(({ start }) => start), [0, 590000, 1180000])
  assert.deepEqual(media.chunkPlan(1_235_000, 20).map(({ start }) => start), [0, 1190000])
  assert.ok(captions.smoothCues([cue(10, 100, 'a'), cue(190, 300, 'b')])[0].end > 100)
})

test('必剪 handles multipart TLS upload, empty data, refused calls, quota and cancellation', async () => {
  const remote = new Map()
  const requests = []
  let usage = 0
  const recognize = services.bijian
  const audio = Buffer.alloc(11)
  const mock = bijianTransport({ requests, partSize: 4 })
  const cues = await recognize(mock, audio, true, signal(), noProgress, remote, 'test', async () => { usage++ })
  assert.equal(cues.length, 4)
  assert.equal(cues[1].timing, 'word')
  assert.equal(requests.filter(([method]) => method === 'PUT').length, 3)
  assert.equal(usage, 1)
  assert.equal(remote.size, 0)
  remote.set('test', 'task-1')
  const empty = await recognize(bijianTransport({ getResult: () => json({ data: { state: 4, result: { utterances: [] } } }) }),
    audio, false, signal(), noProgress, remote, 'test', () => assert.fail('resume cannot reserve quota'))
  assert.deepEqual(empty, [])
  await assert.rejects(recognize(() => json({}, { status: 403 }), audio, false, signal(), noProgress,
    remote, 'test', async () => {}), /403/)
  await assert.rejects(recognize(() => assert.fail('quota denied upload'), audio, false, signal(), noProgress,
    remote, 'test', async () => { throw new Error('quota denied') }), /quota denied/)
  const controller = new AbortController()
  const cancelled = bijianTransport({ getResult: () => {
    controller.abort()
    return json({ data: { state: 2 } })
  } })
  await assert.rejects(recognize(cancelled, audio, false, controller.signal, noProgress, remote, 'test', async () => {}), /abort/i)
  assert.equal(remote.get('test'), 'task-1')
})

test('剪映 uses isolated signing, upload and parsing through a fixture transport', async () => {
  const paths = []
  const request = async (address, init) => {
    const url = new URL(address)
    const operation = url.pathname.split('/').at(-1)
    paths.push(operation)
    if (operation === 'sign') return json({ sign: 'fake-server-signature' })
    if (operation === 'upload_sign') return json({ ret: '0', data: { access_key_id: 'test', secret_access_key: 'test', session_token: 'test' } })
    if (url.hostname === 'vod.bytedanceapi.com') {
      assert.match(init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test/)
      return json({ Result: { UploadAddress: { UploadHosts: ['store.bytedanceapi.com'],
        StoreInfos: [{ StoreUri: 'asset', UploadID: 'upload', Auth: 'upload-test' }] } } })
    }
    if (operation === 'asset') {
      if (init.method === 'POST') assert.match(init.body, /^1:[a-f\d]{8}$/)
      return json({ success: 0 })
    }
    if (operation === 'submit') return json({ ret: '0', data: { id: 'job-2' } })
    if (operation === 'query') return json({ ret: '0', data: { utterances: [{ text: '一行', start_time: 0, end_time: 100 }] } })
    throw new Error('unexpected request')
  }
  const [line] = await services.jianying(request, Buffer.from('audio'), 1000, false, signal(), noProgress,
    new Map(), 'test', async () => {}, '3960000000000000')
  assert.equal(line.text, '一行')
  assert.equal(paths.filter((item) => item === 'asset').length, 3)
  await assert.rejects(services.jianying(() => json({}, { status: 403 }), Buffer.from('audio'), 1000, false, signal(), noProgress,
    new Map(), 'test', async () => {}, '3960000000000000'), /签名服务.*403/)
})

test('DeepSeek preset, correction retries and reflection use the configured compatible endpoint', async () => {
  const config = credentials({ llmKey: 'fixture-key' })
  const input = captions.cleanCues([cue(0, 550, 'helo world'), cue(750, 1100, 'good day')])
  const seen = []
  const response = (output) => async (url, init) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer fixture-key')
    const packet = JSON.parse(init.body)
    assert.equal(packet.model, 'deepseek-flash')
    assert.deepEqual(packet.thinking, { type: 'disabled' })
    seen.push(packet.messages)
    return mockResponse(output(packet.messages))
  }
  const fixed = await services.processText(response((messages) => messages.length === 2 ? '{"99":"invalid"}' : '{"1":"hello world","2":"good day"}'),
    config, input, defaults(), 'correct', signal(), noProgress)
  assert.equal(fixed.cues[0].text, 'hello world')
  assert.equal(fixed.cues[0].original, 'helo world')
  assert.equal(fixed.cues[0].end, 550)
  assert.equal(seen.length, 2)
  const translated = await services.processText(response((messages) => messages[0].content.startsWith('复核')
    ? '{"1":{"native_translation":"译文一"},"2":{"native_translation":"译文二"}}' : '{"1":"初稿一","2":"初稿二"}'),
  config, input, defaults({ translator: 'llm', reflect: true }), 'translate', signal(), noProgress)
  assert.deepEqual(translated.cues.map((row) => row.translation), ['译文一', '译文二'])
  const recovered = await services.processText(response((messages) => {
    if (messages[0].content.startsWith('把字幕译为')) return messages.at(-1).content === 'helo world' ? '你好' : ''
    return 'invalid JSON'
  }), config, input, defaults({ translator: 'llm' }), 'translate', signal(), noProgress)
  assert.deepEqual(recovered.failed, ['2'])
  assert.equal(recovered.cues[0].translation, '你好')
  await assert.rejects(services.chat(() => assert.fail('unexpected network request'), credentials(), [], signal()), /填写 LLM Key/)
})

test('Microsoft, Google and DeepLX preserve response ordering and failed row markers', async () => {
  const input = captions.cleanCues([cue(0, 100, 'apple'), cue(150, 300, 'pear')])
  const config = credentials()
  config.settings.deeplx = 'http://127.0.0.1:9999/translate'
  for (const translator of ['bing', 'google', 'deeplx']) {
    const out = await services.processText(async (address, init) => {
      const url = new URL(address)
      if (url.hostname === 'edge.microsoft.com') return new Response('test-token')
      if (translator === 'bing') {
        assert.equal(url.searchParams.get('to'), 'zh-Hans')
        assert.equal(init.headers.Authorization, 'Bearer test-token')
        return json([{ translations: [{ text: '苹果' }] }, { translations: [] }])
      }
      if (translator === 'google') {
        assert.equal(url.searchParams.get('tl'), 'zh-CN')
        return new Response(url.searchParams.get('q') === 'apple' ? '<div class="result-container">苹果</div>' : '<div>empty</div>')
      }
      const body = JSON.parse(init.body)
      assert.equal(body.target_lang, 'ZH')
      return json(body.text === 'apple' ? { data: '苹果' } : {}, { status: body.text === 'apple' ? 200 : 400 })
    }, config, input, defaults({ translator, target: 'zh-Hans' }), 'translate', signal(), noProgress)
    assert.equal(out.cues[0].translation, '苹果')
    assert.deepEqual(out.failed, ['2'])
  }
})

test('Whisper API normalizes time units, and external CLI arguments reflect detected capabilities', async () => {
  const config = credentials({ whisperKey: 'fixture-whisper-key' })
  const words = await services.whisperApi((url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/audio/transcriptions')
    assert.equal(init.body.get('timestamp_granularities[]'), 'word')
    return json({ words: [{ word: 'caption', start: 0.019, end: 0.63 }] })
  }, Buffer.from('test'), config, 'auto', true, signal())
  assert.deepEqual(words.cues, [{ ...cue(19, 630, 'caption', 'word'), id: '1' }])
  const plain = await services.whisperApi(() => json({ text: 'caption only' }), Buffer.from('test'), config, 'auto', false, signal())
  assert.deepEqual(plain, { text: 'caption only', cues: [] })
  const local = { ...config.settings.local['whisper-cpp'], model: 'model.bin', vad: true, vadModel: 'vad.bin' }
  const program = media.whisperArguments('whisper-cpp', '--output-srt --output-file --no-gpu --vad-model --vad-threshold',
    local, 'file.wav', 'scratch', 'auto', true)
  assert.equal(program.words, false)
  assert.ok(program.args.includes('--vad-model'))
  assert.ok(program.args.includes('--no-gpu'))
  const faster = media.whisperArguments('faster-whisper', '--output_format --model --device --one_word --vad_filter',
    local, 'file.wav', 'scratch', 'auto', true)
  assert.equal(faster.words, true)
  assert.ok(faster.args.includes('--one_word'))
  assert.throws(() => media.whisperArguments('whisper-cpp', '--help', local, 'file.wav', 'scratch', 'auto', true), /缺少 SRT/)
})

test('external Windows Whisper launcher reads a real subprocess SRT and it can be cancelled', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await folder(t)
  const source = join(dir, 'Fixture.cs')
  const executable = join(dir, 'Fixture.exe')
  const model = join(dir, '模型.bin')
  const directory = join(dir, 'results')
  await mkdir(directory)
  await writeFile(model, 'fixture')
  await writeFile(source, [
    'using System; using System.IO; using System.Threading;',
    'class Fixture { public static void Main(string[] args) {',
    'if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--output-srt --output-file --no-gpu --vad-model"); return; }',
    'if (Array.Exists(args, value => value.Contains("slow.wav"))) { Thread.Sleep(30000); return; }',
    'File.WriteAllText(args[Array.IndexOf(args, "--output-file") + 1] + ".srt", "1\\n00:00:00,100 --> 00:00:00,700\\nfixture caption\\n");',
    '} }',
  ].join('\n'))
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath $env:W3F7_CAPTION_STUB_SOURCE) -OutputAssembly $env:W3F7_CAPTION_STUB_EXE -OutputType ConsoleApplication'],
  { windowsHide: true, env: { ...process.env, W3F7_CAPTION_STUB_SOURCE: source, W3F7_CAPTION_STUB_EXE: executable } })
  const program = { ...defaultCaptionSettings.local['whisper-cpp'], executable, model }
  const capabilities = await media.inspectWhisper('whisper-cpp', program, signal())
  assert.equal(capabilities.words, false)
  assert.equal(capabilities.vad, true)
  const [line] = await media.localWhisper('whisper-cpp', program, capabilities.help, join(dir, 'fast.wav'), directory, 'en', false, signal())
  assert.equal(line.text, 'fixture caption')
  await assert.rejects(media.localWhisper('whisper-cpp', program, capabilities.help,
    join(dir, 'slow.wav'), directory, 'en', false, AbortSignal.timeout(250)), /timeout|aborted/i)
})

test('settings hide and encrypt keys, preserve defaults and avoid credential reuse across hosts', async (t) => {
  const dir = await folder(t)
  const record = join(dir, 'settings.json')
  const crypto = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text) => Buffer.from('cipher:' + text),
    decryptStringAsync: async (buffer) => ({ result: buffer.toString().slice(7) }),
  }
  const config = new CaptionConfiguration(record, crypto, () => assert.fail('unexpected local executable selection'))
  await config.load()
  assert.equal(config.settings().llm.model, 'deepseek-flash')
  assert.equal(config.settings().llm.hasKey, false)
  await config.save({ ...config.settings(), llmKey: 'test-key' })
  assert.equal(config.settings().llm.hasKey, true)
  assert.ok(!(await readFile(record, 'utf8')).includes('test-key'))
  assert.equal((await config.credentials({ llm: true })).llmKey, 'test-key')
  assert.equal((await config.credentials({})).llmKey, '')
  const next = config.settings()
  next.llm.base = 'http://127.0.0.1:11434/v1'
  await config.save(next)
  assert.equal(config.settings().llm.hasKey, false)
})

function makeVideo(path) {
  ffmpeg('-f', 'lavfi', '-i', 'color=blue:size=320x240:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=800:duration=3',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-metadata:s:a:1', 'language=eng',
    '-c:v', 'libx264', '-c:a', 'aac', path)
}

async function settled(workspace, id, states) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const task = workspace.tasks().find((item) => item.id === id)
    if (states.includes(task?.state)) return task
    await wait(40)
  }
  assert.fail('task did not complete: ' + JSON.stringify(workspace.tasks().map(({ state, message }) => ({ state, message }))))
}

test('workspace supports multi-track import, batch, review, edit, VTT and soft and ASS hard outputs', async (t) => {
  const dir = await folder(t)
  const source = join(dir, '多音轨 样本.mp4')
  const sub = join(dir, '已有 字幕.srt')
  makeVideo(source)
  await writeFile(sub, '1\n00:00:00,300 --> 00:00:01,000\n测试\n\n2\n00:00:01,300 --> 00:00:02,000\nHello world\n')
  const request = bijianTransport()
  const removed = []
  const workspace = new TranscriptionWorkspace({
    dataDirectory: dir, settings: { credentials: async () => credentials() }, tools: async () => tools,
    request, outputDirectory: () => dir, authorize: () => {}, notify: () => {}, notifyRemoved: (id) => removed.push(id),
    render: async () => assert.fail('unexpected canvas'),
  })
  t.after(() => workspace.dispose())
  const imported = await workspace.importPaths([source, sub, join(dir, 'missing.mp4')])
  assert.equal(imported.errors.length, 1)
  const [video, subtitle] = imported.assets
  assert.deepEqual(video.tracks.map(({ index, language }) => [index, language]), [[1, 'und'], [2, 'eng']])
  const [job, original] = await workspace.create([
    { media: video.id, track: 2 }, { subtitle: subtitle.id, track: -1, mode: 'subtitles' },
  ], defaults({ review: true, split: 'original', formats: ['srt', 'vtt', 'json'] }))
  assert.throws(() => workspace.remove(job.id), /只能移除已结束/)
  const review = await settled(workspace, job.id, ['review', 'failed'])
  assert.equal(review.state, 'review', review.message)
  assert.equal(review.cues[0].text, 'This is test speech')
  assert.throws(() => workspace.remove(review.id), /只能移除已结束/)
  workspace.edit(review.id, review.revision, review.cues.map((line) => ({ ...line, text: '已校对' })))
  await settled(workspace, original.id, ['done'])
  workspace.finish(review.id, { container: 'mp4', synthesis: 'soft', layout: 'source-first' })
  const finished = await settled(workspace, job.id, ['done', 'failed'])
  assert.equal(finished.state, 'done', finished.message)
  assert.equal(finished.outputs.length, 4)
  const srt = workspace.locate(finished.outputs.find((item) => item.kind === 'srt').id)
  assert.match(await readFile(srt, 'utf8'), /已校对/)
  const probe = await media.probeMedia(tools, workspace.locate(finished.outputs.find((item) => item.kind === 'video').id), signal())
  assert.equal(probe.audio.length, 2)
  assert.equal(probe.streams.at(-1).codec_name, 'mov_text')
  workspace.finish(job.id, { container: 'mkv', synthesis: 'ass', layout: 'source-first' })
  const hard = await settled(workspace, job.id, ['done', 'failed'])
  assert.equal(hard.state, 'done', hard.message)
  assert.match(hard.outputs.at(-1).name, /\.mkv$/)
  const frame = (file, timestamp) => ffmpeg('-ss', timestamp, '-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'framehash', '-')
    .toString().split('\n').filter((row) => !row.startsWith('#')).find(Boolean)
  assert.notEqual(frame(source, '0.5'), frame(workspace.locate(hard.outputs.at(-1).id), '0.5'))
  assert.ok(!(await readdir(dir)).some((name) => /\.partial\./.test(name)))
  await workspace.preview(video.id)
  const preview = workspace.mediaSource(video.id, true).path
  const custom = join(dir, '新的缓存位置')
  await mkdir(custom)
  assert.ok((await workspace.changeCache(custom)).directory.startsWith(custom))
  assert.ok((await workspace.cacheStatus()).activeBytes > 0)
  await workspace.clearCache()
  assert.ok((await readFile(preview)).length > 0)
  workspace.remove(job.id)
  assert.deepEqual(removed, [job.id])
  assert.deepEqual(workspace.tasks().map((item) => item.id), [original.id])
  assert.ok(hard.outputs.every((item) => workspace.locate(item.id) === undefined))
  assert.match(await readFile(srt, 'utf8'), /已校对/)
  await workspace.clearCache()
  assert.equal(workspace.mediaSource(video.id, true), undefined)
  await assert.rejects(readFile(preview), { code: 'ENOENT' })
})

test('caption cache preserves active previews, remembers prior folders and confines cleanup to owned entries', async (t) => {
  const dir = await folder(t)
  const profile = join(dir, '测试 profile')
  const alternate = join(dir, '缓存 位置')
  const invalid = join(dir, '不可用位置')
  await mkdir(alternate)
  await mkdir(invalid)
  const cache = new CaptionCache(profile)
  const defaultStatus = await cache.status(new Set(), false)
  const legacy = join(defaultStatus.directory, 'session-Ab12cD', 'job-Qs2rer')
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'input.wav'), Buffer.alloc(5))
  await writeFile(join(defaultStatus.directory, 'settings.json'), 'settings sentinel')
  await writeFile(join(defaultStatus.directory, 'quota.json'), 'quota sentinel')
  await writeFile(join(alternate, 'keep.txt'), 'user file')
  await cache.change(alternate)
  const internal = await cache.recognitionDirectory()
  const cachedResult = join(internal, 'a'.repeat(64) + '.json')
  await writeFile(cachedResult, Buffer.alloc(6))
  await writeFile(cachedResult + '.12345678-1234-1234-1234-123456789abc.tmp', Buffer.alloc(4))
  await writeFile(join(internal, 'keep.txt'), 'foreign file')
  if (process.platform === 'win32') {
    await symlink(alternate, join(invalid, 'W3F7-Video-Toolsbar-transcription'), 'junction')
    await assert.rejects(cache.change(invalid), /不能是链接/)
    assert.ok((await cache.status(new Set(), false)).directory.startsWith(alternate))
  }
  await cache.change('')
  const reopened = new CaptionCache(profile)
  assert.deepEqual(await reopened.clear(new Set()), { released: 15, incomplete: false })
  await assert.rejects(readFile(join(legacy, 'input.wav')), { code: 'ENOENT' })
  await assert.rejects(readFile(cachedResult), { code: 'ENOENT' })
  assert.equal(await readFile(join(internal, 'keep.txt'), 'utf8'), 'foreign file')
  assert.equal(await readFile(join(alternate, 'keep.txt'), 'utf8'), 'user file')
  assert.equal(await readFile(join(defaultStatus.directory, 'settings.json'), 'utf8'), 'settings sentinel')
  assert.equal(await readFile(join(defaultStatus.directory, 'quota.json'), 'utf8'), 'quota sentinel')
})

test('recognition scratch is cleaned after rejected upload, cancellation and retry in the selected cache', async (t) => {
  const dir = await folder(t)
  const source = join(dir, 'sample.wav')
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', source)
  const alternate = join(dir, '选定缓存')
  await mkdir(alternate)
  let phase = 'reject'
  let uploadStarted
  const started = new Promise((resolve) => { uploadStarted = resolve })
  const fixture = bijianTransport()
  const workspace = new TranscriptionWorkspace({
    dataDirectory: join(dir, 'profile'), settings: { credentials: async () => credentials() }, tools: async () => tools,
    outputDirectory: () => dir, authorize: () => {}, notify: () => {}, render: async () => assert.fail('unexpected render'),
    request: async (address, init) => {
      if (phase === 'reject') return new Response(null, { status: 412 })
      if (phase === 'cancel') { uploadStarted(); await wait(5000, undefined, { signal: init.signal }) }
      return fixture(address, init)
    },
  })
  t.after(() => workspace.dispose())
  const directory = (await workspace.changeCache(alternate)).directory
  const { assets: [asset] } = await workspace.importPaths([source])
  const [job] = await workspace.create([{ media: asset.id, track: 0 }], defaults({ mode: 'transcribe' }))
  await settled(workspace, job.id, ['failed'])
  const session = join(directory, (await readdir(directory)).find((name) => name.startsWith('session-')))
  assert.deepEqual(await readdir(session), [])
  phase = 'cancel'
  workspace.retry(job.id)
  await started
  assert.throws(() => workspace.clearCache(), /请等待转录/)
  assert.ok((await readdir(session)).some((name) => name.startsWith('job-')))
  await workspace.cancel(job.id)
  await settled(workspace, job.id, ['cancelled'])
  assert.deepEqual(await readdir(session), [])
  phase = 'success'
  workspace.retry(job.id)
  const terminal = await settled(workspace, job.id, ['done', 'warning', 'failed'])
  assert.equal(terminal.state, 'done', terminal.message)
  assert.deepEqual(await readdir(session), [])
  assert.ok((await readdir(join(directory, 'asr'))).some((name) => name.endsWith('.json')))
})

test('rounded compositing honors overlay timestamps and clears the finished caption', async (t) => {
  const dir = await folder(t)
  const input = join(dir, 'scene.mp4')
  const output = join(dir, 'output.mp4')
  const scratch = join(dir, 'scratch')
  await mkdir(scratch)
  makeVideo(input)
  const info = await media.probeMedia(tools, input, signal())
  await media.synthesize(tools, input, info, [cue(500, 1250, 'round')], defaults({ synthesis: 'rounded' }), scratch, output,
    async ({ states, width, height }, emit) => {
      for (let index = 0; index < states.length; index++) {
        const base = 'color=c=black@0.0:s=' + width + 'x' + height + ',format=rgba'
        const png = ffmpeg('-f', 'lavfi', '-i', base, ...(states[index].length ? ['-vf', 'drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:replace=1'] : []),
          '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', '-')
        await emit(index, png)
      }
    }, signal(), noProgress)
  const pixel = (time) => [...ffmpeg('-ss', String(time), '-i', output, '-vf', 'scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-')]
  const before = pixel(0.2)
  const during = pixel(0.8)
  const after = pixel(1.6)
  assert.ok(before[2] > 200 && during[0] > 200 && after[2] > 200, JSON.stringify({ before, during, after }))
})

test('ASS hard subtitles retain rotation and variable-rate video timing', async (t) => {
  const dir = await folder(t)
  const raw = join(dir, 'vfr.mp4')
  const rotated = join(dir, '旋转 vfr.mp4')
  const output = join(dir, 'output.mp4')
  ffmpeg('-f', 'lavfi', '-i', 'color=blue:size=320x240:rate=25:duration=2',
    '-itsoffset', '0.25', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1.5',
    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'select=not(eq(mod(n\\,5)\\,1))', '-fps_mode', 'vfr',
    '-c:v', 'libx264', '-c:a', 'aac', raw)
  ffmpeg('-display_rotation', '90', '-i', raw, '-c', 'copy', rotated)
  const info = await media.probeMedia(tools, rotated, signal())
  assert.deepEqual([info.width, info.height], [240, 320])
  assert.ok(Number(info.audio[0].start_time) > 0.15)
  await media.synthesize(tools, rotated, info, [cue(500, 1100, '字幕')], defaults({ synthesis: 'ass' }), dir, output,
    async () => assert.fail('ASS cannot use Canvas'), signal(), noProgress)
  const after = await media.probeMedia(tools, output, signal())
  assert.deepEqual([after.width, after.height], [240, 320])
  assert.ok(Math.abs(Number(after.audio[0].start_time) - Number(info.audio[0].start_time)) < 0.03)
  const timings = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path], { windowsHide: true }))
    .frames.map((frame) => Math.round(Number(frame.best_effort_timestamp_time) * 1000))
  assert.deepEqual(timings(output), timings(rotated))
})

test('a failed batch member does not stop a real 20-minute audio extraction and three fixture recognition requests', async (t) => {
  const dir = await folder(t)
  const bad = join(dir, 'missing after import.wav')
  const long = join(dir, '长文件.flac')
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=333:sample_rate=16000', '-t', '1', bad)
  ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1220', '-c:a', 'flac', long)
  const requests = []
  const workspace = new TranscriptionWorkspace({
    dataDirectory: dir, settings: { credentials: async () => credentials() }, tools: async () => tools,
    request: bijianTransport({ requests }), outputDirectory: () => dir, authorize: () => {}, notify: () => {},
    render: async () => assert.fail('audio cannot render a video'),
  })
  const { assets } = await workspace.importPaths([bad, long])
  await rm(bad)
  try {
    const [failed, done] = await workspace.create(assets.map((asset) => ({ media: asset.id, track: 0 })), defaults({ mode: 'transcribe' }))
    const first = await settled(workspace, failed.id, ['failed', 'done'])
    const second = await settled(workspace, done.id, ['failed', 'done', 'warning'])
    assert.equal(first.state, 'failed')
    assert.equal(second.state, 'done', second.message)
    assert.equal(requests.filter((entry) => entry[2] === 'task').length, 3)
    assert.deepEqual(second.cues.map(({ start }) => start), [100, 590100, 1180100])
    assert.equal(second.outputs[0].kind, 'srt')
  } finally { await workspace.dispose() }
})

test('optional live smoke checks no-key 必剪 to a real SRT', { skip: process.env.W3F7_CAPTION_LIVE !== '1' }, async (t) => {
  const dir = await folder(t)
  const wav = join(dir, '合成语音.wav')
  const mp3 = join(dir, '合成语音.mp3')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.SetOutputToWaveFile($env:W3F7_CAPTION_WAVE); $voice.Speak('This is a synthetic test for the subtitle workspace. The software prepares a short caption.'); $voice.Dispose()"],
  { windowsHide: true, env: { ...process.env, W3F7_CAPTION_WAVE: wav } })
  ffmpeg('-i', wav, '-ar', '16000', '-ac', '1', '-b:a', '48k', mp3)
  const data = await services.bijian(fetch, await readFile(mp3), true, AbortSignal.timeout(80_000), noProgress, new Map(), 'live', async () => {})
  const srt = captions.serializeCaptions(captions.splitWithRules(captions.wordCues(data), { cjk: 12, words: 18 }), 'srt', 'source')
  const output = join(dir, '验证.srt')
  await writeFile(output, srt)
  const result = await media.readSubtitle(output)
  assert.match(result.map((line) => line.text).join(' '), /synthetic test|subtitle workspace/i)
})
