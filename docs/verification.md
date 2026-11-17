# v0.1.0-preview.2 验收记录

验收环境为 Windows 11 x64。桌面包使用 Electron 45.3.3，外置 FFmpeg 与 FFprobe 为 9.0.2。

| 检查 | 结果 |
| --- | --- |
| 窗口 | 标题区与内容区使用相同底色，检查原生窗口控制和标题区拖动。窄窗口的封面工作区为单列，侧栏可打开并在导航后关闭 |
| 侧栏与 FFmpeg | 「设置」「关于」固定在侧栏底部。就绪或需配置仅在「视频封面封装」页显示。缺少程序时仍可导入素材，封装按钮禁用 |
| 导入 | 同时拖入、分别拖入、素材替换和系统选择窗口均已检查。重复类型、普通文本、损坏媒体提示错误 |
| 关于 | 禁用 HTTP/HTTPS 加载时本地 GitHub 头像仍正常显示，作者介绍与两个公开项目可见 |
| 无损导出 | 封装成品的 H.264、AAC 流 SHA-256 与原片一致，内嵌 PNG 的 SHA-256 与原图一致。样片时长为 41.621333 秒，时间码保持 00:02:16:35 |
| 缩略图 | Windows 资源管理器大图标视图显示所选封面 |
| 交付 | TypeScript、生产构建、Windows x64 ZIP、解压运行和依赖审计通过。项目只留一份验收成片，测试配置和临时目录在验收后清理 |

## 复查成片

将原视频和导出视频分别作为输入，比较音视频逐流哈希。对提取图片与原封面使用 `Get-FileHash -Algorithm SHA256`。

```powershell
ffmpeg -v error -i input.mp4 -map "0:V" -map "0:a?" -c copy -f streamhash -hash SHA256 -
ffprobe -v error -show_streams -show_chapters -of json output.mp4
ffmpeg -v error -i output.mp4 -map "0:v:disp:attached_pic" -c copy -frames:v 1 -update 1 extracted.png
```

在资源管理器打开成品所在文件夹，切换到「大图标」核对封面。其他 Windows 环境可按 README 中的说明复验。上传平台由用户后测。
