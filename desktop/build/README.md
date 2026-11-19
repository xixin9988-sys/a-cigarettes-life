# 图标目录

electron-builder 会在这里找 `icon.ico`（Windows 应用图标 / 任务栏 / 安装包 / 卸载程序）。

## 需要什么

- 文件名：`icon.ico`
- 尺寸：**256×256**（内含 16/24/32/48/64/128/256 多尺寸最佳）
- 格式：ICO（不是 png 改名，要真的 ICO 容器）

## 怎么生成

1. 准备一张 1024×1024 的 PNG 方图（不要透明边缘留白太多）；
2. 用任意在线/本地工具转成多尺寸 ICO，例如
   - ImageMagick：`magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`
   - 或在 Photoshop / GIMP / IcoFX 里导出；
3. 放到本目录，文件名 `icon.ico`，重新打包即可。

没有图标时 electron-builder 会打印 `default Electron icon is used` 并继续打包——
能用，只是任务栏和安装包会显示 Electron 的默认图标。

## 顺带

`public/favicon.ico` 是浏览器标签页图标，和这里互不影响；想让窗口图标也一致，
可以在 `desktop/electron/main.cjs` 的 `new BrowserWindow({...})` 里加 `icon:` 指向打包后的图标文件。
