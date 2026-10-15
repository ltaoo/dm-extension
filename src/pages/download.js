import { Button, Card, Input, Label } from "../../assets/vendor/src/dmui.js";

const { View, Icon, For, computed, combine } = window.Timeless;

export default function DownloadPageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `download-page popup-page dm-text-base ${page === "save-page" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "save-page", id: "save-page-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "save-page" && s.leaving !== "save-page" ? true : undefined),
      inert: computed(state.page, (page) => page !== "save-page" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "save-page" ? "true" : undefined),
      "aria-busy": computed(state.page_saving, (saving) => saving ? "true" : "false"),
    },
  }, [
    View({ class: "download-scroll", attributes: { n: "download-scroll" } }, [
      Card({ class: "download-source", attributes: { n: "download-source" } }, [
        View({ class: "download-document-icon", attributes: { n: "download-document-icon", "aria-hidden": "true" } }, [
          Icon({ name: "file-text", size: 28, attributes: { n: "download-document-glyph" } }),
        ]),
        View({ class: "download-source-text", attributes: { n: "download-source-text" } }, [
          View({ class: "dm-text-muted", attributes: { n: "download-source-label" } }, ["当前页面"]),
          View({ class: "download-source-title dm-font-semibold", attributes: { n: "download-source-title", role: "heading", "aria-level": "2", title: state.download_title } }, [state.download_title]),
          View({ class: "download-source-url dm-text-muted", attributes: { n: "download-source-url", title: state.url } }, [computed(state.url, (url) => url || "未获取到页面地址")]),
        ]),
      ]),
      View({ class: "download-filename-field", attributes: { n: "download-filename-field" } }, [
        Label({ class: "dm-text-base", attributes: { n: "download-filename-label", id: "download-filename-label", for: "download-filename" } }, ["文件名"]),
        Input({ store: ui.download_name$, class: "dm-text-base", rootAttributes: { n: "download-filename-wrapper" }, attributes: { n: "download-filename-input", id: "download-filename", "aria-labelledby": "download-filename-label", "aria-describedby": "download-filename-help", autocomplete: "off", spellcheck: "false" } }),
        View({ class: "dm-text-muted", attributes: { n: "download-filename-help", id: "download-filename-help" } }, ["留空时使用页面标题，自动添加 .html 扩展名。"]),
      ]),
      View({ class: "download-properties", attributes: { n: "download-properties" } }, [
        View({ class: "download-property", attributes: { n: "download-format" } }, [
          Icon({ name: "file-code", size: 18, attributes: { n: "download-format-icon", "aria-hidden": "true" } }),
          View({ attributes: { n: "download-format-value" } }, ["HTML 页面快照"]),
        ]),
        View({ class: "download-property", attributes: { n: "download-destination" } }, [
          Icon({ name: "folder-open", size: 18, attributes: { n: "download-destination-icon", "aria-hidden": "true" } }),
          View({ attributes: { n: "download-destination-value" } }, ["浏览器下载位置"]),
        ]),
      ]),
      View({ class: "download-scope dm-text-muted", attributes: { n: "download-scope" } }, ["冻结当前样式，打包可读取的图片与字体。若需保留当前可见区域的完整外观，可保存 PNG 截图。"]),
      View({ class: "download-warnings", attributes: { n: "download-warnings", role: "status", hidden: computed(state.download_warnings, (warnings) => warnings.length ? undefined : true) } }, [
        View({ class: "dm-font-semibold", attributes: { n: "download-warnings-heading" } }, ["部分内容未能完整保存"]),
        For({ each: state.download_warnings, render: (text) => View({ attributes: { n: "download-warning" } }, [text]) }),
      ]),
    ]),
    View({ class: combine({ status: state.download_status, available: state.download_available }, (s) => `download-footer is-${s.available ? s.status : "unavailable"}`), attributes: { n: "download-footer" } }, [
      View({ class: "download-feedback", attributes: { n: "download-page-feedback", role: "status", "aria-live": "polite", "aria-atomic": "true" } }, [
        View({ class: "download-status-title dm-font-semibold", attributes: { n: "download-status-title" } }, [
          View({ class: "download-spinner", attributes: { n: "download-spinner", "aria-hidden": "true", hidden: computed(state.page_saving, (saving) => saving ? undefined : true) } }, [
            Icon({ name: "loader-circle", size: 16, attributes: { n: "download-spinner-glyph" } }),
          ]),
          state.download_status_label,
        ]),
        View({ class: "download-status-message dm-text-muted", attributes: { n: "download-status-message", title: state.download_message } }, [state.download_message]),
      ]),
      Button({ store: ui.download_screenshot$, class: "dm-text-base", attributes: { n: "download-screenshot-button", title: "保存当前可见区域为 PNG 图片" } }, [computed(state.screenshot_saving, (saving) => saving ? "正在截图…" : "保存截图")]),
      Button({ store: ui.download_page$, class: "download-save-button dm-text-base", attributes: { n: "download-page-button" } }, [
        Icon({ name: "download", size: 18, attributes: { n: "download-save-icon", "aria-hidden": "true" } }),
        computed(state.download_status, (status) => ({ reading: "正在保存…", sending: "正在保存…", success: "再次保存", error: "重试保存" }[status] || "保存当前页面")),
      ]),
    ]),
  ]);
}
