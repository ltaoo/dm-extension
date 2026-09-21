import "../../assets/vendor/timeless.umd.min.js";
import { createInputStore, createCheckboxStore } from "../../assets/vendor/src/dmui.js";
import { default_settings, status_key, validate_settings } from "./sync.model.js";
import { comparison_groups_key, default_comparison_group, group_comparison_records, normalize_group_names } from "../compare/compare.model.js";
import { USER_SCRIPT_TYPES, build_list_code, build_script_code, describe_rule, describe_shape, detection_rules_key, evaluate_detection_rule, hostname_of, normalize_detection_rules, number_rules, read_baseline } from "../compare/detection.model.js";
import { build_clip_document, clip_options_key, clip_region, clips_key, default_clip_options, normalize_clip_options, normalize_clip_records } from "../clip/clip.model.js";

const { ref, computed, combine, vm } = globalThis.Timeless;

// 页面解析器：内置飞书域名 + 用户配置的域名规则共同决定。
const PARSER_LABELS = { generic: "通用", feishu: "飞书文档" };
const PAGE_TITLES = { cookie: "Cookie", savepage: "对比", clip: "剪藏", detect: "变更检测", settings: "设置" };
const parsers_key = "page-parsers";
const comparison_records_key = "comparison-records";
const comparison_group_key = "comparison-group";

function default_parsers() {
  return [{ id: "larkenterprise", domain: "larkenterprise.com", parser: "feishu" }];
}

// 在页面上下文中执行：克隆 document，移除 script 标签；命中飞书解析时额外提取文件、图片、视频，
// 并把对应节点替换为 {{IMAGE:1}} / {{VIDEO:1}} / {{FILE:1}} 占位符。
function read_page_html(rules) {
  const file_extension = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|csv|txt|md|json|mp3|m4a|wav|flac|apk|dmg|sketch|fig|psd|ai|eps|epub|srt|vtt|gz|tgz|tar)$/i;
  const video_extension = /\.(mp4|webm|mov|m4v|m3u8|flv|avi|mkv)$/i;
  const feishu_host = /(^|\.)(feishu\.cn|feishu-doc\.cn|larksuite\.com|larkoffice\.com)$/i;
  const feishu_asset = /(\/space\/api\/box\/)|(internal-api-drive-stream)|(mount_node_token=)|(mount_point=docx_(file|image|video))/i;
  const ui_hint = /(avatar|emoji|toolbar|icon|logo|badge|watermark)/i;

  function normalize_domain(value) {
    return String(value == null ? "" : value).trim().toLowerCase()
      .replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").replace(/^\*\./, "").replace(/^\./, "");
  }

  function resolve_parser(hostname, configured_rules) {
    const host = normalize_domain(hostname);
    if (!host) return "generic";
    if (feishu_host.test(host)) return "feishu";
    for (const rule of Array.isArray(configured_rules) ? configured_rules : []) {
      if (!rule || !rule.parser || rule.parser === "generic") continue;
      const domain = normalize_domain(rule.domain);
      if (!domain) continue;
      if (host === domain || host.endsWith("." + domain)) return rule.parser;
    }
    return "generic";
  }

  function absolute_url(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text || /^(blob|about|javascript|mailto):/i.test(text) || text.indexOf("data:") === 0) return "";
    try { return new URL(text, location.href).href; } catch (error) { return ""; }
  }

  function url_token(value) {
    try {
      const params = new URL(value).searchParams;
      return params.get("mount_node_token") || params.get("file_token") || params.get("token") || "";
    } catch (error) { return ""; }
  }

  function url_name(value) {
    try {
      const parts = decodeURIComponent(new URL(value).pathname).split("/").filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : "";
      return last.length > 160 ? "" : last;
    } catch (error) { return ""; }
  }

  function clean_text(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function is_ui_node(element) {
    for (let node = element; node && node.nodeType === 1 && node.tagName !== "BODY"; node = node.parentElement) {
      const class_name = typeof node.className === "string" ? node.className : "";
      if (ui_hint.test(class_name) || ui_hint.test(node.getAttribute("data-n") || "")) return true;
    }
    return false;
  }

  function placeholder(kind, index) {
    const span = document.createElement("span");
    span.setAttribute("data-n", "asset-placeholder");
    span.setAttribute("data-asset-kind", kind);
    span.setAttribute("data-asset-index", String(index));
    span.textContent = "{{" + kind.toUpperCase() + ":" + index + "}}";
    return span;
  }

  function unwrap(element) {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  }

  // canvas 的位图不在 DOM 里，克隆出来必然空白：把页面上每个 canvas 转成 base64 图片替换进克隆树，
  // 让暂存/复制的 HTML 仍能看到 canvas 区域。toDataURL 抛出（画布被跨域内容污染）时保留原节点。
  function replace_canvases(root) {
    const sources = Array.from(document.querySelectorAll("canvas"));
    const cloned = Array.from(root.querySelectorAll("canvas"));
    for (let index = 0; index < cloned.length; index += 1) {
      const source = sources[index];
      const target = cloned[index];
      if (!source || !target || !target.parentNode) continue;
      let data_url = "";
      try { data_url = source.toDataURL("image/png"); } catch (error) { continue; }
      if (!data_url || data_url === "data:,") continue;
      const image = document.createElement("img");
      for (const attribute of Array.from(target.attributes)) image.setAttribute(attribute.name, attribute.value);
      // canvas 的 width/height 是位图分辨率；换成图片后按画布实际渲染尺寸显示，避免 CSS 缩放失真。
      const width = source.clientWidth || source.width;
      const height = source.clientHeight || source.height;
      if (width && height) {
        image.setAttribute("width", String(width));
        image.setAttribute("height", String(height));
      }
      image.setAttribute("src", data_url);
      target.parentNode.replaceChild(image, target);
    }
  }

  // 返回该资源在列表中的序号；重复资源沿用首次序号，便于同样替换为占位符。
  function collect(list, seen, item) {
    if (!item.url) return 0;
    if (seen.has(item.url)) {
      const existing = list.find((entry) => entry.url === item.url);
      return existing ? existing.index : 0;
    }
    seen.add(item.url);
    item.index = list.length + 1;
    list.push(item);
    return item.index;
  }

  const root = document.documentElement.cloneNode(true);
  for (const node of Array.from(root.querySelectorAll("script,noscript,template"))) node.remove();
  replace_canvases(root);

  const parser = resolve_parser(location.hostname, rules);
  const feishu = parser === "feishu";
  const images = [];
  const videos = [];
  const files = [];
  const seen = { image: new Set(), video: new Set(), file: new Set() };
  const targets = [];

  if (feishu) {
    for (const element of Array.from(root.querySelectorAll("img"))) {
      const src = absolute_url(element.getAttribute("src") || element.getAttribute("data-src"));
      if (!src || is_ui_node(element)) continue;
      const item = {
        url: src,
        name: clean_text(element.getAttribute("alt")) || clean_text(element.getAttribute("data-name")) || url_name(src),
        token: element.getAttribute("data-token") || url_token(src),
        width: Number(element.getAttribute("width")) || 0,
        height: Number(element.getAttribute("height")) || 0,
      };
      const index = collect(images, seen.image, item);
      if (index) targets.push({ kind: "image", element, index });
    }
    for (const element of Array.from(root.querySelectorAll("video"))) {
      const source = element.querySelector("source[src]");
      const src = absolute_url(element.getAttribute("src") || (source ? source.getAttribute("src") : ""));
      if (!src) continue;
      const item = {
        url: src,
        name: clean_text(element.getAttribute("data-name")) || url_name(src),
        poster: absolute_url(element.getAttribute("poster")),
        token: element.getAttribute("data-token") || url_token(src),
      };
      const index = collect(videos, seen.video, item);
      if (index) targets.push({ kind: "video", element, index });
    }
    for (const element of Array.from(root.querySelectorAll("[data-video-src],[data-src]"))) {
      if (element.tagName === "IMG") continue;
      const src = absolute_url(element.getAttribute("data-video-src") || element.getAttribute("data-src"));
      if (!src || !video_extension.test(src.split("?")[0])) continue;
      const item = { url: src, name: url_name(src), poster: "", token: url_token(src) };
      const index = collect(videos, seen.video, item);
      if (index) targets.push({ kind: "video", element, index });
    }
    for (const element of Array.from(root.querySelectorAll("a[href]"))) {
      const href = absolute_url(element.getAttribute("href"));
      if (!href) continue;
      const thumbnail = element.querySelector("img[src],img[data-src]");
      if (seen.image.has(href) || (thumbnail && seen.image.has(absolute_url(thumbnail.getAttribute("src") || thumbnail.getAttribute("data-src"))))) {
        unwrap(element); // 图片灯箱包裹层，去掉后只留占位符
        continue;
      }
      if (seen.video.has(href)) continue;
      let path = href;
      try { path = new URL(href).pathname; } catch (error) { /* 保留原始值 */ }
      const is_asset = element.hasAttribute("download") || file_extension.test(path) || feishu_asset.test(href);
      if (!is_asset) continue;
      const item = {
        url: href,
        name: clean_text(element.textContent) || clean_text(element.getAttribute("data-name")) || clean_text(element.getAttribute("title")) || url_name(href),
        token: element.getAttribute("data-token") || url_token(href),
      };
      const index = collect(files, seen.file, item);
      if (index) targets.push({ kind: "file", element, index });
    }
    for (const target of targets) {
      if (!target.element.parentNode) continue;
      target.element.parentNode.replaceChild(placeholder(target.kind, target.index), target.element);
    }
  }

  return {
    title: clean_text(document.title),
    url: location.href,
    parser,
    html: root.outerHTML,
    images,
    videos,
    files,
  };
}

