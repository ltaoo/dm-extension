import "../../assets/vendor/timeless.umd.min.js";
import { createInputStore, createCheckboxStore } from "../../assets/vendor/src/dmui.js";
import { default_settings, status_key, validate_settings } from "./sync.model.js";

const { ref, computed, combine, vm } = globalThis.Timeless;

// 页面解析器：内置飞书域名 + 用户配置的域名规则共同决定。
const PARSER_LABELS = { generic: "通用", feishu: "飞书文档" };
const parsers_key = "page-parsers";

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
  const page_domain_ = computed(url_, (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
    } catch { return ""; }
  });
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
  const page_view_ = ref("html");
  const page_parser_ = ref("generic");
  const page_parsers_ = ref([]);
  const settings_menu_ = ref("cookie-sync");
  const parsers_message_ = ref("");
  let hydrating_parsers = false;
  const savepage_feedback_ = ref("");
  const savepage_copied_ = ref(false);
  const savepage_loading_ = ref(false);
  let page_transition_timer;
  let copy_feedback_timer;
  let savepage_copy_timer;
  let navigated = false;
  let hydrating_domains = false;
  const profile_buttons = new Map();
  const domain_buttons = new Map();
  const selected_cookies_ = combine({ cookies: cookies_, selected: selected_ }, ({ cookies, selected }) => cookies.filter((_, index) => selected.has(index)));
  const page_feishu_ = computed(page_parser_, (parser) => parser === "feishu");
  const page_output_ = combine({
    view: page_view_, html: page_html_, title: page_title_, url: url_, parser: page_parser_,
    images: page_images_, videos: page_videos_, files: page_files_,
  }, (page) => page.view === "json"
    ? JSON.stringify({ title: page.title, url: page.url, parser: page.parser, html: page.html, images: page.images, videos: page.videos, files: page.files }, null, 2)
    : page.html);

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

  async function refresh_page() {
    if (savepage_loading_.value) return;
    savepage_loading_.as(true);
    savepage_feedback_.as("");
    savepage_copied_.as(false);
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
      page_view_.as(result.feishu ? "json" : "html");
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
      if (!["cookie", "settings", "savepage"].includes(page) || page === page_.value) return;
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
          if (!navigated && ["cookie", "settings", "savepage"].includes(saved["popup-page"])) page_.as(saved["popup-page"]);
        }).catch((error) => message_.as(error.message)),
        load_parsers(),
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
    set_view(view) {
      if (!["html", "json"].includes(view) || view === page_view_.value) return;
      clearTimeout(savepage_copy_timer);
      savepage_copied_.as(false);
      page_view_.as(view);
    },
    async copy_page() {
      const content = page_output_.value;
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
      title: computed(page_, (page) => page === "cookie" ? "Cookie" : page === "settings" ? "设置" : "SavePage"),
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
      page_output: page_output_,
      page_view: page_view_,
      page_parser: page_parser_,
      page_feishu: page_feishu_,
      page_parser_label: computed(page_parser_, (parser) => PARSER_LABELS[parser] || parser),
      page_title: page_title_,
      page_parsers: page_parsers_,
      settings_menu: settings_menu_,
      parsers_message: parsers_message_,
      page_images: page_images_,
      page_videos: page_videos_,
      page_files: page_files_,
      page_summary: combine({ parser: page_parser_, images: page_images_, videos: page_videos_, files: page_files_ }, (page) => [
        PARSER_LABELS[page.parser] || page.parser,
        `图片 ${page.images.length}`,
        `视频 ${page.videos.length}`,
        `文件 ${page.files.length}`,
      ].filter(Boolean).join(" · ")),
      savepage_feedback: savepage_feedback_,
      savepage_copied: savepage_copied_,
      savepage_loading: savepage_loading_,
      savepage_size: computed(page_output_, (content) => content.length),
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
    remove_profile$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: methods.remove_profile }),
    menu: [
      { name: "cookie", title: "Cookie", icon: "file-lock" },
      { name: "savepage", title: "SavePage", icon: "file-code" },
      { name: "settings", title: "设置", icon: "settings" },
    ].map((item) => ({ ...item, button$: new vm.ButtonCore({ variant: "ghost", onClick: () => methods.navigate(item.name) }) })),
    refresh$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: refresh }),
    refresh_page$: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: refresh_page }),
    copy_page$: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: () => methods.copy_page() }),
    view_html$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.set_view("html") }),
    view_json$: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.set_view("json") }),
    page_html$: createInputStore({ allowClear: false, onChange() {} }),
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
  // 展示用：只把抓取结果同步进文本框，不回写，避免误改内容。
  page_output_.subscribe({ onChange(content) {
    if (ui.page_html$.value !== content) ui.page_html$.setValue(content, { silence: true });
  } });
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
    [computed(page_output_, (content) => !content), ui.copy_page$],
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
