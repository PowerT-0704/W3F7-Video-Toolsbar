# v0.1.0-preview.1 验收记录

验收环境为 Windows 11 x64，FFmpeg 与 FFprobe 为 9.0.2，便携包含 Electron 45.3.3。

| 检查 | 结果 |
| --- | --- |
| 单文件 BAT | 复制到独立文件夹，从不同工作目录传入 MP4 与 PNG/JPEG，两个顺序均可用，成品位于脚本旁 |
| 便携桌面版 | 解压后启动，检测外置 FFmpeg，导入文件并显示视频参数、封面预览和导出结果 |
| 封面和原始素材 | PNG、JPEG 提取后 SHA-256 与各自输入一致。原始素材与需求文件的 SHA-256 与开工前记录一致 |
| 音视频 | H.264 和 AAC 的逐流 SHA-256 一致，样片时长保持 41.621333 秒，解码验证通过 |
| 时间码与章节 | 样片的时间码保持 `00:02:16:35`。带两章的测试 MP4 保留标题与章节时间 |
| 资源管理器 | 大图标视图中，成品 MP4 与所选 PNG 显示同一封面。JPEG 成品经 Windows 缩略图接口复验同样显示所选图 |
| 失败及重试 | 重名自动编号。损坏图片、缺少 FFmpeg、输出目录禁止写入时返回可读错误，未留下半成品 |
| 界面 | 同时拖入文件、系统文件选择窗口、封面预览、导出、设置与关于页面已检查。减少动效设置已验证生效 |
| 构建 | `npm run typecheck`、`npm run build`、`npm run package:win` 通过。 `npm audit` 报告 0 项已知漏洞 |

## 媒体核对方法

对原视频和导出视频各执行一次流哈希命令。对提取后的图片用 `Get-FileHash -Algorithm SHA256` 比对原图。

```powershell
ffmpeg -v error -i input.mp4 -map "0:V" -map "0:a?" -c copy -f streamhash -hash SHA256 -
ffprobe -v error -show_streams -show_chapters -of json output.mp4
ffmpeg -v error -i output.mp4 -map "0:v:disp:attached_pic" -c copy -frames:v 1 -update 1 extracted.png
```

样片视频流 SHA-256 为 `ba1cabc19f967f3ef3729bd90588ea9ea7a6e8461514d041aa8356450c686d94`，音频流为 `78dd122024f7236f75345609f3e4b6d58a223a9af3739228ecbeb81189b4c57a`。测试素材、输出样片和备份只保存在本地。

资源管理器的展示由 Windows 已启用的缩略图处理器决定。其他 Windows 环境可按 README 使用自己的样片验收。上传平台由用户后测。BAT 的双文件入口通过实际命令行传参验证。
