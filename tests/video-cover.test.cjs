const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { test } = require('node:test')

const core = resolve(__dirname, '../core/cover.ps1')
const batch = resolve(__dirname, '../W3F7-Video-Cover.bat')
const systemPowerShell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, ...options })
  assert.ifError(result.error)
  return result
}

function ffmpeg(...args) {
  const result = command('ffmpeg.exe', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args])
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function probe(file, options = []) {
  const result = command('ffprobe.exe', ['-v', 'error', ...options, '-of', 'json', file])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function exportCover(video, cover, outputDirectory, mode, failure) {
  const result = command(systemPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', core, '-Json'], {
    env: { ...process.env, W3F7_MEDIA_REQUEST: JSON.stringify({ operation: 'export', video, cover, outputDirectory, mode }) },
  })
  const events = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const last = events.at(-1)
  if (failure) {
    assert.equal(result.status, 1, result.stderr)
    assert.equal(last.type, 'error')
    assert.match(last.message, failure)
    assert.ok(!readdirSync(outputDirectory).some(name => name.includes('.partial.mp4')))
    return
  }
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(last.type, 'result')
  assert.ok(existsSync(last.path))
  return last.path
}

const videoTrack = info => info.streams.find(stream => stream.codec_type === 'video' && !stream.disposition.attached_pic)
const attached = info => info.streams.filter(stream => stream.disposition.attached_pic)
const readInfo = path => probe(path, ['-show_streams', '-show_chapters'])
const timeOf = frame => Number(frame.best_effort_timestamp_time)
const streamHash = (path, stream) => ffmpeg('-i', path, '-map', '0:' + stream.index, '-c', 'copy', '-f', 'streamhash', '-hash', 'SHA256', '-').trim()

function videoFrames(path, index) {
  return probe(path, ['-select_streams', String(index), '-show_frames', '-show_entries', 'frame=key_frame,best_effort_timestamp_time']).frames
}

