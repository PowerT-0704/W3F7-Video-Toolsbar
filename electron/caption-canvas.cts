import { BrowserWindow } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import type { OverlayInput, RenderOverlay } from './caption-media.cjs'

interface CanvasFrame extends Omit<OverlayInput, 'states'> {
  lines: string[]
  fontData: string
}

async function drawFrame(input: CanvasFrame) {
  const { style, width, height } = input
  let canvas = document.querySelector('canvas')
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    document.body.append(canvas)
  }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)
  if (input.fontData && ![...document.fonts].some((font) => font.family === 'W3F7LocalSubtitle')) {
    const font = await new FontFace('W3F7LocalSubtitle', 'url(data:font/ttf;base64,' + input.fontData + ')').load()
    document.fonts.add(font)
  }
  if (input.lines.length) {
    const scale = Math.min(width / 1920, height / 1080)
    const size = Math.max(10, Math.round(style.size * scale))
    const padding = Math.max(3, style.padding * scale)
    const spacing = style.spacing * scale
    const lineHeight = size * 1.25 + spacing
    const font = input.fontData ? 'W3F7LocalSubtitle' : style.font.replace(/["\\\r\n]/g, '')
    ctx.font = size + 'px "' + font + '", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const maxWidth = width * 0.9 - padding * 2
    const lines: string[] = []
    for (const row of input.lines) {
      let line = ''
      for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(row)) {
        if (line && ctx.measureText(line + part.segment).width > maxWidth) { lines.push(line.trim()); line = '' }
        line += part.segment
      }
      lines.push(line.trim())
    }
    const boxWidth = Math.min(width, Math.max(...lines.map((line) => ctx.measureText(line).width)) + 2 * padding)
    const boxHeight = lines.length * lineHeight + 2 * padding
    const top = Math.max(0, height - style.bottom * scale - boxHeight)
    ctx.fillStyle = style.background
    ctx.globalAlpha = style.opacity / 100
    ctx.beginPath()
    ctx.roundRect((width - boxWidth) / 2, top, boxWidth, boxHeight, style.radius * scale)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = style.color
    for (const [index, line] of lines.entries()) ctx.fillText(line, width / 2, top + padding + (index + 0.5) * lineHeight, maxWidth)
  }
  return canvas.toDataURL('image/png').split(',')[1]
}

export const renderCaptionOverlay: RenderOverlay = async (input, emit, signal) => {
  signal.throwIfAborted()
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  })
  const stop = () => { if (!window.isDestroyed()) window.destroy() }
  signal.addEventListener('abort', stop, { once: true })
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body></body></html>'))
    let fontData = ''
    if (input.style.fontFile) {
      if ((await stat(input.style.fontFile)).size > 32 * 1024 ** 2) throw new Error('字体文件超过 32 MiB。')
      fontData = (await readFile(input.style.fontFile)).toString('base64')
    }
    await window.webContents.executeJavaScript('globalThis.drawW3F7Subtitle = (' + drawFrame.toString() + '); void 0')
    for (const [index, lines] of input.states.entries()) {
      signal.throwIfAborted()
      const data = { lines, width: input.width, height: input.height, style: { ...input.style, fontFile: undefined }, fontData: index === 0 ? fontData : '' }
      const code = 'globalThis.w3f7SubtitleFont ??= ' + JSON.stringify(data.fontData) +
        '; globalThis.drawW3F7Subtitle({...' + JSON.stringify({ ...data, fontData: '' }) + ', fontData: globalThis.w3f7SubtitleFont})'
      const bytes = await window.webContents.executeJavaScript(code) as string
      await emit(index, Buffer.from(bytes, 'base64'))
    }
  } finally {
    signal.removeEventListener('abort', stop)
    stop()
  }
}
