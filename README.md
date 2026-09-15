# Download & Manage 浏览器扩展

Chrome（120+）Manifest V3 扩展，提供三块能力：

- **Cookie**：在弹窗中查看当前站点 Cookie（含 HttpOnly），勾选后复制为 `name=value; ...`。
- **对比**：暂存当前标签页移除 `script` 后的 HTML（可复制到粘贴板），并在新标签页对**当前选中分组**按「每条记录与其前一条对比」横向渲染、高亮差异并列出新增/移除清单。
- **设置**：管理多个 Cookie 同步接口配置（地址、域名范围、加密、定时），以及 SavePage 的域名 → 解析器映射。

无构建步骤、无 CDN、无依赖安装，本目录即为可加载的完整扩展。

## 安装

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选中**本目录**。

修改代码后，在 `chrome://extensions` 点击扩展卡片上的重新加载按钮即可。

## 功能说明

### Cookie

在普通 HTTP(S) 页面点击扩展图标即可查看、全选／勾选并复制 Cookie。勾选只影响复制；上传范围由各同步接口自己的域名列表控制。

### 对比

打开弹窗时读取当前标签页 `document.documentElement` 的 HTML（克隆后移除全部 `script` 标签）。点击「暂存」可把当前页面保存到当前选中分组；点击「复制」可把当前页面 HTML 复制到粘贴板（反馈字符数，成功后按钮显示「已复制」3 秒）；通过「分组」标签可切换分组或「新增分组」。弹窗中的暂存列表**只显示当前分组内的记录**：点击记录在新标签页打开渲染预览（`src/compare/preview.html`），每条记录可单独「删除」（有确认），「清空」仅清空当前分组、不影响其它分组。在当前选中分组内暂存至少两条记录后点击「开始对比」，会在新标签页只渲染该分组：各记录横向并排，内容按面板宽度 100% 渲染、iframe 高度随内容自适应，页面纵向滚动查看。对比永远以前一条记录为基准：第 1 条是基准页，之后每条在页面内高亮相对前一条的差异——新增元素绿框、被移除的节点克隆回当前页**原位置**并用红色半透明遮罩盖住、附「删除」角标（直接看出页面哪里被删了）、属性或结构差异描边整个元素、纯文本差异精确高亮到具体文字；面板标题下方同时给出「新增 N · 移除 N」简报与节点清单（悬停查看路径），简报行的 ↑/↓ 可在本面板全部变更间循环跳转、自动滚动到视口居中；新增/移除按广度优先顺序记录且只记最顶层节点。记录保存在 `chrome.storage.local`。

飞书文档（`*.feishu.cn` / `*.feishu-doc.cn` / `*.larksuite.com` / `*.larkoffice.com`）会额外提取资源：图片取 `img[src]` 与 `data-src` 懒加载图；视频取 `video[src]`、`source[src]` 及视频扩展名的 `data-src`；文件取带 `download`、常见附件扩展名或飞书资源地址的链接。界面元素（头像、表情、工具栏等）按类名关键字排除。识别结果按文档顺序编号，同名资源复用首次编号，页面对应节点替换为 `{{IMAGE:1}}` / `{{VIDEO:1}}` / `{{FILE:1}}` 占位符。

自建域名部署的飞书不落在 `*.feishu.cn` 上。设置页「SavePage 解析」提供域名 → 解析器映射：每行一个域名 + 解析器（飞书文档 / 通用），`example.com` 匹配自身及所有子域，也接受 `*.example.com` 或完整 URL。默认内置 `larkenterprise.com → 飞书文档`；上述飞书官方域名始终按飞书文档解析。未匹配的域名走「通用」。规则保存在 `chrome.storage.local` 的 `page-parsers` 键下，切换规则后点「重新获取」重新解析。

### Cookie 同步

设置页支持新增、切换和删除多个同步接口配置。每个配置独立维护名称、接口地址、同步范围、加密方式、UUID、密码、定时开关、间隔和同步状态。旧版单接口配置自动迁移。默认接口为 `http://127.0.0.1:2022/api/cookies/update`。

