# isitpeak README

通用的峰谷价标识插件：根据配置的时段，在状态栏右侧显示「峰价」或「谷价」，并将鼠标悬浮在状态栏上时提示距离下一次切换的时间。

## Features

- 在状态栏右侧显示当前状态：
  - 处于峰价时段时显示 `峰价`
  - 其他时间显示 `谷价`
- 鼠标悬浮在状态栏文字上时，显示：
  - 当前状态与当前时间（24 小时制）
  - 若处于峰价时段：`峰价将于 x小时x分钟 后结束`
  - 若处于谷价时段：`距离峰价还有 x小时x分钟`
- 支持配置多个峰价时段，并支持跨天时段（如 `22:00` 至 `06:00`）
- 状态在峰价/谷价之间切换时弹出通知（如 `已进入峰价时段（09:00）`），可在设置中关闭
- 状态栏每 30 秒自动刷新，修改设置后立即生效

## Extension Settings

This extension contributes the following settings:

* `isitpeak.peakPeriods`: 峰价时段列表，每项包含 `start` 与 `end`（均为 24 小时制字符串，如 `"08:00"`）。若 `end` 小于 `start` 则视为跨天时段。默认示例：

  ```json
  "isitpeak.peakPeriods": [
    { "start": "09:00", "end": "12:00" },
    { "start": "14:00", "end": "18:00" }
  ]
  ```

* `isitpeak.peakLabel`: 峰价时段显示的状态栏文字（默认 `峰价`）。
* `isitpeak.valleyLabel`: 非峰价时段显示的状态栏文字（默认 `谷价`）。
* `isitpeak.notifyOnSwitch`: 状态在峰价/谷价之间切换时是否弹出通知（默认 `true`）。

## 自动发版（GitHub Actions）

推送形如 `v1.0.1` 的 git tag 时，`.github/workflows/release.yml` 会自动执行：

1. 从 tag 提取版本号（去掉 `v` 前缀）并写入 `package.json`；
2. 安装依赖、类型检查、lint、esbuild 构建；
3. 打包生成 `isitpeak-<版本>.vsix`；
4. 发布到 VS Code Marketplace（需要 `VSCE_PAT` secret）；
5. 创建 GitHub Release 并附带 vsix 文件。

首次使用前需要：

- 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加 `VSCE_PAT`（Azure DevOps 生成的 Personal Access Token，需勾选 Marketplace `Manage` 权限，且 publisher 与 `package.json` 中的 `debug967` 一致）。
- 发版命令示例：

  ```bash
  git tag v0.0.2
  git push origin v0.0.2
  ```

也可以在 Actions 页面手动触发（`workflow_dispatch`），并在输入框中指定版本号。

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 0.0.1

Initial release：状态栏峰谷价显示、悬浮提示剩余时间、切换通知。

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
