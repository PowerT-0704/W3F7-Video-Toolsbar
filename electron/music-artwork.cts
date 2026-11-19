import { nativeImage, type NativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { MusicImage, SquareCrop } from '../src/bridge'
import { readBytes, type EmbeddedCover } from './music-tags.cjs'

const maxEdge = 1000
const maxBytes = 1024 * 1024
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function coverMime(data: Buffer, ext: string): EmbeddedCover['mime'] {
  if (ext === '.png' && data.subarray(0, 8).equals(pngSignature)) return 'image/png'
  if ((ext === '.jpg' || ext === '.jpeg') && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  throw new Error('图片格式与扩展名不符，请选择 JPG、JPEG 或 PNG。')
}

function compressSquare(image: NativeImage, mime: EmbeddedCover['mime'], maximum: number): EmbeddedCover {
  let size = Math.min(maximum, maxEdge)
  for (;;) {
    const scaled = size === maximum ? image : image.resize({ width: size, height: size, quality: 'best' })
    if (scaled.isEmpty()) throw new Error('无法缩放这张封面。')
    if (mime === 'image/png') {
      const data = scaled.toPNG()
      if (data.length && data.length <= maxBytes) {
        // IHDR stores bits per channel and color type.
        const channels = data[25] === 6 ? 4 : data[25] === 4 ? 2 : data[25] === 2 ? 3 : 1
        return { data, mime, size, depth: data[24] * channels }
      }
    } else {
      for (const quality of [90, 82, 74, 66]) {
        const data = scaled.toJPEG(quality)
        if (data.length && data.length <= maxBytes) return { data, mime, size, depth: 24 }
      }
    }
    if (size === 1) throw new Error('无法压缩这张封面。')
    size = Math.max(1, Math.floor(size * 0.85))
  }
}

export class MusicArtwork {
  private candidate?: { audio: string; info: MusicImage; image: NativeImage; mime: EmbeddedCover['mime'] }

  async pick(audio: string, path: string): Promise<MusicImage> {
    const file = await open(path, 'r')
    let data: Buffer
    try {
      const info = await file.stat()
      if (!info.isFile() || !info.size) throw new Error('所选图片为空或无法读取。')
      if (info.size > 64 * 1024 * 1024) throw new Error('请选择小于 64 MiB 的源图片。')
      data = await readBytes(file, info.size, 0)
    } finally { await file.close() }

    const mime = coverMime(data, extname(path).toLowerCase())
    const image = nativeImage.createFromBuffer(data)
    if (image.isEmpty()) throw new Error('无法解码所选封面。')
    const { width, height } = image.getSize()
    const factor = Math.min(1, 850 / Math.max(width, height))
    const preview = factor === 1 ? image : image.resize({
      width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), quality: 'best',
    })
    if (preview.isEmpty()) throw new Error('无法生成封面预览。')
    const info = { id: randomUUID(), name: basename(path), width, height, preview: preview.toDataURL() }
    this.candidate = { audio, info, image, mime }
    return info
  }

  prepare(audio: string, id: string, crop: SquareCrop) {
    const candidate = this.candidate
    if (!candidate || candidate.audio !== audio || candidate.info.id !== id) throw new Error('请重新选择封面。')
    if (!crop || ![crop.x, crop.y, crop.size].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.size < 1
      || crop.x + crop.size > candidate.info.width || crop.y + crop.size > candidate.info.height) {
      throw new Error('裁剪范围超出了图片边界，请重新选择。')
    }
    const square = candidate.image.crop({ x: crop.x, y: crop.y, width: crop.size, height: crop.size })
    if (square.isEmpty()) throw new Error('无法裁剪这张封面。')
    const picture = compressSquare(square, candidate.mime, crop.size)
    this.candidate = undefined
    return { name: candidate.info.name, picture }
  }

  cancel(audio: string, id: string) {
    if (this.candidate?.audio === audio && this.candidate.info.id === id) this.candidate = undefined
  }

  selectAudio(audio: string) {
    if (this.candidate?.audio !== audio) this.candidate = undefined
  }
}
