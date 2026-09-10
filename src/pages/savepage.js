import { Button, Textarea } from "../../assets/vendor/src/dmui.js";

const { View, Icon, Show, computed, combine } = window.Timeless;

// Timeless 0.33 在 DOM 创建前应用 textarea 属性，需要在挂载后补写。
function field_element(event) {
  const target = event && (event.currentTarget || event.target || event);
  return target && typeof target.get$elm === "function" ? target.get$elm() : target;
}

function copy_label(state) {
  return combine({ copied: state.savepage_copied, view: state.page_view }, (page) => {
    if (page.copied) return "已复制";
    return page.view === "json" ? "复制 JSON" : "复制 HTML";
  });
}

function copy_hint(state) {
  return combine({ copied: state.savepage_copied, view: state.page_view }, (page) => {
    if (page.copied) return "内容已复制";
    return page.view === "json" ? "复制 JSON（html + 文件/图片/视频列表）" : "复制页面 HTML";
  });
}

function CopyIcon(copied, name) {
  return Show({
    when: copied,
    ok: () => Icon({ name: "check", size: 13, attributes: { n: `${name}-success-icon`, "aria-hidden": "true" } }),
    else: () => Icon({ name: "copy", size: 13, attributes: { n: `${name}-icon`, "aria-hidden": "true" } }),
  });
}

export default function SavePageView({ store }) {
  const { state, ui } = store;
  const copy_text = copy_label(state);
  const copy_help = copy_hint(state);
  return View({
    class: computed(state.page, (page) => `savepage-page popup-page ${page === "savepage" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "savepage-page", id: "savepage-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "savepage" && s.leaving !== "savepage" ? true : undefined),
      inert: computed(state.page, (page) => page !== "savepage" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "savepage" ? "true" : undefined),
    },
  }, [
    View({ class: "savepage-toolbar", attributes: { n: "savepage-toolbar" } }, [
      View({ class: "savepage-site", attributes: { n: "savepage-site" } }, [
        View({ class: "section-title", attributes: { n: "savepage-heading", role: "heading", "aria-level": "2" } }, ["当前页面"]),
        View({ class: "savepage-url", attributes: { n: "savepage-url", title: state.url } }, [computed(state.url, (url) => url || "未获取到当前页面")]),
      ]),
      View({ class: "savepage-views", attributes: { n: "savepage-views", role: "group", "aria-label": "输出格式" } }, [
        Button({
          store: ui.view_html$,
          class: computed(state.page_view, (view) => view === "html" ? "savepage-view is-active" : "savepage-view"),
          attributes: { n: "view-html-button", "aria-pressed": computed(state.page_view, (view) => String(view === "html")) },
        }, ["HTML"]),
        Button({
          store: ui.view_json$,
          class: computed(state.page_view, (view) => view === "json" ? "savepage-view is-active" : "savepage-view"),
          attributes: { n: "view-json-button", "aria-pressed": computed(state.page_view, (view) => String(view === "json")) },
        }, ["JSON"]),
      ]),
      Button({
        store: ui.refresh_page$,
        attributes: { n: "savepage-refresh-button" },
      }, [computed(state.savepage_loading, (loading) => loading ? "读取中…" : "重新获取")]),
    ]),
    View({ class: "savepage-actions", attributes: { n: "savepage-actions" } }, [
      View({ class: "muted", attributes: { n: "savepage-summary" } }, [state.page_summary]),
      View({ class: "muted", attributes: { n: "savepage-size" } }, [computed(state.savepage_size, (size) => `共 ${size.toLocaleString()} 个字符`)]),
      Button({
        store: ui.copy_page$,
        class: computed(state.savepage_copied, (copied) => copied ? "page-copy is-copied" : "page-copy"),
        prefix: CopyIcon(state.savepage_copied, "page-copy"),
        attributes: { n: "copy-page-button", title: copy_help, "aria-label": copy_help },
      }, [copy_text]),
    ]),
    View({ class: "savepage-feedback", attributes: { n: "savepage-feedback", role: "status", hidden: computed(state.savepage_feedback, (message) => !message ? true : undefined) } }, [state.savepage_feedback]),
    Textarea({
      store: ui.page_html$,
      rootClass: "savepage-textarea-root",
      rootAttributes: { n: "savepage-html-wrapper" },
      attributes: { n: "savepage-html", readonly: true, spellcheck: "false", wrap: "off", "aria-label": "页面 HTML" },
      onMounted(event) {
        const element = field_element(event);
        if (!element || typeof element.setAttribute !== "function") return;
        for (const [name, value] of [["n", "savepage-html"], ["readonly", ""], ["spellcheck", "false"], ["wrap", "off"], ["aria-label", "页面 HTML"]]) {
          element.setAttribute(name, value);
        }
      },
    }),
    View({ class: "page-help", attributes: { n: "savepage-help" } }, [
      computed(state.page_parser, (parser) => parser === "feishu"
        ? "飞书文档：已移除 script 标签，文件、图片、视频替换为 {{FILE:1}} / {{IMAGE:1}} / {{VIDEO:1}} 占位符，JSON 视图额外给出资源列表。"
        : "内容已移除全部 script 标签，仅用于查看与复制。需要识别文件、图片、视频时，到「设置 → SavePage 解析」为当前域名配置解析器。"),
    ]),
  ]);
}