- 「保存当前」仅保存选中配置；「保存并同步当前」保存后立即上传。配置标签的 `*` 表示有未保存内容，切换不丢失编辑。
- 域名列表每行一个域名，支持完整 URL、`.example.com`、`*.example.com`、`*`，均匹配子域。仅同步勾选且匹配的域名；列表为空或全部取消勾选时不上传任何 Cookie。
- 定时同步默认关闭；开启并保存后关闭弹窗仍会执行。间隔 0.5～1440 分钟，浏览器休眠时不保证准点。一个接口失败不阻止其他接口。
- 配置和同步状态（包含加密密码）保存在 `chrome.storage.local`，不持久化浏览器 Cookie 副本。扩展请求 HTTP(S) 主机权限，以读取 Cookie 并访问用户指定的同步接口。

#### 加密协议

支持不加密、AES-128-CBC（固定 IV）、AES-256-CBC（兼容模式），与服务端现有协议兼容。加密时 UUID、密码应与服务端 `config.yaml` 的 `cookie.uuid`、`cookie.password` 一致。

两种加密模式都先取 `MD5(UUID + "-" + 密码)` 十六进制字符串的前 16 个字符：固定 IV 模式将其作为 UTF-8 密钥、全零 IV；兼容模式将其作为口令，经带随机盐的 OpenSSL 旧式派生得到 AES-256 密钥和 IV，输出含 `Salted__` 头的 Base64。报文字段为 `uuid`、`encrypted`、`crypto_type`。不能仅凭相同 AES 名称与任意接口互通。

## 版本与图标

- 显示版本读取 `manifest.json` 的 `version_name`（当前 `v260830`），Chrome 内部版本使用对应的 `26.8.30`。修改版本时需同步 `version` 与 `version_name` 两个字段。
- 图标源自 `assets/icons/logo.svg`，`assets/icons/` 提供 16–256 像素 PNG、独立 ICO 及全尺寸 `icon.ico`。修改源 SVG 后可运行 `bash scripts/generate-icons.sh` 重新导出（需要 `rsvg-convert` 和 ImageMagick；运行扩展不需要）。

## 目录结构

```text
manifest.json        # Manifest V3 配置
src/background.js    # Service Worker：消息与 alarm 事件
src/popup/           # 弹窗入口（popup.html/js/css），左侧菜单 + 右侧子页面
src/pages/           # cookie.js / savepage.js / settings.js 三个页面 View
src/models/          # store.js（导航与业务状态）、sync.model.js（配置校验、加密、定时任务）
assets/vendor/       # Timeless 0.33.0 运行时、dmui 组件、CryptoJS 4.2.0 独立副本
assets/icons/        # 全尺寸扩展图标
scripts/             # 图标导出与 UI 资产同步脚本
```

架构遵循 Model / View 分离：`src/models/store.js` 与 `src/models/sync.model.js` 维护全部业务状态与逻辑；`src/pages/*.js` 只根据状态渲染并通过 store 方法触发行为。视图节点通过 `attributes: { n: '<语义名称>' }` 声明语义标识。

`assets/vendor/` 内的 `dmui.js` / `dmui.css`、Timeless 运行时及水印图标复制自主前端源码树。`scripts/sync-ui-assets.sh` 仅在原主前端仓库（与本目录同级存在 `src/`、`public/` 时）可用；本独立仓库运行扩展无需执行它。CryptoJS 仅将 UMD 包装改为 ESM，算法与许可证保持原样。

## 权限

`activeTab`、`cookies`、`scripting`、`storage`、`alarms`、`clipboardWrite`，以及对 HTTP(S) 站点的 host 权限（读取 Cookie、访问用户指定的同步接口）。

## 开发检查

本目录无构建命令。对比算法可直接用浏览器打开 `test/compare.model.test.html`（逐对 diff、报告与预览构建）、`test/compare.render.test.html`（对比页渲染）、`test/compare.preview.test.html`（单页预览）、`test/popup.savepage.test.html`（弹窗暂存列表）检查；扩展改动后手动验证：加载扩展 → 打开任一 HTTP(S) 页面 → 暂存至少两条记录 → 开始对比。

Chrome API 依据：[模块 Service Worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)、[Cookie 权限](https://developer.chrome.com/docs/extensions/reference/api/cookies)、[定时任务](https://developer.chrome.com/docs/extensions/reference/api/alarms)、[脚本注入](https://developer.chrome.com/docs/extensions/reference/api/scripting)。