export function CookieViewModel(client = chrome, clipboard = navigator.clipboard, confirm_remove = (message) => window.confirm(message)) {
  const manifest = client.runtime.getManifest();
  const cookies_ = ref([]);
  const selected_ = ref(new Set());
  const profiles_ = ref([default_settings()]);
  const saved_profiles_ = ref([]);
  const active_profile_ = ref("default");
  const statuses_ = ref({});
  const settings_ = combine({ profiles: profiles_, active: active_profile_ }, ({ profiles, active }) => profiles.find((profile) => profile.id === active) || profiles[0]);
  const status_ = combine({ statuses: statuses_, active: active_profile_ }, ({ statuses, active }) => ({ syncing: false, message: "尚未同步 Cookie", ...statuses[active] }));
  const url_ = ref("");
  // 变更检测规则与 Cookie 同步共用同一套 hostname 解析（仅 http(s) 有效，见 detection.model.js）。
  const page_domain_ = computed(url_, hostname_of);
  const message_ = ref("");
  const cookie_feedback_ = ref("");
  const copied_domain_ = ref("");
  const loading_ = ref(false);
  const busy_ = ref(true);
  const page_ = ref("cookie");
  const leaving_page_ = ref("");
  const page_html_ = ref("");
  const page_title_ = ref("");
  const page_images_ = ref([]);
  const page_videos_ = ref([]);
  const page_files_ = ref([]);
  const page_parser_ = ref("generic");
  const page_parsers_ = ref([]);
  const settings_menu_ = ref("cookie-sync");
  const parsers_message_ = ref("");
  let hydrating_parsers = false;
  const savepage_feedback_ = ref("");
  const savepage_copied_ = ref(false);
  const savepage_loading_ = ref(false);
  const comparison_records_ = ref([]);
  const comparison_group_ = ref(default_comparison_group);
  const comparison_group_names_ = ref([default_comparison_group]);
  const detection_rules_ = ref([]);
  const detection_results_ = ref({});
  const detection_feedback_ = ref("");
  const detection_loading_ = ref("");
  const clip_records_ = ref([]);
  const clip_options_ = ref(default_clip_options());
  const clip_loading_ = ref(false);
  const clip_feedback_ = ref("");
  const clip_copied_ = ref("");
  // JS 函数规则要用 chrome.userScripts 执行；Chrome 138 起用户还需在扩展详情页手动开启「允许用户脚本」。
  // 页面加载时定一次：未开启时 chrome.userScripts 为 undefined，该类型的规则置灰。
  const script_supported_ = ref(typeof client?.userScripts?.execute === "function");
  // 分组清单以 comparison_group_names_ 为准（固定存在），仅补上记录里出现过的历史分组名，避免旧数据丢失归属。
  const comparison_groups_ = combine({ names: comparison_group_names_, records: comparison_records_, active: comparison_group_ }, ({ names, records, active }) => {
    const result = [...names];
    const seen = new Set(result);
    for (const group of group_comparison_records(records)) {
      if (!seen.has(group.name)) { seen.add(group.name); result.push(group.name); }
    }
    if (active && !seen.has(active)) result.push(active);
    return result.map((name) => ({ name }));
  });
  // 当前选中分组内的记录：弹窗列表、计数与「开始对比」可用性都以它为准。
  const comparison_current_ = combine({ records: comparison_records_, group: comparison_group_ }, ({ records, group }) => {
    const current = group_comparison_records(records).find((item) => item.name === group);
    return current ? current.records : [];
  });
  let page_transition_timer;
  let copy_feedback_timer;
  let savepage_copy_timer;
  let clip_copy_timer;
  let navigated = false;
  let hydrating_domains = false;
  const profile_buttons = new Map();
  const domain_buttons = new Map();
  const group_buttons = new Map();
  const record_buttons = new Map();
  const rule_buttons = new Map();
  const clip_buttons = new Map();
  const selected_cookies_ = combine({ cookies: cookies_, selected: selected_ }, ({ cookies, selected }) => cookies.filter((_, index) => selected.has(index)));

  async function refresh() {
    if (loading_.value) return;
    loading_.as(true);
    cookie_feedback_.as("");
    url_.as("");
    cookies_.as([]);
    selected_.as(new Set());
    try {
      const [tab] = await client.tabs.query({ active: true, currentWindow: true });
      url_.as(tab?.url || "");
      if (!/^https?:\/\//i.test(url_.value)) throw new Error("当前页面不支持读取 Cookie");
      const stores = await client.cookies.getAllCookieStores();
      const store = stores.find((item) => item.tabIds.includes(tab.id));
      const cookies = await client.cookies.getAll({ url: url_.value, ...(store ? { storeId: store.id } : {}) });
      cookies.sort((a, b) => a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
      cookies_.as(cookies);
      selected_.as(new Set(cookies.map((_, index) => index)));
    } catch (error) {
      cookie_feedback_.as(error.message);
    } finally {
      loading_.as(false);
    }
  }

  function normalize_parsers(list) {
    return (Array.isArray(list) ? list : []).map((item, index) => ({
      id: String(item?.id || `parser-${index}`),
      domain: String(item?.domain ?? "").trim(),
      parser: PARSER_LABELS[item?.parser] ? item.parser : "generic",
    }));
  }

  async function load_parsers() {
    try {
      const saved = await client.storage.local.get(parsers_key);
      const list = normalize_parsers(saved?.[parsers_key]);
      page_parsers_.as(list.length ? list : default_parsers());
    } catch (error) {
      page_parsers_.as(default_parsers());
      parsers_message_.as(`读取解析配置失败：${error.message}`);
    }
  }

  async function save_parsers() {
    const list = normalize_parsers(page_parsers_.value);
    page_parsers_.as(list);
    try {
      await client.storage.local.set({ [parsers_key]: list });
      parsers_message_.as("解析配置已保存");
    } catch (error) {
      parsers_message_.as(`保存失败：${error.message}`);
    }
  }

  async function load_comparisons() {
    try {
      const saved = await client.storage.local.get([comparison_records_key, comparison_group_key, comparison_groups_key]);
      const records = Array.isArray(saved?.[comparison_records_key]) ? saved[comparison_records_key] : [];
      comparison_records_.as(records);
      if (typeof saved?.[comparison_group_key] === "string" && saved[comparison_group_key].trim()) {
        comparison_group_.as(saved[comparison_group_key].trim());
      }
      const stored = normalize_group_names(saved?.[comparison_groups_key]);
      const names = [...stored];
      // 旧数据只有分组名（记录里的 group 字段），没有分组清单：把它们登记为固定分组。
      for (const group of group_comparison_records(records)) {
        if (!names.includes(group.name)) names.push(group.name);
      }
      if (!names.length) names.push(default_comparison_group);
      comparison_group_names_.as(names);
      if (names.length !== stored.length) await client.storage.local.set({ [comparison_groups_key]: names });
    } catch (error) {
      savepage_feedback_.as(`读取暂存记录失败：${error.message}`);
    }
  }

  async function load_detection_rules() {
    try {
      const saved = await client.storage.local.get(detection_rules_key);
      detection_rules_.as(normalize_detection_rules(saved?.[detection_rules_key]));
    } catch (error) {
      detection_rules_.as([]);
      detection_feedback_.as(`读取变更检测规则失败：${error.message}`);
    }
  }

  async function load_clips() {
    try {
      const saved = await client.storage.local.get([clips_key, clip_options_key]);
      clip_records_.as(normalize_clip_records(saved?.[clips_key]));
      clip_options_.as(normalize_clip_options(saved?.[clip_options_key]));
    } catch (error) {
      clip_records_.as([]);
      clip_feedback_.as(`读取剪藏记录失败：${error.message}`);
    }
  }

  // 颜色 / 内容规则：注入自包含求值函数到页面主世界。
  async function run_page_rule(rule, tab_id) {
    const injected = await client.scripting.executeScript({ target: { tabId: tab_id }, func: evaluate_detection_rule, args: [rule] });
    const result = injected?.[0]?.result;
    if (!result || typeof result !== "object") throw new Error("未获取到检测结果");
    return result;
  }

  // 写回列表对比规则的基线（首次检测时注入代码回传 snapshot）：校验 → 读改写 detection_rules_ 与 storage。
  // 返回错误文案；成功返回空串。写法与 remove_detection_rule 一致。
  async function record_baseline(id, snapshot) {
    const checked = read_baseline(snapshot);
    if (checked.error) return checked.error;
    const rules = detection_rules_.value.map((rule) => rule.id === id ? { ...rule, baseline: checked.baseline } : rule);
    try {
      await client.storage.local.set({ [detection_rules_key]: rules });
      detection_rules_.as(rules);
      return "";
    } catch (error) {
      return error.message;
    }
  }

  // 用户脚本规则（JS 函数 / 列表对比）：用 userScripts 在 USER_SCRIPT 世界执行宿主生成的代码。
  // 宿主只嵌选择器与用户函数体，内容一律运行时现取；同 group_id 的 JS 函数规则按 created_at 编号，
  // 编号即函数里 others 的键（与预览页画出的框号一致）。
  // 用户代码的语法错误会让整段脚本解析失败，try/catch 兜不住 —— 那时拿到的 InjectionResult.error
  // 在这里统一转成带 error 标记的同形结果。
  async function run_user_rule(rule, tab_id) {
    try {
      if (!script_supported_.value) throw new Error("当前浏览器未开启「允许用户脚本」，无法执行该规则");
      const code = rule.type === "list"
        ? build_list_code(rule)
        : build_script_code(rule, number_rules(detection_rules_.value, rule));
      const injected = await client.userScripts.execute({ target: { tabId: tab_id }, js: [{ code }] });
      const entry = injected?.[0];
      if (entry?.error) throw new Error(`注入失败：${entry.error}`);
      const result = entry?.result;
      if (!result || typeof result !== "object") throw new Error("未获取到检测结果");
      // 首次检测：注入代码回传 snapshot，由宿主写进规则的 baseline 后丢弃（UI 不持有大对象）。
      if (result.baseline === true && rule.type === "list") {
        const snapshot = result.snapshot;
        delete result.snapshot;
        const error = await record_baseline(rule.id, snapshot);
        if (error) { result.error = true; result.message = `基线写入失败：${error}`; }
      }
      return result;
    } catch (error) {
      return { found: false, passed: false, kind: rule.type, actual: "", message: error.message, error: true };
    }
  }

  async function save_group_names(names) {
    comparison_group_names_.as(names);
    try {
      await client.storage.local.set({ [comparison_groups_key]: names });
    } catch (error) {
      savepage_feedback_.as(`分组保存失败：${error.message}`);
    }
  }

  async function refresh_page() {
    if (savepage_loading_.value) return;
    savepage_loading_.as(true);
    savepage_feedback_.as("");
    try {
      const [tab] = await client.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) url_.as(tab.url);
      if (!tab?.id) throw new Error("未获取到当前标签页");
      if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("当前页面不支持读取内容");
      const injected = await client.scripting.executeScript({ target: { tabId: tab.id }, func: read_page_html, args: [page_parsers_.value] });
      const result = injected?.[0]?.result;
      if (!result || typeof result.html !== "string" || !result.html) throw new Error("未获取到页面内容");
      page_html_.as(result.html);
      page_title_.as(result.title || "");
      page_parser_.as(PARSER_LABELS[result.parser] ? result.parser : "generic");
      page_images_.as(Array.isArray(result.images) ? result.images : []);
      page_videos_.as(Array.isArray(result.videos) ? result.videos : []);
      page_files_.as(Array.isArray(result.files) ? result.files : []);
    } catch (error) {
      page_html_.as("");
      page_title_.as("");
      page_parser_.as("generic");
      page_images_.as([]);
      page_videos_.as([]);
      page_files_.as([]);
      savepage_feedback_.as(error.message);
    } finally {
      savepage_loading_.as(false);
    }
  }

  async function send(action, value) {
    const settings = ["save", "sync"].includes(action) ? validate_settings(settings_.value) : value;
    const response = await client.runtime.sendMessage({ action, settings });
    if (!response?.success) throw new Error(response?.error || "扩展后台未响应");
    saved_profiles_.as(response.profiles);
    if (action === "get") {
      profiles_.as(response.profiles);
    } else {
      const profiles = profiles_.value.filter((profile) => action !== "remove" || profile.id !== value.id)
        .map((profile) => ["save", "sync"].includes(action) && profile.id === settings.id
          ? response.profiles.find((item) => item.id === profile.id) : profile);
      for (const profile of response.profiles) {
        if (!profiles.some((item) => item.id === profile.id)) profiles.push(profile);
      }
      profiles_.as(profiles);
    }
    if (!profiles_.value.some((profile) => profile.id === active_profile_.value)) active_profile_.as(profiles_.value[0].id);
    statuses_.as(response.statuses);
  }

  function on_storage_changed(changes, area) {
    if (area === "local" && changes[status_key]?.newValue) statuses_.as(changes[status_key].newValue);
  }

  const methods = {
    add_domain() {
      if (busy_.value) return;
      methods.update("domainFilter.domains", [...settings_.value.domainFilter.domains, { enabled: true, domain: "" }]);
      const input = ui.domains$.fields.at(-1).field.fields.domain.input;
      queueMicrotask(() => input.focus());
    },
    remove_domain(index) {
      if (!busy_.value) methods.update("domainFilter.domains", settings_.value.domainFilter.domains.filter((_, i) => i !== index));
    },
    update_domains() {
      if (!hydrating_domains) methods.update("domainFilter.domains", ui.domains$.value);
    },
    select_profile(id) {
      if (!busy_.value && profiles_.value.some((profile) => profile.id === id)) {
        active_profile_.as(id);
        message_.as("");
      }
    },
    add_profile() {
      if (busy_.value) return;
      const profile = default_settings(crypto.randomUUID(), `配置 ${profiles_.value.length + 1}`);
      profiles_.as([...profiles_.value, profile]);
      active_profile_.as(profile.id);
      message_.as("新配置尚未保存");
    },
    async remove_profile() {
      if (busy_.value || !state.can_remove.value) return;
      const profile = settings_.value;
      if (!confirm_remove(`删除同步配置「${profile.name || "未命名"}」？`)) return;
      busy_.as(true);
      try {
        if (saved_profiles_.value.some((item) => item.id === profile.id)) {
          await send("remove", { id: profile.id });
        } else {
          profiles_.as(profiles_.value.filter((item) => item.id !== profile.id));
          active_profile_.as(profiles_.value[0].id);
        }
        profile_buttons.delete(profile.id);
        message_.as("配置已删除");
      } catch (error) {
        message_.as(error.message);
      } finally {
        busy_.as(false);
      }
    },
    navigate(page) {
      if (!["cookie", "settings", "savepage", "clip", "detect"].includes(page) || page === page_.value) return;
      navigated = true;
      clearTimeout(page_transition_timer);
      leaving_page_.as(page_.value);
      page_.as(page);
      client.storage.local.set({ "popup-page": page }).catch((error) => message_.as(`保存页面位置失败：${error.message}`));
      page_transition_timer = setTimeout(() => leaving_page_.as(""), 180);
    },
    async ready() {
      client.storage.onChanged.addListener(on_storage_changed);
      await Promise.all([
        client.storage.local.get("popup-page").then((saved) => {
          if (!navigated && ["cookie", "settings", "savepage", "clip", "detect"].includes(saved["popup-page"])) page_.as(saved["popup-page"]);
        }).catch((error) => message_.as(error.message)),
        load_parsers(),
        load_comparisons(),
        load_clips(),
        load_detection_rules(),
        refresh(),
        send("get").catch((error) => message_.as(error.message)),
      ]);
      await refresh_page(); // 需要等解析规则加载完再抓取
      busy_.as(false);
    },
    dispose() {
      clearTimeout(page_transition_timer);
      clearTimeout(copy_feedback_timer);
      clearTimeout(savepage_copy_timer);
      clearTimeout(clip_copy_timer);
      client.storage.onChanged.removeListener(on_storage_changed);
    },
    refresh,
    refresh_page,
    update(field, value) {
      const next = structuredClone(settings_.value);
      const [group, key] = field.split(".");
      if ((key ? next[group][key] : next[group]) === value) return;
      if (key) next[group][key] = value;
      else next[group] = value;
      profiles_.as(profiles_.value.map((profile) => profile.id === next.id ? next : profile));
    },
    select(index, checked) {
      const selected = new Set(selected_.value);
      if (checked) selected.add(index);
      else selected.delete(index);
      selected_.as(selected);
    },
    select_all(checked) {
      selected_.as(new Set(checked ? cookies_.value.map((_, index) => index) : []));
    },
    async copy_domain(domain = page_domain_.value) {
      if (!domain || loading_.value) return;
      clearTimeout(copy_feedback_timer);
      copied_domain_.as("");
      try {
        await clipboard.writeText(domain);
        cookie_feedback_.as("");
        copied_domain_.as(domain);
        copy_feedback_timer = setTimeout(() => copied_domain_.as(""), 3000);
      } catch (error) {
        cookie_feedback_.as(`复制失败：${error.message}`);
      }
    },
    async copy(all = false) {
      const cookies = all ? cookies_.value : selected_cookies_.value;
      if (!cookies.length) return cookie_feedback_.as("没有可复制的 Cookie");
      try {
        await clipboard.writeText(cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
        cookie_feedback_.as(`已复制 ${cookies.length} 项 Cookie`);
      } catch (error) {
        cookie_feedback_.as(`复制失败：${error.message}`);
      }
    },
    select_settings_menu(name) {
      if (!["cookie-sync", "savepage"].includes(name) || name === settings_menu_.value) return;
      settings_menu_.as(name);
    },
    add_parser() {
      if (busy_.value) return;
      page_parsers_.as([...page_parsers_.value, { id: crypto.randomUUID(), domain: "", parser: "feishu" }]);
      const input = ui.parsers$.fields.at(-1).field.fields.domain.input;
      queueMicrotask(() => input.focus());
      parsers_message_.as("新增规则已保存");
      save_parsers();
    },
    remove_parser(index) {
      if (busy_.value) return;
      page_parsers_.as(page_parsers_.value.filter((_, position) => position !== index));
      parsers_message_.as("规则已删除");
      save_parsers();
    },
    update_parsers() {
      if (hydrating_parsers) return;
      const rows = ui.parsers$.value;
      page_parsers_.as(page_parsers_.value.map((item, index) => ({
        ...item,
        domain: String(rows?.[index]?.domain ?? "").trim(),
        parser: PARSER_LABELS[rows?.[index]?.parser] ? rows[index].parser : "generic",
      })));
      save_parsers();
    },
    select_group(name) {
      if (!name || name === comparison_group_.value) return;
      comparison_group_.as(name);
      client.storage.local.set({ [comparison_group_key]: name }).catch(() => {});
    },
    add_group() {
      const names = new Set(comparison_group_names_.value);
      let index = 1;
      while (names.has(`分组 ${index}`)) index += 1;
      const name = `分组 ${index}`;
      save_group_names([...comparison_group_names_.value, name]);
      methods.select_group(name);
    },
    async remove_group(name) {
      const names = comparison_group_names_.value;
      if (names.length <= 1) return savepage_feedback_.as("至少保留一个分组");
      if (!names.includes(name)) return;
      if (!confirm_remove(`删除分组「${name}」及其全部暂存记录？`)) return;
      const next = names.filter((item) => item !== name);
      const records = comparison_records_.value.filter((record) => (typeof record.group === "string" && record.group.trim() ? record.group : default_comparison_group) !== name);
      try {
        await client.storage.local.set({ [comparison_groups_key]: next });
        if (records.length) await client.storage.local.set({ [comparison_records_key]: records });
        else await client.storage.local.remove(comparison_records_key);
        comparison_group_names_.as(next);
        comparison_records_.as(records);
        group_buttons.delete(name);
        if (comparison_group_.value === name) methods.select_group(next[0]);
        savepage_feedback_.as(`已删除分组「${name}」`);
      } catch (error) {
        savepage_feedback_.as(`删除分组失败：${error.message}`);
      }
    },
    async stage_page() {
      if (!page_html_.value) return savepage_feedback_.as("没有可暂存的页面内容");
      const records = [...comparison_records_.value, {
        id: crypto.randomUUID(),
        group: comparison_group_.value,
        title: page_title_.value || url_.value || `记录 ${comparison_records_.value.length + 1}`,
        url: url_.value,
        html: page_html_.value,
        created_at: Date.now(),
      }];
      try {
        await client.storage.local.set({ [comparison_records_key]: records });
        comparison_records_.as(records);
        savepage_feedback_.as(`已暂存：${records.at(-1).title}`);
      } catch (error) {
        savepage_feedback_.as(`暂存失败：${error.message}`);
      }
    },
    async copy_page() {
      const content = page_html_.value;
      if (!content) return savepage_feedback_.as("没有可复制的页面内容");
      clearTimeout(savepage_copy_timer);
      try {
        await clipboard.writeText(content);
        savepage_feedback_.as(`已复制 ${content.length.toLocaleString()} 个字符`);
        savepage_copied_.as(true);
        savepage_copy_timer = setTimeout(() => savepage_copied_.as(false), 3000);
      } catch (error) {
        savepage_copied_.as(false);
        savepage_feedback_.as(`复制失败：${error.message}`);
      }
    },
    async remove_record(id) {
      const record = comparison_records_.value.find((item) => item.id === id);
      if (!record) return;
      if (!confirm_remove(`删除暂存记录「${record.title}」？`)) return;
      const records = comparison_records_.value.filter((item) => item.id !== id);
      try {
        await client.storage.local.set({ [comparison_records_key]: records });
        comparison_records_.as(records);
        savepage_feedback_.as(`已删除：${record.title}`);
      } catch (error) {
        savepage_feedback_.as(`删除失败：${error.message}`);
      }
    },
    // 变更检测：规则按来源 hostname 限定，只有当前标签页同源才注入求值。
    async detect_rule(id) {
      if (detection_loading_.value) return;
      const rule = detection_rules_.value.find((item) => item.id === id);
      if (!rule) return;
      detection_loading_.as(id);
      try {
        const [tab] = await client.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) throw new Error("当前页面不支持变更检测");
        const host = hostname_of(tab.url);
        // hostname 不符时短路返回原因，不注入。
        if (!host || host !== rule.hostname) throw new Error(`规则来自 ${rule.hostname || "未知来源"}，与当前页面 ${host || "未知地址"} 不一致`);
        const result = USER_SCRIPT_TYPES.has(rule.type) ? await run_user_rule(rule, tab.id) : await run_page_rule(rule, tab.id);
        detection_results_.as({ ...detection_results_.value, [id]: result });
        detection_feedback_.as(`${rule.name}：${result.message}`);
      } catch (error) {
        detection_results_.as({ ...detection_results_.value, [id]: { found: false, passed: false, kind: rule.type, actual: "", message: error.message } });
        detection_feedback_.as(error.message);
      } finally {
        detection_loading_.as("");
      }
    },
    async remove_detection_rule(id) {
      const rule = detection_rules_.value.find((item) => item.id === id);
      if (!rule) return;
      if (!confirm_remove(`删除变更检测规则「${rule.name}」？`)) return;
      const rules = detection_rules_.value.filter((item) => item.id !== id);
      try {
        await client.storage.local.set({ [detection_rules_key]: rules });
        detection_rules_.as(rules);
        rule_buttons.delete(id);
        const results = { ...detection_results_.value };
        delete results[id];
        detection_results_.as(results);
        detection_feedback_.as(`已删除：${rule.name}`);
      } catch (error) {
        detection_feedback_.as(`删除失败：${error.message}`);
      }
    },
    async preview_record(id) {
      const record = comparison_records_.value.find((item) => item.id === id);
      if (!record) return savepage_feedback_.as("未找到对应的暂存记录");
      try {
        await client.tabs.create({ url: `${client.runtime.getURL("src/compare/preview.html")}?id=${encodeURIComponent(id)}` });
      } catch (error) {
        savepage_feedback_.as(`打开预览失败：${error.message}`);
      }
    },
    async clear_comparisons() {
      const group_of = (record) => (typeof record.group === "string" && record.group.trim() ? record.group : default_comparison_group);
      // 只清空当前选中分组；其它分组的记录保留。
      const remaining = comparison_records_.value.filter((record) => group_of(record) !== comparison_group_.value);
      try {
        if (remaining.length) await client.storage.local.set({ [comparison_records_key]: remaining });
        else await client.storage.local.remove(comparison_records_key);
        comparison_records_.as(remaining);
        savepage_feedback_.as(`已清空分组「${comparison_group_.value}」的暂存记录`);
      } catch (error) {
        savepage_feedback_.as(`清空失败：${error.message}`);
      }
    },
    async start_comparison() {
      if (!state.comparison_ready.value) return savepage_feedback_.as("请先在当前分组暂存至少两个页面");
      try {
        await client.tabs.create({ url: client.runtime.getURL("src/compare/compare.html") });
      } catch (error) {
        savepage_feedback_.as(`打开对比页失败：${error.message}`);
      }
    },
    // 区域剪藏：把选择器注入当前页面（页内自建 Shadow DOM，页面样式影响不到它），
    // 随后关掉弹窗 —— 用户要在页面上拖动框选，弹窗挡在那里没法操作。
    // 真正的提取、自检、落库、开结果页都在 SW 里（见 background.js 的 clip-region 分支）。
    async start_clip() {
      if (clip_loading_.value) return;
      clip_loading_.as(true);
      clip_feedback_.as("");
      try {
        const [tab] = await client.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("未获取到当前标签页");
        if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("当前页面不支持区域剪藏");
        const options = normalize_clip_options(clip_options_.value);
        await client.scripting.executeScript({ target: { tabId: tab.id }, func: clip_region, args: [options] });
        await client.storage.local.set({ [clip_options_key]: options });
        window.close();
      } catch (error) {
        clip_feedback_.as(error.message);
      } finally {
        clip_loading_.as(false);
      }
    },
    async set_clip_option(name, value) {
      const options = normalize_clip_options({ ...clip_options_.value, [name]: Boolean(value) });
      clip_options_.as(options);
      try {
        await client.storage.local.set({ [clip_options_key]: options });
      } catch (error) {
        clip_feedback_.as(`保存剪藏选项失败：${error.message}`);
      }
    },
    async copy_clip(id) {
      const record = clip_records_.value.find((item) => item.id === id);
      if (!record) return clip_feedback_.as("未找到对应的剪藏记录");
      clearTimeout(clip_copy_timer);
      try {
        await clipboard.writeText(build_clip_document(record));
        clip_copied_.as(id);
        clip_feedback_.as(`已复制：${record.title}`);
        clip_copy_timer = setTimeout(() => clip_copied_.as(""), 3000);
      } catch (error) {
        clip_copied_.as("");
        clip_feedback_.as(`复制失败：${error.message}`);
      }
    },
    async open_clip(id) {
      const record = clip_records_.value.find((item) => item.id === id);
      if (!record) return clip_feedback_.as("未找到对应的剪藏记录");
      try {
        await client.tabs.create({ url: `${client.runtime.getURL("src/clip/clip.html")}?id=${encodeURIComponent(id)}` });
      } catch (error) {
        clip_feedback_.as(`打开剪藏结果失败：${error.message}`);
      }
    },
    async remove_clip(id) {
      const record = clip_records_.value.find((item) => item.id === id);
      if (!record) return;
      if (!confirm_remove(`删除剪藏记录「${record.title}」？`)) return;
      const records = clip_records_.value.filter((item) => item.id !== id);
      try {
        if (records.length) await client.storage.local.set({ [clips_key]: records });
        else await client.storage.local.remove(clips_key);
        clip_records_.as(records);
        clip_buttons.delete(id);
        clip_feedback_.as(`已删除：${record.title}`);
      } catch (error) {
        clip_feedback_.as(`删除失败：${error.message}`);
      }
    },
    async clear_clips() {
      const count = clip_records_.value.length;
      if (!count) return;
      if (!confirm_remove(`清空全部 ${count} 条剪藏记录？`)) return;
      try {
        await client.storage.local.remove(clips_key);
        clip_records_.as([]);
        clip_buttons.clear();
        clip_feedback_.as("已清空剪藏记录");
      } catch (error) {
        clip_feedback_.as(`清空失败：${error.message}`);
      }
    },
    async save(sync = false) {
      if (busy_.value) return;
      busy_.as(true);
      message_.as(sync ? "正在同步…" : "正在保存…");
      try {
        await send(sync ? "sync" : "save");
        message_.as(sync ? status_.value.message : `「${settings_.value.name}」已保存`);
      } catch (error) {
        message_.as(error.message);
      } finally {
        busy_.as(false);
      }
    },
  };

  const state = {
      profiles: profiles_, saved_profiles: saved_profiles_, active_profile: active_profile_, statuses: statuses_,
      cookie_feedback: cookie_feedback_, copied_domain: copied_domain_,
      page_domain_copied: combine({ copied: copied_domain_, domain: page_domain_ }, (s) => Boolean(s.domain) && s.copied === s.domain),
      profile_titles: combine({ profiles: profiles_, saved: saved_profiles_ }, ({ profiles, saved }) => Object.fromEntries(profiles.map((profile) => [profile.id,
        `${profile.name || "未命名"}${JSON.stringify(profile) !== JSON.stringify(saved.find((item) => item.id === profile.id)) ? " *" : ""}`,
      ]))),
      can_remove: combine({ profiles: profiles_, saved: saved_profiles_, active: active_profile_ }, (s) => s.profiles.length > 1 && (s.saved.length > 1 || !s.saved.some((profile) => profile.id === s.active))),
      page: page_,
      leaving_page: leaving_page_,
      title: computed(page_, (page) => PAGE_TITLES[page] || "Cookie"),
      version: ref(manifest.version_name || `v${manifest.version}`),
      cookies: cookies_, selected: selected_, settings: settings_, status: status_,
      url: url_, page_domain: page_domain_, message: message_, loading: loading_, busy: busy_,
      selected_count: computed(selected_cookies_, (items) => items.length),
      all_selected: combine({ cookies: cookies_, selected: selected_cookies_ }, ({ cookies, selected }) => cookies.length > 0 && cookies.length === selected.length),
      sync_busy: combine({ busy: busy_, statuses: statuses_ }, ({ busy, statuses }) => busy || Object.values(statuses).some((status) => status.syncing)),
      rows: computed(cookies_, (cookies) => cookies.map((cookie, index) => ({ ...cookie, index }))),
      table_status: computed(cookies_, (cookies) => cookies.length ? "normal" : "empty"),
      sync_message: computed(status_, (status) => status.message + (status.lastSuccessAt ? ` · 最近成功 ${new Date(status.lastSuccessAt).toLocaleString()}` : "")),
      encrypted: computed(settings_, (settings) => settings.encryption.method !== "none"),
      page_html: page_html_,
      page_parser: page_parser_,
      page_parser_label: computed(page_parser_, (parser) => PARSER_LABELS[parser] || parser),
      page_title: page_title_,
      page_parsers: page_parsers_,
      settings_menu: settings_menu_,
      parsers_message: parsers_message_,
      page_images: page_images_,
      page_videos: page_videos_,
      page_files: page_files_,
      savepage_feedback: savepage_feedback_,
      savepage_copied: savepage_copied_,
      savepage_loading: savepage_loading_,
      comparison_records: comparison_records_,
      comparison_groups: comparison_groups_,
      comparison_group: comparison_group_,
      can_remove_group: computed(comparison_groups_, (groups) => groups.length > 1),
      comparison_current_records: computed(comparison_current_, (records) => records.map((record, index) => ({ ...record, index }))),
      comparison_count: computed(comparison_current_, (records) => records.length),
      comparison_ready: computed(comparison_current_, (records) => records.length >= 2),
      detection_rules: detection_rules_,
      detection_results: detection_results_,
      detection_feedback: detection_feedback_,
      detection_loading: detection_loading_,
      script_supported: script_supported_,
      // 每条规则附上「当前页面能否检测」与原因：规则按其来源 hostname 限定，
      // 用户脚本规则（JS 函数 / 列表对比）还要求当前浏览器已开启「允许用户脚本」。
      detection_rows: combine({ rules: detection_rules_, host: page_domain_, script_supported: script_supported_ }, ({ rules, host, script_supported }) => rules.map((rule) => {
        const source_ok = Boolean(host) && Boolean(rule.hostname) && host === rule.hostname;
        const detectable = source_ok && (!USER_SCRIPT_TYPES.has(rule.type) || script_supported);
        const reason = detectable ? ""
          : !source_ok ? (host ? `规则来自 ${rule.hostname || "未知来源"}，与当前页面 ${host} 不一致` : "当前页面不是 HTTP(S) 页面")
          : "需在扩展详情页开启「允许用户脚本」";
        return { ...rule, condition: describe_rule(rule), shape_label: describe_shape(rule), detectable, reason };
      })),
      detection_count: computed(detection_rules_, (rules) => rules.length),
      clip_records: clip_records_,
      clip_options: clip_options_,
      clip_loading: clip_loading_,
      clip_feedback: clip_feedback_,
      clip_copied: clip_copied_,
      clip_count: computed(clip_records_, (records) => records.length),
      // 只有 HTTP(S) 页面能剪：注入需要 activeTab，弹窗已在别的页面上时按钮置灰。
      clip_available: computed(url_, (url) => /^https?:\/\//i.test(url || "")),
  };
  const ui = {
    domain_copy_button(domain) {
      if (!domain_buttons.has(domain)) domain_buttons.set(domain, new vm.ButtonCore({ variant: "ghost", size: "icon-sm", onClick: () => methods.copy_domain(domain) }));
      return domain_buttons.get(domain);
    },
    profile_button(id) {
      if (!profile_buttons.has(id)) profile_buttons.set(id, new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.select_profile(id) }));
      return profile_buttons.get(id);
    },
    group_button(name) {
      if (!group_buttons.has(name)) {
        const tab = new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.select_group(name) });
        const remove = new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_group(name) });
        // 至少保留一个分组：只剩一个时删除按钮置灰。
        const update = () => state.can_remove_group.value ? remove.enable() : remove.disable();
        state.can_remove_group.subscribe({ onChange: update });
        update();
        group_buttons.set(name, { tab, remove });
      }
      return group_buttons.get(name);
    },
    record_button(id) {
      if (!record_buttons.has(id)) record_buttons.set(id, {
        open: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.preview_record(id) }),
        remove: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_record(id) }),
      });
      return record_buttons.get(id);
    },
    clip_button(id) {
      if (!clip_buttons.has(id)) clip_buttons.set(id, {
        open: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.open_clip(id) }),
        copy: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.copy_clip(id) }),
        remove: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_clip(id) }),
      });
      return clip_buttons.get(id);
    },
    rule_button(id) {
      if (!rule_buttons.has(id)) {
        const detect = new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => methods.detect_rule(id) });
        const remove = new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_detection_rule(id) });
        // 检测按钮的可用性：规则在当前页面不可检测、或已有检测在跑时置灰。
        const update = (disabled) => disabled ? detect.disable() : detect.enable();
        const source = combine({ rows: state.detection_rows, loading: detection_loading_ }, ({ rows, loading }) => {
          const row = rows.find((item) => item.id === id);
          return !row || !row.detectable || Boolean(loading);
        });
        update(source.value);
        source.subscribe({ onChange: update });
        rule_buttons.set(id, { detect, remove });
      }
      return rule_buttons.get(id);
    },
    domains$: new vm.ArrayFieldCore({
      label: "域名列表",
      field(index) {
        const field = new vm.ObjectFieldCore({ fields: {
          enabled: new vm.SingleFieldCore({ input: new vm.CheckboxCore({ checked: true, onChange: methods.update_domains }) }),
          domain: new vm.SingleFieldCore({ input: new vm.InputCore({ defaultValue: "", placeholder: "example.com 或完整 URL", allowClear: false, onChange: methods.update_domains }) }),
        } });
        field.remove$ = new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_domain(index) });
        return field;
      },
    }),
    parsers$: new vm.ArrayFieldCore({
      label: "域名解析规则",
      field(index) {
        const field = new vm.ObjectFieldCore({ fields: {
          domain: new vm.SingleFieldCore({ input: new vm.InputCore({ defaultValue: "", placeholder: "例如：larkenterprise.com", allowClear: false, onChange: methods.update_parsers }) }),
          parser: new vm.SingleFieldCore({ input: new vm.SelectCore({
            defaultValue: "feishu",
            position: "popper",
            options: Object.entries(PARSER_LABELS).map(([value, label]) => new vm.SelectItemCore({ value, label })),
            onChange: methods.update_parsers,
          }) }),
        } });
        field.remove$ = new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove_parser(index) });
        return field;
      },
    }),
    settings_menu: [
      { name: "cookie-sync", title: "Cookie 同步" },
      { name: "savepage", title: "SavePage 解析" },
    ].map((item) => ({ ...item, button$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.select_settings_menu(item.name) }) })),
    add_parser$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.add_parser }),
    add_domain$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.add_domain }),
    add_profile$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.add_profile }),
    add_group$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.add_group }),
    remove_profile$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: methods.remove_profile }),
    menu: [
      { name: "cookie", title: "Cookie", icon: "file-lock" },
      { name: "savepage", title: "对比", icon: "file-code" },
      { name: "clip", title: "剪藏", icon: "scroll-text" },
      { name: "detect", title: "变更检测", icon: "radio-tower" },
      { name: "settings", title: "设置", icon: "settings" },
    ].map((item) => ({ ...item, button$: new vm.ButtonCore({ variant: "ghost", onClick: () => methods.navigate(item.name) }) })),
    refresh$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: refresh }),
    refresh_page$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: refresh_page }),
    stage_page$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.stage_page }),
    copy_page$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.copy_page }),
    clear_comparisons$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: methods.clear_comparisons }),
    start_comparison$: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: methods.start_comparison }),
    start_clip$: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: methods.start_clip }),
    clear_clips$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: methods.clear_clips }),
    clip_important$: createCheckboxStore({ checked: computed(clip_options_, (options) => options.important), onChange: (value) => methods.set_clip_option("important", value) }),
    clip_inline_images$: createCheckboxStore({ checked: computed(clip_options_, (options) => options.inline_images), onChange: (value) => methods.set_clip_option("inline_images", value) }),
    clip_pseudo$: createCheckboxStore({ checked: computed(clip_options_, (options) => options.materialize_pseudo), onChange: (value) => methods.set_clip_option("materialize_pseudo", value) }),
    copy_domain$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => methods.copy_domain() }),
    copy_all$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => methods.copy(true) }),
    copy_selected$: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: () => methods.copy() }),
    save$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => methods.save() }),
    sync$: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: () => methods.save(true) }),
    inputs: {},
    enabled$: createCheckboxStore({ checked: computed(settings_, (s) => s.enabled), onChange: (value) => methods.update("enabled", value) }),
    encryption$: new vm.SelectCore({
      defaultValue: "none",
      position: "popper",
      options: [
        ["none", "不加密"], ["aes-128-cbc-fixed", "AES-128-CBC（固定 IV）"], ["legacy", "AES-256-CBC（兼容模式）"],
      ].map(([value, label]) => new vm.SelectItemCore({ value, label })),
      onChange: (value) => methods.update("encryption.method", value),
    }),
  };
  for (const [field, type, placeholder] of [
    ["name", "text", "例如：本机、服务器 A"],
    ["endpoint", "url", "http://127.0.0.1:2022/api/cookies/update"],
    ["intervalMinutes", "number", "1"],
    ["encryption.uuid", "text", "与服务端一致的 UUID"],
    ["encryption.password", "password", "与服务端一致的密码"],
  ]) {
    const [group, key] = field.split(".");
    ui.inputs[field] = createInputStore({
      value: computed(settings_, (s) => String(key ? s[group][key] : s[group])),
      disabled: combine({ busy: busy_, encrypted: state.encrypted }, (s) => s.busy || (group === "encryption" && !s.encrypted)),
      type, placeholder, allowClear: false,
      onChange: (value) => methods.update(field, value),
    });
  }
  page_parsers_.subscribe({ onChange(list) {
    const rows = list.map((item) => ({ domain: item.domain, parser: item.parser }));
    const current = ui.parsers$.value || [];
    const same = current.length === rows.length && rows.every((row, index) => current[index]?.domain === row.domain && current[index]?.parser === row.parser);
    if (same) return;
    hydrating_parsers = true;
    try { ui.parsers$.setValue(rows); }
    finally { hydrating_parsers = false; }
  } });
  settings_.subscribe({ onChange(settings) {
    if (JSON.stringify(ui.domains$.value) !== JSON.stringify(settings.domainFilter.domains)) {
      hydrating_domains = true;
      try { ui.domains$.setValue(settings.domainFilter.domains); }
      finally { hydrating_domains = false; }
    }
    if (ui.encryption$.value !== settings.encryption.method) ui.encryption$.setValue(settings.encryption.method);
  } });
  for (const [source, button] of [
    [loading_, ui.refresh$],
    [savepage_loading_, ui.refresh_page$],
    [computed(page_html_, (content) => !content), ui.stage_page$],
    [computed(page_html_, (content) => !content), ui.copy_page$],
    [computed(comparison_current_, (records) => !records.length), ui.clear_comparisons$],
    [computed(state.comparison_ready, (ready) => !ready), ui.start_comparison$],
    [combine({ loading: clip_loading_, available: state.clip_available }, (s) => s.loading || !s.available), ui.start_clip$],
    [computed(clip_records_, (records) => !records.length), ui.clear_clips$],
    [combine({ loading: loading_, domain: page_domain_ }, (s) => s.loading || !s.domain), ui.copy_domain$],
    [computed(cookies_, (cookies) => !cookies.length), ui.copy_all$],
    [computed(state.selected_count, (count) => !count), ui.copy_selected$],
    [state.sync_busy, ui.save$], [state.sync_busy, ui.sync$],
    [busy_, ui.add_profile$], [busy_, ui.add_domain$], [busy_, ui.add_parser$],
    [combine({ busy: busy_, can: state.can_remove }, (s) => s.busy || !s.can), ui.remove_profile$],
  ]) {
    const update = (disabled) => disabled ? button.disable() : button.enable();
    update(source.value);
    source.subscribe({ onChange: update });
  }
  ui.row_selection = {
    width: 34,
    headerState: combine({ all: state.all_selected, count: state.selected_count }, ({ all, count }) => ({ checked: all, indeterminate: count > 0 && !all })),
    itemState: (cookie) => computed(selected_, (selected) => ({ checked: selected.has(cookie.index) })),
    allAriaLabel: "全选 Cookie",
    itemAriaLabel: (cookie) => `选择 Cookie ${cookie.name}`,
    onSelectAll: () => methods.select_all(!state.all_selected.value),
    onSelect: (cookie) => methods.select(cookie.index, !selected_.value.has(cookie.index)),
  };
  return { state, ui, methods };
}

export const cookie$ = CookieViewModel();