function framePixels(file, index, count) {
  const result = command('ffmpeg.exe', ['-v', 'error', '-i', file, '-map', '0:' + index, '-frames:v', String(count),
    '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  assert.equal(result.status, 0, result.stderr.toString())
  return result.stdout
}

function pixelDifference(a, b) {
  assert.equal(a.length, b.length)
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length
}

function subtitlePackets(path, index) {
  return probe(path, ['-select_streams', String(index), '-show_packets', '-show_data_hash', 'sha256']).packets
    .filter(packet => Number(packet.size) > 2)
}

function picturePacketHashes(path, index) {
  const data = ffmpeg('-i', path, '-map', '0:' + index, '-c:v', 'copy', '-bsf:v', 'filter_units=pass_types=1-5', '-f', 'framehash', '-')
  return data.split(/\r?\n/).filter(line => /^\d+,/.test(line)).map(line => line.split(',')[5].trim())
}

function checkFrameSequence(source, output, coverAtSameSize) {
  const input = videoTrack(readInfo(source))
  const result = videoTrack(readInfo(output))
  const sourceFrames = videoFrames(source, input.index)
  const resultFrames = videoFrames(output, result.index)
  assert.equal(resultFrames.length, sourceFrames.length + 1)
  assert.equal(result.codec_name, 'h264')
  assert.equal(result.codec_tag_string, 'avc3')
  assert.deepEqual(picturePacketHashes(output, result.index).slice(1), picturePacketHashes(source, input.index), 'original coded pictures are copied')
  assert.equal(resultFrames[0].key_frame, 1)
  assert.equal(timeOf(resultFrames[0]), 0)
  const offset = timeOf(resultFrames[1])
  assert.ok(offset > 0)
  for (const [index, frame] of sourceFrames.entries()) {
    assert.ok(Math.abs(timeOf(resultFrames[index + 1]) - timeOf(frame) + timeOf(sourceFrames[0]) - offset) < 0.000003)
  }
  const size = result.width * result.height * 3
  const frames = framePixels(output, result.index, 2)
  assert.ok(frames.subarray(size).equals(framePixels(source, input.index, 1)), 'second frame is the unchanged first source frame')
  if (coverAtSameSize) {
    assert.ok(pixelDifference(frames.subarray(0, size), framePixels(coverAtSameSize, 0, 1)) < 8, 'first frame is the selected image')
  }
  return offset
}

test('MP4 cover modes and interactive BAT share the Windows export core', { skip: process.platform !== 'win32' }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'W3F7 首帧 验收-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const video = join(directory, '横屏样片.mp4')
  const cover = join(directory, '蓝色封面.png')
  const jpg = join(directory, '竖屏封面.jpg')
  const captions = join(directory, 'captions.srt')
  const chapters = join(directory, 'chapters.txt')
  writeFileSync(captions, '1\n00:00:00,100 --> 00:00:00,250\n第一条\n\n2\n00:00:00,350 --> 00:00:00,500\n第二条\n')
  writeFileSync(chapters, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=300\ntitle=第一章\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=300\nEND=600\ntitle=第二章\n')
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.6',
    '-f', 'lavfi', '-i', 'sine=frequency=392:sample_rate=48000:d=0.6', '-i', captions, '-f', 'ffmetadata', '-i', chapters,
    '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map_chapters', '3', '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text',
    '-timecode', '01:00:00:00', video)
  ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', '-update', '1', cover)
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=90x160', '-frames:v', '1', '-update', '1', jpg)
  const original = readInfo(video)

  await t.test('default embeds the original image and preserves audio, video, chapters and timecode', () => {
    const result = exportCover(video, cover, directory)
    assert.equal(basename(result), '横屏样片_cover.mp4')
    const info = readInfo(result)
    assert.equal(attached(info).length, 1)
    assert.equal(streamHash(result, attached(info)[0]).split('=').at(-1), streamHash(cover, { index: 0 }).split('=').at(-1))
    for (const kind of ['audio', 'video', 'subtitle']) {
      assert.equal(streamHash(result, info.streams.find(x => x.codec_type === kind)), streamHash(video, original.streams.find(x => x.codec_type === kind)))
    }
    const chapterTimes = timeline => timeline.map(({ start_time, end_time, tags }) => [start_time, end_time, tags.title])
    assert.deepEqual(chapterTimes(info.chapters), chapterTimes(original.chapters))
    assert.ok(info.streams.some(x => x.codec_tag_string === 'tmcd' && x.tags.timecode === '01:00:00:00'))
  })

  await t.test('first-frame only inserts one frame and shifts audio, dialogue and chapters', () => {
    const result = exportCover(video, cover, directory, 'first-frame')
    assert.equal(basename(result), '横屏样片_firstframe.mp4')
    const info = readInfo(result)
    assert.equal(attached(info).length, 0)
    assert.ok(!info.streams.some(x => x.codec_tag_string === 'tmcd'))
    const delta = checkFrameSequence(video, result, cover)
    assert.ok(Math.abs(delta - 1 / 30) < 0.000002)
    const originalAudio = original.streams.find(x => x.codec_type === 'audio')
    const newAudio = info.streams.find(x => x.codec_type === 'audio')
    assert.equal(streamHash(result, newAudio), streamHash(video, originalAudio))
    const sourceSamples = videoFrames(video, originalAudio.index)
    const newSamples = videoFrames(result, newAudio.index)
    assert.ok(Math.abs(timeOf(newSamples[0]) - timeOf(sourceSamples[0]) - delta) < 0.00003)
    const subtitles = subtitlePackets(video, original.streams.find(x => x.codec_type === 'subtitle').index)
    const shiftedSubtitles = subtitlePackets(result, info.streams.find(x => x.codec_type === 'subtitle').index)
    assert.equal(shiftedSubtitles.length, subtitles.length)
    for (const [index, packet] of subtitles.entries()) {
      assert.equal(shiftedSubtitles[index].data_hash, packet.data_hash)
      assert.ok(Math.abs(Number(shiftedSubtitles[index].pts_time) - Number(packet.pts_time) - delta) < 0.001)
    }
    assert.equal(info.chapters.length, original.chapters.length + 1)
    assert.equal(info.chapters[0].tags.title, '封面帧')
    assert.ok(Math.abs(Number(info.chapters[0].end_time) - delta) < 0.001)
    for (const [index, chapter] of original.chapters.entries()) {
      const shifted = info.chapters[index + 1]
      assert.equal(shifted.tags.title, chapter.tags.title)
      assert.ok(Math.abs(Number(shifted.start_time) - Number(chapter.start_time) - delta) < 0.001)
      assert.ok(Math.abs(Number(shifted.end_time) - Number(chapter.end_time) - delta) < 0.001)
    }
  })

  await t.test('a single frame and the original JPEG replace an old attachment in a silent rotated VFR clip', () => {
    const unrotated = join(directory, '无声.mp4')
    const portrait = join(directory, '竖屏变帧率.mp4')
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=0.6', '-vf', 'select=not(eq(mod(n\\,3)\\,1))', '-fps_mode', 'passthrough', '-c:v', 'libx264', unrotated)
    ffmpeg('-display_rotation', '90', '-i', unrotated, '-i', cover, '-map', '0:v:0', '-map', '1:v:0',
      '-c', 'copy', '-disposition:v:1', 'attached_pic', portrait)
    const input = readInfo(portrait)
    const frameTimes = videoFrames(portrait, videoTrack(input).index).map(timeOf)
    assert.ok(new Set(frameTimes.slice(1).map((time, i) => Math.round((time - frameTimes[i]) * 1000))).size > 1)
    const both = exportCover(portrait, jpg, directory, 'both')
    assert.equal(basename(both), '竖屏变帧率_cover_firstframe.mp4')
    const info = readInfo(both)
    const main = videoTrack(info)
    assert.deepEqual([main.width, main.height], [160, 90])
    assert.ok(main.side_data_list.some(side => side.rotation === 90))
    assert.equal(info.streams.filter(stream => stream.codec_type === 'audio').length, 0)
    const pictures = attached(info)
    assert.equal(pictures.length, 1)
    assert.equal(pictures[0].codec_name, 'mjpeg')
    assert.equal(streamHash(both, pictures[0]).split('=').at(-1), streamHash(jpg, { index: 0 }).split('=').at(-1))
    checkFrameSequence(portrait, both, jpg)
    const first = exportCover(portrait, jpg, directory, 'first-frame')
    assert.equal(attached(readInfo(first)).length, 0)
  })

  await t.test('incompatible sources and invalid modes can be retried with the default', () => {
    const hdr = join(directory, 'HDR.mp4')
    ffmpeg('-i', video, '-map', '0:v:0', '-map_chapters', '-1', '-c:v', 'libx264',
      '-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', hdr)
    assert.equal(videoTrack(readInfo(hdr)).color_transfer, 'smpte2084')
    const before = readFileSync(hdr)
    exportCover(hdr, cover, directory, 'first-frame', /HDR/)
    exportCover(hdr, cover, directory, 'unsupported', /有效的封面方式/)
    const result = exportCover(hdr, cover, directory, 'embedded')
    assert.equal(attached(readInfo(result)).length, 1)
    assert.ok(readFileSync(hdr).equals(before))
    assert.equal(basename(exportCover(hdr, cover, directory, 'embedded')), 'HDR_cover_2.mp4')
  })

  await t.test('BAT displays the author and accepts all three menu choices', () => {
    const batPath = join(directory, basename(batch))
    copyFileSync(batch, batPath)
    for (const [input, suffix] of [['\r\n', '_cover_2'], ['9\r\n2\r\n', '_firstframe_2'], ['3\r\n', '_cover_firstframe']]) {
      const result = command('cmd.exe', ['/d', '/s', '/c', '""' + batPath + '" "' + video + '" "' + cover + '""'], {
        windowsVerbatimArguments: true,
        input,
        env: { ...process.env, W3F7_NO_PAUSE: '1' },
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /https:\/\/github\.com\/PowerT-0704/)
      const info = readInfo(join(directory, '横屏样片' + suffix + '.mp4'))
      assert.equal(attached(info).length, suffix.startsWith('_firstframe') ? 0 : 1)
    }
  })
})
