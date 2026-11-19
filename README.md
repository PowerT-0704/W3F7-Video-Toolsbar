<div align="center">

# W3F7のVideo_Toolsbar

**面向视频与音频工作流的本地工具箱。**

源码版本 **v1.2.2** · 已发布的 Windows 安装版与便携版 **v1.1.1**

[![正式版](https://img.shields.io/github/v/release/PowerT-0704/W3F7-Video-Toolsbar?label=release)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/latest)
[![Release 附件累计下载](https://img.shields.io/github/downloads/PowerT-0704/W3F7-Video-Toolsbar/total?label=downloads)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases)
[![平台 Windows x64](https://img.shields.io/badge/Windows-x64-577ac6)](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/latest)
[![MIT 许可](https://img.shields.io/badge/license-MIT-805abc)](LICENSE)
[![FFmpeg](https://img.shields.io/badge/engine-FFmpeg-4e9a76)](https://ffmpeg.org/download.html#build-windows)

[下载 Windows x64 安装版](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/download/v1.1.1/W3F7-Video-Toolsbar-1.1.1-Setup-x64.exe) · [下载便携版](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/download/v1.1.1/W3F7-Video-Toolsbar-1.1.1-win-x64.zip) · [发布说明与校验值](https://github.com/PowerT-0704/W3F7-Video-Toolsbar/releases/tag/v1.1.1)

[快速开始](#快速开始) · [音乐封面解析](#音乐封面解析) · [资源管理器缩略图](#资源管理器缩略图) · [开发路线图](ROADMAP.md) · [历史验收记录](docs/verification.md)

</div>

<div align="center">
<img src="docs/preview.png" width="900" alt="W3F7のVideo_Toolsbar 深色视频工作区与独立封面预览">
<img src="docs/preview-light.png" width="900" alt="W3F7のVideo_Toolsbar 浅色视频工作区与独立封面预览">
</div>

## 本地工具

| 工具 | 格式 | 能做什么 |
| --- | --- | --- |
| 视频封面封装 | MP4 | 播放和定位视频，将当前帧或本地图片写入封面，保留原有音视频编码 |
| 音乐封面解析 · v1.2.2 | FLAC、MP3 | 试听、预览与导出封面和歌词，裁剪新封面，并将封面或 LRC 写入同格式副本 |

## 快速开始

### Windows 动画效果

如果启动和页面切换的动画没有显示，可在 Windows「设置 → 辅助功能 → 视觉效果」开启「动画效果」。系统动画关闭时，应用会省略部分动效。应用「设置 → 外观」中的「减少动效」也可以单独开启。[微软动画设置说明](https://support.microsoft.com/zh-cn/accessibility/windows/make-it-easier-to-focus-on-tasks)

### 准备 FFmpeg

1. 从 [FFmpeg 官方下载页](https://ffmpeg.org/download.html#build-windows) 进入 Windows 构建下载。把压缩包解压到固定目录，确认 `bin` 里同时有 `ffmpeg.exe` 和 `ffprobe.exe`。
2. 将 `bin` 的绝对路径加入 Windows 用户 PATH，重开终端和工具，执行 `ffmpeg -version` 与 `ffprobe -version`。桌面版也能在「设置 → FFmpeg」直接选择 `bin` 文件夹。
3. FFmpeg 用于视频封装、抽帧和音乐封面提取，FFprobe 用于识别媒体和校验成品。安装版与便携版均使用外置 FFmpeg。

### 桌面便携版

完整解压 Windows x64 ZIP 后打开 `W3F7-Video-Toolsbar.exe`。启动后进入起始页，可从首页或侧栏进入工具。FFmpeg 和 FFprobe 在后台自动检测，结果显示在工具页。

将鼠标移到左侧图标栏可展开导航，移开后会收回。用顶部按钮或 `Ctrl+B` 固定展开，点击工作区空白处可以收回。窄窗口用顶部按钮打开抽屉。在「设置 → 外观」可以切换深色和浅色，也可以减少动效。主题选择会在下次启动时恢复。

把 MP4 和封面拖入虚线区域，可以一起拖，也可以逐个拖。页面会识别视频和 PNG、JPG、JPEG 封面，并分别显示到素材列表。也可以用「选择视频」「选择封面」导入。确认预览及保存位置，点击「封装封面」。完成后点击「在资源管理器中查看」。

### 音乐封面解析

音乐工具适用于 v1.2.2，请按[从源码运行](#从源码运行)启动该版本。

1. 从起始页或侧栏打开「音乐封面解析」，选择或拖入一首 FLAC 或 MP3。可试听、拖动进度、另存内嵌封面原图或导出 UTF-8 LRC。
2. 通过「重选封面」导入 JPG、JPEG 或 PNG。非方图可拖动选框或调整选区大小。新正面封面为 1:1，边长最多 1000 px，体积最多 1 MiB，透明 PNG 保留透明度。
3. 导入本地 LRC 可立即预览歌词，带时间戳的歌词随播放高亮。切离音乐页时暂停，返回可从原进度继续。
4. 点击「另存音频副本」写入待封装的封面或歌词。两项可一次保存，原始音频数据和其他附图跟随副本保留。

### Windows 安装版

运行下载的 `W3F7-Video-Toolsbar-*-Setup-x64.exe`，按中文向导选择目录并安装。默认安装在当前用户的 `%LOCALAPPDATA%\Programs\W3F7-Video-Toolsbar`，开始菜单会添加应用入口，桌面快捷方式可自行勾选。安装版同样需要外置 FFmpeg 和 FFprobe。

可从 Windows「设置 → 应用」或开始菜单运行卸载程序。卸载会删除应用文件，个人设置和自己生成的文件保留。安装程序目前未签名。

### 单文件批处理

选中一个 MP4 与一张静态 PNG/JPG/JPEG，一起拖到 [W3F7-Video-Cover.bat](W3F7-Video-Cover.bat)。脚本自动识别拖放顺序，在批处理文件所在目录生成 `原名_cover.mp4`。同名会生成 `原名_cover_2.mp4` 等编号文件。Windows 自带的 PowerShell 会运行脚本内嵌的处理核心。

## v1.2.2 更新

- 音乐页增加正面封面裁剪、试听和歌词联动。进度条流光遵循系统和应用的减少动效设置。
- 设置页使用支持点击和拖动的深浅主题开关，切换时同步预览界面和标题栏配色。
- 修复从「设置」或「关于」切回上方工具时侧栏短暂出现的滚动条，并校正窄窗抽屉的分割线宽度。

## 设置与更新

- 「设置 → 存储与缓存」可查看抽帧和临时封面的占用、迁移缓存位置或清理闲置缓存。
- 应用会在启动后查询 GitHub 上的最新正式版，也可在「关于 → 检查更新」手动查询。

## 封装与兼容性

### 视频

- FFmpeg 写入 MP4 的内嵌封面，视频、音频和其他兼容轨使用流复制。原始视频和封面文件保留。已有内嵌封面时，成品使用新图。
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
