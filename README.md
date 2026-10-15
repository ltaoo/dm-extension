<a id="readme-top" data-n="readme-top"></a>

![Download & Manage 图标](assets/icons/icon-128.png)

# Download & Manage

面向 Chrome 138+ 的 Manifest V3 浏览器扩展，用于查看与同步 Cookie、对比网页快照、剪藏页面区域，以及检测内容变化。

**无需构建、无需安装依赖、无需 CDN，克隆后即可加载。**

[界面截图](#界面截图) · [快速开始](#快速开始) · [报告问题](https://github.com/ltaoo/dm-extension/issues) · [提出建议](https://github.com/ltaoo/dm-extension/issues/new)

<details data-n="readme-contents">
<summary data-n="readme-contents-toggle">目录</summary>

- [项目介绍](#项目介绍)
- [界面截图](#界面截图)
- [快速开始](#快速开始)
- [权限与数据](#权限与数据)
- [本地开发](#本地开发)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可证](#许可证)
- [致谢与参考](#致谢与参考)

</details>

## 项目介绍

扩展将站点数据和页面内容工具集中在一个弹窗中：

| 功能 | 可以做什么 | 入口 |
| --- | --- | --- |
| Cookie | 查看当前站点 Cookie（含 HttpOnly），勾选后复制为 `name=value; ...` | 弹窗 → Cookie |
| 网页对比 | 分组暂存页面 HTML，横向查看相邻快照的文本、结构与属性差异 | 弹窗 → 对比 |
| 区域剪藏 | 将页面选区冻结为内联样式、自包含的 HTML 片段，预览并复制 | 弹窗 → 剪藏 |
| 变更检测 | 框选内容建立颜色、文本、JS 函数或列表对比规则，在当前页面手动检测 | 暂存记录预览 → 框选；弹窗 → 变更检测 |
| 设置 | 管理多个 Cookie 同步接口、定时同步和域名解析规则 | 弹窗 → 设置 |

项目使用原生 JavaScript ES modules、Chrome Extensions API、Timeless 0.33.0、dmui 组件与 CryptoJS 4.2.0。运行所需的第三方资源均随仓库提供。

## 界面截图

以下为 `1.0.0` 版本界面，使用虚构的 `example.com` 演示数据。

**Cookie**：查看站点 Cookie，选择后复制，或将域名添加到同步配置。

![Cookie 页面：站点 Cookie 列表与复制操作](assets/screenshots/cookies.png)

**Cookie 同步**：管理多个同步接口、域名范围与定时任务。

![Cookie 同步页面：接口配置、定时同步与域名列表](assets/screenshots/cookie-sync.png)

**保存页面**：设置文件名，保存 HTML 页面快照或当前可见区域的 PNG 截图。

![保存页面：来源信息、文件名与保存操作](assets/screenshots/save-page.png)

## 快速开始

### 环境要求

- Chrome **138 或更新版本**。
- 页面读取、剪藏与检测在普通 **HTTP(S) 页面**上使用；`chrome://` 等浏览器内部页面不支持。
- 使用「JS 函数」或「列表对比」规则时，还需在扩展详情页开启「允许用户脚本」。Cookie、剪藏、颜色与内容规则不需要此开关。

### 加载扩展

1. 克隆仓库，或下载源码并解压：

   ```sh
   git clone https://github.com/ltaoo/dm-extension.git
   cd dm-extension
   ```

2. 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择仓库根目录（包含 `manifest.json` 的目录）。
4. 打开一个 HTTP(S) 页面，点击扩展图标即可使用。

不需要运行 `npm install` 或启动开发服务器。修改扩展代码后，在 `chrome://extensions` 中重新加载扩展，再重新打开弹窗或相关扩展页面。

### 第一次对比页面

1. 打开目标网页，在弹窗「对比」页点击「暂存」。
2. 修改页面内容、等待页面更新，或打开另一个需要对比的页面，再在**同一分组**暂存一次。
3. 点击「开始对比」，在新标签页查看差异；简报中的 ↑ / ↓ 可逐个跳转变更。

## 权限与数据

| 权限 | 用途 |
| --- | --- |
| `activeTab`、`scripting` | 读取当前页面、注入框选与提取逻辑 |
| `cookies` | 读取站点 Cookie，供查看、复制和同步 |
| `userScripts` | 在实时页面的用户脚本世界执行 JS 函数与列表对比规则 |
| `storage`、`unlimitedStorage` | 保存配置、规则、快照与可能含内联图片的剪藏 HTML |
| `alarms` | 后台定时同步 Cookie |
| `clipboardWrite` | 复制 Cookie、页面 HTML 和剪藏结果 |
| HTTP(S) 主机权限 | 访问站点内容、读取 Cookie，并请求用户指定的同步接口 |

数据保存在 `chrome.storage.local`：

| 存储键 | 内容 |
| --- | --- |
| `cookie-sync-settings`、`cookie-sync-status` | 同步接口配置与状态；配置包含加密密码 |
| `comparison-records`、`comparison-group`、`comparison-groups` | 页面快照、当前分组与分组列表 |
| `page-parsers` | 域名解析规则 |
| `detection-rules` | 变更检测规则与列表基线 |
| `region-clips`、`clip-options` | 剪藏记录与选项 |

扩展不持久化浏览器 Cookie 副本；手动同步或已启用的定时任务会向配置接口上传匹配的 Cookie。暂存与剪藏保存的是页面内容，可能包含个人信息；共享 HTML 或配置前请检查内容。加密密码保存在本地配置中。

## 本地开发

### 目录结构

```text
manifest.json          # 扩展配置、版本、权限与沙箱声明
src/background.js      # Service Worker：消息与定时任务
src/popup/             # 弹窗入口与导航
src/pages/             # Cookie / 对比 / 剪藏 / 检测 / 设置 View
src/models/            # 弹窗业务状态、Cookie 同步与加密
src/compare/           # 快照对比、预览、规则模型与提取沙箱
src/clip/              # 区域选择、样式冻结、结果页与自检
assets/vendor/         # 本地运行时、组件与第三方许可证
assets/icons/          # SVG、PNG 与 ICO 图标
scripts/               # UI 资产同步与图标导出
test/                  # 浏览器内运行的 HTML 测试
```

JavaScript 遵循 Model / View 分离：业务状态与逻辑由 Model 维护，View 根据状态渲染并调用 Model 方法。HTML 节点用 `data-n="语义名称"`，节点配置对象用 `attributes: { n: "语义名称" }` 声明可读标识。

### 运行检查

仓库没有构建命令或 npm 测试脚本。HTML 测试依赖 ES module 动态导入，不能直接通过 `file://` 运行；在仓库根目录启动静态服务器：

```sh
python3 -m http.server 8791 --bind 127.0.0.1
```

在浏览器打开 `http://127.0.0.1:8791/test/compare.model.test.html`，或将文件名替换为下表中的测试。通过时 `body` 带有 `data-test-passed`，发生错误时带有 `data-test-error`；可在开发者工具的 Elements 面板检查。修改模块后，在 Network 面板开启「Disable cache」再重新加载。

| 检查范围 | 测试文件（位于 `test/`） |
| --- | --- |
| 快照与对比 | [compare.model.test.html](test/compare.model.test.html)、[compare.render.test.html](test/compare.render.test.html)、[compare.preview.test.html](test/compare.preview.test.html) |
| 规则与脚本 | [detection.model.test.html](test/detection.model.test.html)、[detection.script.test.html](test/detection.script.test.html)、[detection.list.test.html](test/detection.list.test.html) |
| 弹窗对比与检测 | [popup.savepage.test.html](test/popup.savepage.test.html)、[popup.detect.test.html](test/popup.detect.test.html)、[popup.detect.script.test.html](test/popup.detect.script.test.html) |
| 页面复制 | [store.copy_page.test.html](test/store.copy_page.test.html) |
| 剪藏 | [clip.model.test.html](test/clip.model.test.html)、[clip.result.test.html](test/clip.result.test.html)、[popup.clip.test.html](test/popup.clip.test.html)、[store.clip.test.html](test/store.clip.test.html) |

`compare.render.test.html` 在原 README 中有既有失败记录，运行时需单独核对。

涉及交互或 Chrome API 的改动，还应重新加载扩展并手动检查：

- **对比**：同组暂存两条、切换分组、打开预览与对比、跳转差异，确认删除范围。
- **检测**：连续框选、切换父 / 子容器、滚动预览；验证四种规则、首次列表基线与后续增删改，以及其他站点和未开启用户脚本时的置灰提示。
- **提取测试**：切换整页 / 选区数据源，验证输入预览、JSON / 表格输出、语法错误与超时提示。
- **剪藏**：框选时页面不抖动，结果自动打开；尺寸、源码与复制一致；粘贴到其他页面后检查样式和外部请求，核对缺图占位、删除确认与内部页面禁用状态。
- **Cookie 同步**：确认复制勾选与接口范围独立，空范围不上传，多接口保存、同步与失败状态正确。

### 更新版本与资源

- 显示版本来自 [manifest.json](manifest.json) 的 `version_name`（当前 `1.0.0`），内部版本为 `version`（当前 `1.0.0`）；发布时同步修改两者。
- UI 资产已随仓库提供。`scripts/sync-ui-assets.sh` 依赖上级目录原主前端的 `src/` 与 `public/`，独立仓库无需执行。
- `scripts/generate-icons.sh` 需要 `rsvg-convert` 与 ImageMagick，并会先将 **`../public/logo.svg` 覆盖复制到 `assets/icons/logo.svg`**，再导出 PNG / ICO。仅在上级源文件可用且确认覆盖符合预期时运行：

  ```sh
  bash scripts/generate-icons.sh
  ```

## 已知限制

- **快照保真**：移除脚本的页面 HTML 不等于完整离线网页；外部资源仍可能影响快照渲染，跨域污染的画布无法转成图片。
- **剪藏保真**：不内嵌字体，不还原 `::marker`、`::placeholder` 等其他伪元素；滚动容器不保留滚动位置，跨出选区的绝对定位元素可能偏移。固定定位后代会降为绝对定位，固定背景会降为滚动背景。
- **用户函数**：检测规则保存时不预演函数，错误在检测时显示；检测规则没有超时保护，死循环可能卡住标签页的用户脚本世界。提取测试使用独立的 8 秒超时机制。
- **检测范围**：当前只提供本地手动检测，尚未接入后端规则提交与执行接口。Cookie 定时同步与变更检测是独立功能。

## 参与贡献

欢迎通过 [Issues](https://github.com/ltaoo/dm-extension/issues) 报告问题或建议，也可 Fork 后提交 Pull Request。

报告问题时请附 Chrome 版本、扩展版本、复现步骤、预期与实际结果，以及已脱敏的错误信息。提交改动前请运行相关 HTML 测试，并在 PR 中说明验证结果；涉及扩展权限或交互时补充手动验证。

## 许可证

仓库目前未提供项目级 `LICENSE` 文件。第三方资源的许可见 [Timeless.LICENSE](assets/vendor/Timeless.LICENSE) 与 [CryptoJS.LICENSE](assets/vendor/CryptoJS.LICENSE)。

## 致谢与参考

- README 结构参考 [Best-README-Template](https://github.com/othneildrew/Best-README-Template)，结合本项目的无构建安装方式与功能调整。
- Chrome 官方文档：[Service Worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)、[Cookie API](https://developer.chrome.com/docs/extensions/reference/api/cookies)、[Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)、[Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[User Scripts API](https://developer.chrome.com/docs/extensions/reference/api/userScripts)、[沙箱页](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)。

[返回顶部](#readme-top)
