<div align="center">

# W3F7のVideo_Toolsbar

**面向视频与音频工作流的本地工具箱。**

公开下载 **v1.2.3** · 当前源码 **v1.3.1**

[![正式版](https://img.shields.io/github/v/release/PowerT-0704/W3F7-Video-Toolsbar?label=release&style=flat-square)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/latest)
[![Release 附件累计下载](https://img.shields.io/github/downloads/PowerT-0704/W3F7-Video-Toolsbar/total?label=downloads&style=flat-square)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases)
[![平台 Windows x64](https://img.shields.io/badge/Windows-x64-577ac6?style=flat-square)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/latest)
[![MIT 许可](https://img.shields.io/badge/license-MIT-805abc?style=flat-square)](LICENSE)
[![FFmpeg](https://img.shields.io/badge/engine-FFmpeg-4e9a76?style=flat-square)](https://ffmpeg.org/download.html#build-windows)

[📦 Windows x64 安装版](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/download/v1.2.3/W3F7-Video-Toolsbar-1.2.3-Setup-x64.exe) · [便携版 ZIP](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/download/v1.2.3/W3F7-Video-Toolsbar-1.2.3-win-x64.zip) · [发布说明与校验值](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/tag/v1.2.3)

[界面预览](#界面预览) · [功能展示](#功能展示) · [快速开始](#快速开始) · [开发路线图](ROADMAP.md) · [历史验收记录](docs/verification.md)

</div>

## 界面预览

<p align="center"><img src="docs/readme/home.png" width="900" alt="W3F7のVideo_Toolsbar v1.2.3 深色首页，显示视频封面封装和音乐封面解析入口"></p>

### 🌗 深浅主题

在「设置 → 外观」拖动开关，月亮与太阳随滑块交替，页面即时换色。松手后，滑块吸附到选中的主题。深色切浅色时，流光沿滑块下边和右边移动，切回深色时沿上边和左边回到起点，完成一圈逆时针运动。

<p align="center"><img src="docs/readme/theme-toggle.gif" width="900" alt="在设置中把主题开关从深色拖到浅色，再拖回深色。滑块上的月亮和太阳交替出现，边缘流光逆时针绕一圈"></p>

## 功能展示

### 🎬 视频封面封装

在 MP4 时间轴上定位画面，可将当前帧或本地图片写为内嵌封面、插入片头第一帧，或同时执行两项。仅内嵌封面时保留原有音视频编码。

<p align="center"><img src="docs/readme/video-cover.png" width="900" alt="深色视频封面工具，显示 Blue Hour 的视频预览、时间轴、封面预览及封装按钮"></p>

### 🎵 音乐封面解析

试听 FLAC 或 MP3，导出原封面与内嵌歌词。裁剪新封面或导入 LRC 后，可一起写入同格式的音频副本。

<p align="center"><img src="docs/readme/music-cover.png" width="900" alt="深色音乐工具，显示 Blue Hour 的内嵌封面、播放器和随进度高亮的歌词"></p>

### 语音转录 · v1.3.1

本地音视频可用必剪免 Key 转录。工作台支持长音频分块、单项和批量任务、编辑与重译字幕、导出 SRT、ASS、VTT、TXT、JSON，以及生成带软字幕或硬字幕的视频。

「任务设置」页底部显示队列和阶段进度，可移除已结束的任务。转录批次成功结束后播放短提示音。「字幕优化与翻译」保留实时预览与编辑，「字幕视频合成」集中设置字幕类型、容器和输出。

<p align="center"><img src="docs/readme/transcription.png" width="900" alt="语音转录任务设置，显示三个视图、素材和处理双栏、底部批量队列及当前阶段进度"></p>

## 快速开始

### 下载与启动

- **安装版**按中文向导选择目录。默认安装在当前用户的 `%LOCALAPPDATA%\Programs\W3F7-Video-Toolsbar`，开始菜单会添加入口，可自行勾选桌面快捷方式。安装程序未签名。
- **便携版**完整解压 ZIP 后运行 `W3F7-Video-Toolsbar.exe`。从首页或侧栏进入工具，页面会显示 FFmpeg 和 FFprobe 的检测结果。
- 可从 Windows「设置 → 应用」或开始菜单运行卸载程序。卸载时保留个人设置和自己生成的文件。

### 准备 FFmpeg

1. 从 [FFmpeg 官方下载页](https://ffmpeg.org/download.html#build-windows) 进入 Windows 构建下载。把压缩包解压到固定目录，确认 `bin` 里同时有 `ffmpeg.exe` 和 `ffprobe.exe`。
2. 将 `bin` 的绝对路径加入 Windows 用户 PATH，重开终端和工具，执行 `ffmpeg -version` 与 `ffprobe -version`。桌面版也能在「设置 → FFmpeg」直接选择 `bin` 文件夹。
3. FFmpeg 用于视频封装、抽帧、音乐封面提取、转录前音轨提取和字幕合成。FFprobe 识别媒体并校验成品。ASS 硬字幕需要含 libass 的 FFmpeg，硬字幕视频输出需要 `libx264`。

### 视频封面封装

把 MP4 和 PNG、JPG 或 JPEG 封面拖入虚线区域，也可以用「选择视频」「选择封面」导入，或从视频时间轴选取一帧作为封面。在「输出设置」确认保存位置和封面方式，点击「封装封面」。完成后可在资源管理器中查看成品。

| 封面方式 | 成品 | 处理方式 |
| --- | --- | --- |
| 仅内嵌封面（默认） | `原名_cover.mp4` | 写入内嵌封面，保留原有音视频编码 |
| 仅添加至第一帧 | `原名_firstframe.mp4` | 仅编码封面图，在原视频前插入一帧 |
| 内嵌并添加至第一帧 | `原名_cover_firstframe.mp4` | 同时写入内嵌封面并在开头插入一帧 |

使用首帧方式时，封面等比缩放并居中补边，播放时仅出现一帧。原视频帧和音轨用流复制，音轨、可复制的字幕轨及章节时间同步后移。有章节的源视频会为新增帧单列「封面帧」章节。首帧副本不保留摄影机时码。首帧方式需要含 `libx264` 和 `setts` 的 FFmpeg，支持单主视频轨的 8 位 H.264 SDR MP4。手机相册与发布平台按各自规则取图。

### 音乐封面解析

1. 从起始页或侧栏打开「音乐封面解析」，选择或拖入一首 FLAC 或 MP3。可试听、拖动进度、另存内嵌封面原图或导出 UTF-8 LRC。
2. 通过「重选封面」导入 JPG、JPEG 或 PNG。非方图可拖动选框或调整选区大小。新正面封面为 1:1，边长最多 1000 px，体积最多 1 MiB，透明 PNG 保留透明度。
3. 导入本地 LRC 可立即预览歌词，带时间戳的歌词随播放高亮。切离音乐页时暂停，返回可从原进度继续。
4. 点击「另存音频副本」写入待封装的封面或歌词。两项可一次保存，原始音频数据和其他附图跟随副本保留。

### 单文件批处理

选中一个 MP4 和一张静态 PNG、JPG 或 JPEG，一起拖到 BAT。命令窗口会说明三种封面方式。输入 `1`、`2` 或 `3` 后回车，直接回车默认选 `1`。成品保存在 BAT 所在目录，同名时自动编号。Windows 自带的 PowerShell 会运行脚本内嵌的处理核心。 [W3F7-Video-Cover.bat](W3F7-Video-Cover.bat)

### 语音转录

1. 打开「语音转录」，选取或拖入音视频和已有字幕。视频如有多条音轨，可在素材卡切换。默认使用必剪和规则断句，开始前可查看联网阶段会发送的内容。
2. 在「处理与输出」选择仅转录、处理已有字幕、转录并处理字幕、全流程或仅合成。由页底队列启动处理，可单项取消、重试或移除已结束的任务。
3. 在「字幕优化与翻译」中点行号定位预览，修改原文、译文或时间，或合并连续行后保存并导出。选用翻译服务时可对失败行重译。
4. 在「字幕视频合成」选择字幕类型、容器及布局后生成视频。任务输出目录未选择时，使用应用默认目录或源文件所在目录。
5. 如需语义断句、校正或大模型翻译，进入「More → 模型与 API」，默认模型是 `deepseek-flash`。填入自己的 Key，保存并测试连接。使用本地 Whisper 时，先自行准备兼容的 Windows 程序和模型，再在「本地 Whisper」选路径并检查程序。

## 设置与更新

- 鼠标移入左侧图标栏可展开导航。用顶部按钮或 `Ctrl+B` 固定展开，点击工作区空白处收回。窄窗可通过顶部按钮打开抽屉。
- 设置页的标题与卡片在侧栏右侧的工作区居中。
- 深浅主题会在下次启动时恢复。主题过渡和音乐页流光遵循应用的「减少动效」及 Windows 动画设置。[微软动画设置说明](https://support.microsoft.com/zh-cn/accessibility/windows/make-it-easier-to-focus-on-tasks)
- 「设置 → 存储与缓存」可查看抽帧和临时封面的占用、迁移缓存位置或清理闲置缓存。
- 「设置 → 转录缓存」可更改音频分块、识别结果和兼容预览的存放位置，并清理当前或旧位置的闲置缓存。必剪转录会提取并上传音频，微软翻译只提交字幕文本。
- 应用会在启动后查询 GitHub 上的最新正式版，也可在「关于 → 检查更新」手动查询。

## 封装与兼容性

### 视频

- 仅内嵌方式流复制视频、音频和其他兼容轨。已有内嵌封面时，成品使用新图。
- 支持静态 PNG、JPG、JPEG。图像会先解码校验，再以原始图像数据写入封面。章节按原章节表保存。样片的时间码轨按原时间码重建并校验。
- 导出用同目录临时文件，媒体轨无法复制或成品校验失败时会显示错误。再次导出可使用同样的素材。
- 各播放器和上传平台采用各自的缩略图规则。内嵌封面跟随 MP4 文件保存。

### 音乐

- 封装生成 FLAC 或 MP3 副本。新封面写入正面封面标签，背面等其他附图保留。
- LRC 导入支持 UTF-8、带 BOM 的 UTF-16 和 GB18030，导出使用 UTF-8。MP3 的毫秒制 SYLT 歌词可转成 LRC，播放器能否显示歌词取决于其标签支持。
- 源图读取上限为 64 MiB。遇到受保护或无法安全改写的标签时，音乐页会说明封装限制。

## 资源管理器缩略图

在本机 Windows 11 的原生文件选择器中，样片的内嵌 PNG 已显示为 MP4 缩略图。在其他机器上，可切换到资源管理器的「大图标」视图，打开新导出文件所在的目录复验。若缩略图仍取自视频画面，可手动配置 [Icaros](https://github.com/Xanashi/Icaros)。

1. 从 [Icaros Releases](https://github.com/Xanashi/Icaros/releases) 获取并打开 IcarosConfig。
2. 在 **Thumbnailing** 中将 `.mp4` 加入已启用的类型，打开 **Use embedded Cover Art for thumbnails**，然后启用 **Thumbnailing**。
3. 用工具再导出一份新文件名的 MP4，在资源管理器的大图标视图核对所选封面。新文件名可以避开已有缩略图缓存。

## 从源码运行

在 Windows x64 上使用 Node.js 24 与 FFmpeg。构建时会根据锁文件安装依赖。

```powershell
npm ci
node node_modules/electron/install.js
npm start
```

- `npm start` 会先构建桌面应用，再启动 Electron。
- `npm run build:bat` 更新单文件批处理。原始封装逻辑在 `core/cover.ps1`。
- `npm run typecheck` 运行 TypeScript 检查。 `npm run package:win` 构建可解压运行的 ZIP，输出到 `artifacts`。
- 音乐标签回归测试可在 `npm run build:app` 后运行 `node --test tests/music.test.cjs`，测试使用 PATH 中的 FFmpeg 和 FFprobe。
- `npm run package:installer` 使用当前版本的便携 ZIP 构建安装版。需要 NSIS 3，将 `makensis.exe` 加入 PATH，或将 `W3F7_MAKENSIS` 设置为编译器的绝对路径。
- FFmpeg 支持和本地文件操作由 Electron 主进程提供。界面包括视频封面封装、音乐封面解析、开发日志、设置与关于。
- 原始样片、验收视频、便携 ZIP 与本地备份保留在工作区。可从 Git 快照重建交付包。

## 致谢

界面使用 [shadcn/ui](https://github.com/shadcn-ui/ui) 官方 New York 组件和 Neutral 暗色主题，搭配 [Geist](https://github.com/vercel/geist-font) 字体。关于页的头像来自 [W3F7 的 GitHub 主页](https://github.com/PowerT-0704)，随应用本地打包。切页、拖入和按钮反馈使用 Motion 和 Magic UI，柔光参照 React Bits。第三方许可见 [licenses](licenses/)。

项目源码采用 [MIT 许可](LICENSE)。第三方组件、字体和随附图片适用各自的权利声明。

**作者** [W3F7 · PowerT-0704](https://github.com/PowerT-0704)
