const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtemp, open, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { MusicWorkspace } = require('../dist-electron/music.cjs')
const { decodeLrc, scanMusicTags } = require('../dist-electron/music-tags.cjs')

const tool = async () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', version: 'fixture' })
const text = '[ti:测试]\r\n[00:01.123]中文 & #;= \\ 字幕 🎵\r\n[00:02.012]Second line\r\n'
const oldLyric = '[00:00.001]Old lyrics'

function ffmpeg(...args) {
  return execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true })
}

function streamHashes(path) {
  return ffmpeg('-i', path, '-map', '0', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', 'pipe:1').toString()
}

function audioHash(path) {
  return ffmpeg('-i', path, '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', 'pipe:1').toString()
}

function hash(data) { return createHash('sha256').update(data).digest('hex') }

function syncSafe(value) {
  return Buffer.from([value >>> 21 & 127, value >>> 14 & 127, value >>> 7 & 127, value & 127])
}

function tagSize(data) {
  return data.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0)
}

function frame(id, body, version) {
  const header = Buffer.alloc(10)
  header.write(id, 'ascii')
  if (version === 4) syncSafe(body.length).copy(header, 4)
  else header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

function appendBeforeId3Frames(data, frames) {
  assert.equal(data.subarray(0, 3).toString(), 'ID3')
  const header = Buffer.from(data.subarray(0, 10))
  syncSafe(tagSize(data) + frames.length).copy(header, 6)
  return Buffer.concat([header, frames, data.subarray(10)])
}

test('LRC import supports UTF-8, UTF-16 BOMs, and GB18030', () => {
  assert.equal(decodeLrc(Buffer.from(text)), text)
  assert.equal(decodeLrc(Buffer.from('\ufeff' + text)), text)
  assert.equal(decodeLrc(Buffer.from('\ufeff' + text, 'utf16le')), text)
  assert.equal(decodeLrc(Buffer.from('\ufeff' + text, 'utf16le').swap16()), text)
  assert.equal(decodeLrc(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文')
  assert.throws(() => decodeLrc(Buffer.from([0xef, 0xbb, 0xbf, 0xff])), /编码/)
  assert.throws(() => decodeLrc(Buffer.from(' ')), /为空/)
})

test('timed lyric selection supports offsets, repeated timestamps, and merged lines', async () => {
  const { parseTimedLyrics, lyricAt } = await import('../src/pages/music-lyrics.ts')
  const rows = parseTimedLyrics('[offset:+100]\r\n[00:02.50][00:00.5]中文\r\n[00:02.500]Translation\r\n[00:05]Next')
  assert.deepEqual(rows, [{ time: 400, text: '中文' }, { time: 2400, text: '中文\nTranslation' }, { time: 4900, text: 'Next' }])
  assert.equal(lyricAt(rows, 399), -1)
  assert.equal(lyricAt(rows, 2400), 1)
  assert.equal(lyricAt(rows, 5000), 2)
  assert.deepEqual(parseTimedLyrics('Plain lyrics\nAnother line'), [])
})

test('music selection, original cover/lyric export, and verified audio copies', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'W3F7 音乐验收 '))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const front = join(folder, '正面.png')
  const back = join(folder, '背面.jpg')
  const replacement = join(folder, '新封面.png')
  const lrc = join(folder, '本地 歌词.lrc')
  await writeFile(lrc, Buffer.from('\ufeff' + text, 'utf16le'))
  ffmpeg('-f', 'lavfi', '-i', 'color=red:s=32x32', '-frames:v', '1', '-threads', '1', front)
  ffmpeg('-f', 'lavfi', '-i', 'color=blue:s=48x32', '-frames:v', '1', '-threads', '1', back)
  ffmpeg('-f', 'lavfi', '-i', 'color=green:s=40x40', '-frames:v', '1', '-threads', '1', replacement)
  const newPicture = { data: await readFile(replacement), mime: 'image/png', size: 40, depth: 24 }

  for (const { format, version } of [{ format: 'flac' }, { format: 'mp3', version: 3 }, { format: 'mp3', version: 4 }]) {
    await t.test(version ? 'MP3 ID3v2.' + version : 'FLAC Vorbis Comment', async () => {
      const stem = format + (version ?? '')
      const source = join(folder, stem + '.' + format)
      const output = join(folder, stem + '_歌词.' + format)
      const savedFront = join(folder, stem + '_封面.png')
      const savedBack = join(folder, stem + '_封面.jpg')
      const savedLyric = join(folder, stem + '_原歌词.lrc')
      const exportedLyric = join(folder, stem + '_导出.lrc')
      const audioCodec = version ? ['-c:a', 'libmp3lame', '-id3v2_version', String(version)] : ['-c:a', 'flac']
      ffmpeg('-f', 'lavfi', '-i', 'sine=d=0.3', '-i', back, '-i', front, '-map', '0:a', '-map', '1:v', '-map', '2:v',
        ...audioCodec, '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v:0', 'comment=Cover (back)',
        '-metadata:s:v:1', 'comment=Cover (front)', '-metadata', 'title=Test title',
        '-metadata', 'UNSYNCEDLYRICS=Legacy lyrics', source)
      if (version) {
        const uslt = frame('USLT', Buffer.from('\x00eng\x00' + oldLyric, 'latin1'), version)
        const sylt = frame('SYLT', Buffer.concat([Buffer.from('\x00eng\x02\x01\x00Sync\x00', 'latin1'), Buffer.from([0, 0, 4, 210])]), version)
        const customUslt = frame('TXXX', Buffer.from('\x00USLT\x00Alternate lyrics', 'latin1'), version)
        await writeFile(source, appendBeforeId3Frames(await readFile(source), Buffer.concat([uslt, sylt, customUslt])))
      }
      const original = await readFile(source)
      const workspace = new MusicWorkspace()
      const { audio, imported } = await workspace.select([source, lrc], tool)
      assert.equal(audio.format, format)
      assert.equal(imported.text, text)
      assert.equal(audio.lyrics[0], version ? oldLyric : 'Legacy lyrics')
      if (version) assert.deepEqual(audio.lyrics, [oldLyric, '[00:01.234]Sync', 'Alternate lyrics', 'Legacy lyrics'])
      assert.equal(audio.covers.length, 2)
      assert.equal(audio.covers[0].label, '正面封面')
      assert.equal(audio.writeIssue, undefined)
      const response = await workspace.playback(audio.id, new Request(audio.playback, { headers: { Range: 'bytes=24-123' } }))
      assert.equal(response.status, 206)
      assert.equal(response.headers.get('Content-Type'), version ? 'audio/mpeg' : 'audio/flac')
      assert.equal(response.headers.get('Content-Range'), 'bytes 24-123/' + original.length)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(24, 124))
      await workspace.saveCover(audio.id, audio.covers[0].index, savedFront)
      await workspace.saveCover(audio.id, audio.covers[1].index, savedBack)
      assert.equal(hash(await readFile(savedFront)), hash(await readFile(front)))
      assert.equal(hash(await readFile(savedBack)), hash(await readFile(back)))
      await workspace.saveLyric(audio.id, 0, savedLyric)
      assert.equal(await readFile(savedLyric, 'utf8'), version ? oldLyric : 'Legacy lyrics')
      const lyricsOnly = { lyricId: imported.id }
      await assert.rejects(workspace.export(audio.id, lyricsOnly, source, await tool()), /副本/)
      await assert.rejects(workspace.export(audio.id, lyricsOnly, join(folder, '不存在', '文件.' + format), await tool()), { code: 'ENOENT' })
      assert.equal(await workspace.export(audio.id, lyricsOnly, output, await tool()), output)
      assert.equal(streamHashes(source), streamHashes(output))
      assert.equal(hash(await readFile(source)), hash(original))
      if (version) {
        const result = await readFile(output)
        assert.equal(result[3], version)
        assert.deepEqual(result.subarray(10 + tagSize(result)), original.subarray(10 + tagSize(original)))
        assert.ok(result.subarray(10, 10 + tagSize(result)).includes(Buffer.from('USLT')))
      }
      const { draft } = workspace.stageCover(audio.id, '新封面.png', newPicture)
      const coverOnly = { coverId: draft.id }
      const reader = new MusicWorkspace()
      for (const [name, changes, lyrics] of [['仅封面', coverOnly, audio.lyrics], ['封面歌词', { ...coverOnly, ...lyricsOnly }, [text]]]) {
        const copy = join(folder, stem + '_' + name + '.' + format)
        assert.equal(await workspace.export(audio.id, changes, copy, await tool()), copy)
        assert.equal(audioHash(copy), audioHash(source))
        const checked = (await reader.select([copy], tool)).audio
        assert.deepEqual(checked.lyrics, lyrics)
        assert.equal(checked.covers.length, 2)
        assert.equal(checked.covers[0].label, '正面封面')
        assert.equal(checked.covers[0].width, 40)
        const picture = await reader.preview(checked.id, checked.covers[0].index)
        assert.equal(hash(Buffer.from(await picture.arrayBuffer())), hash(newPicture.data))
        const preserved = await reader.preview(checked.id, checked.covers[1].index)
        assert.equal(hash(Buffer.from(await preserved.arrayBuffer())), hash(await readFile(back)))
      }
      assert.equal(hash(await readFile(source)), hash(original))
      const reopened = await workspace.select([output], tool)
      assert.deepEqual(reopened.audio.lyrics, [text])
      assert.equal(reopened.imported, undefined)
      assert.equal(reopened.draft, undefined)
      assert.equal((await workspace.preview(audio.id, audio.covers[0].index)).status, 404)
      assert.equal((await workspace.playback(audio.id, new Request(audio.playback))).status, 404)
      await workspace.saveLyric(reopened.audio.id, 0, exportedLyric)
      assert.equal(await readFile(exportedLyric, 'utf8'), text)
      assert.ok(!(await readdir(folder)).some((name) => name.startsWith('.w3f7-music-')))
    })
  }

  await t.test('tagless MP3 and malformed SYLT', async () => {
    const source = join(folder, '无标签.mp3')
    const output = join(folder, '新增 ID3.mp3')
    ffmpeg('-f', 'lavfi', '-i', 'sine=d=0.3', '-c:a', 'libmp3lame', '-id3v2_version', '0', source)
    const workspace = new MusicWorkspace()
    const { audio, imported } = await workspace.select([source, lrc], tool)
    assert.deepEqual(audio.lyrics, [])
    assert.deepEqual(audio.covers, [])
    await workspace.export(audio.id, { lyricId: imported.id }, output, await tool())
    const tagged = await readFile(output)
    assert.equal(tagged.subarray(0, 4).toString('hex'), '49443303')
    const wrongTimebase = frame('SYLT', Buffer.from('\x00eng\x01\x01\x00Line\x00\x00\x00\x01\x00', 'latin1'), 3)
    const broken = frame('SYLT', Buffer.from('\x00eng\x02\x01\x00Line\x00', 'latin1'), 3)
    await writeFile(output, appendBeforeId3Frames(tagged, Buffer.concat([wrongTimebase, broken])))
    const handle = await open(output)
    try {
      const tags = await scanMusicTags(handle, (await handle.stat()).size, 'mp3')
      assert.deepEqual(tags.lyrics, [text])
      assert.match(tags.warning, /无法解码/)
      assert.match(tags.lyricWriteIssue, /无法安全替换/)
    } finally { await handle.close() }
  })

  await t.test('FLAC without a Vorbis Comment block', async () => {
    const source = join(folder, '无注释.flac')
    const output = join(folder, '新增注释.flac')
    ffmpeg('-f', 'lavfi', '-i', 'sine=d=0.3', '-c:a', 'flac', source)
    const original = await readFile(source)
    const streamInfo = Buffer.from(original.subarray(0, 42))
    streamInfo[4] |= 0x80
    let offset = 4
    for (;;) {
      const last = Boolean(original[offset] & 0x80)
      offset += 4 + original.readUIntBE(offset + 1, 3)
      if (last) break
    }
    await writeFile(source, Buffer.concat([streamInfo, original.subarray(offset)]))
    const workspace = new MusicWorkspace()
    const { audio, imported } = await workspace.select([source, lrc], tool)
    assert.deepEqual(audio.lyrics, [])
    await workspace.export(audio.id, { lyricId: imported.id }, output, await tool())
    assert.equal(streamHashes(source), streamHashes(output))
    assert.deepEqual((await workspace.select([output], tool)).audio.lyrics, [text])
  })
})
