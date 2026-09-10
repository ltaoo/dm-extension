import { Button, IconButton, Table } from "../../assets/vendor/src/dmui.js";

const { View, Icon, Show, computed, combine } = window.Timeless;

function CopyIcon(copied, name) {
  return Show({
    when: copied,
    ok: () => Icon({ name: "check", size: 13, attributes: { n: `${name}-success-icon`, "aria-hidden": "true" } }),
    else: () => Icon({ name: "copy", size: 13, attributes: { n: `${name}-icon`, "aria-hidden": "true" } }),
  });
}

export default function CookiePageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `cookie-page popup-page ${page === "cookie" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "cookie-page", id: "cookie-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "cookie" && s.leaving !== "cookie" ? true : undefined),
      inert: computed(state.page, (page) => page !== "cookie" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "cookie" ? "true" : undefined),
    },
  }, [
    View({ class: "cookie-toolbar", attributes: { n: "cookies-toolbar" } }, [
      View({ class: "cookie-site", attributes: { n: "cookie-site" } }, [
        View({ class: "section-title", attributes: { n: "cookies-heading", role: "heading", "aria-level": "2" } }, ["当前页面 Cookie"]),
        View({ class: "cookie-url", attributes: { n: "page-url", title: state.url } }, [computed(state.url, (url) => url || "未获取到当前页面")]),
      ]),
      Button({
        store: ui.copy_domain$,
        class: computed(state.page_domain_copied, (copied) => copied ? "domain-copy is-copied" : "domain-copy"),
        prefix: CopyIcon(state.page_domain_copied, "page-domain-copy"),
        attributes: { n: "copy-domain-button", title: computed(state.page_domain_copied, (copied) => copied ? "已复制" : "复制域名"), "aria-label": computed(state.page_domain_copied, (copied) => copied ? "域名已复制" : "复制域名") },
      }, ["复制域名"]),
      Button({ store: ui.refresh$, attributes: { n: "refresh-button" } }, [computed(state.loading, (loading) => loading ? "读取中…" : "刷新")]),
    ]),
    View({ class: "cookie-actions", attributes: { n: "cookie-actions" } }, [
      View({ class: "muted", attributes: { n: "cookie-count" } }, [computed(state.cookies, (cookies) => `共 ${cookies.length} 项 Cookie`)]),
      Button({ store: ui.copy_all$, attributes: { n: "copy-all-button" } }, ["复制全部"]),
      Button({ store: ui.copy_selected$, attributes: { n: "copy-selected-button" } }, [computed(state.selected_count, (count) => `复制已选（${count}）`)]),
    ]),
    View({ class: "cookie-feedback", attributes: { n: "cookie-feedback", role: "status", hidden: computed(state.cookie_feedback, (message) => !message ? true : undefined) } }, [state.cookie_feedback]),
    Table({
      name: "cookies", rows: state.rows, rowKey: "index", rowSelection: ui.row_selection,
      status: state.table_status, loading: state.loading,
      emptyTitle: "当前页面没有可用的 Cookie", emptyDescription: "打开普通网页后点击刷新。",
      containerClass: "cookie-table",
      columns: [
        { name: "name", title: "名称", width: "minmax(100px, 1fr)" },
        { name: "value", title: "值", width: "minmax(120px, 1.4fr)" },
        { name: "domain", title: "域", width: "minmax(90px, 1fr)", render: (cookie) => {
          const copied_ = computed(state.copied_domain, (domain) => domain === cookie.domain);
          return View({ class: "cookie-domain", attributes: { n: "cookie-domain" } }, [
          View({ class: "cookie-domain-value", attributes: { n: "cookie-domain-value" } }, [cookie.domain]),
          IconButton({
            store: ui.domain_copy_button(cookie.domain),
            class: computed(copied_, (copied) => copied ? "cookie-domain-copy domain-copy is-copied" : "cookie-domain-copy domain-copy"),
            attributes: { n: "cookie-domain-copy", title: computed(copied_, (copied) => copied ? "已复制" : `复制域名 ${cookie.domain}`), "aria-label": computed(copied_, (copied) => copied ? `域名 ${cookie.domain} 已复制` : `复制域名 ${cookie.domain}`) },
          }, [CopyIcon(copied_, "cookie-domain-copy")]),
        ]);
        } },
        { name: "path", title: "路径", width: 48 },
        { name: "attributes", title: "属性", width: 72, render: (cookie) => [cookie.secure && "Secure", cookie.httpOnly && "HttpOnly", cookie.session && "Session"].filter(Boolean).join(" · ") || "—" },
      ],
    }),
    View({ class: "page-help", attributes: { n: "cookie-help" } }, ["勾选仅影响复制。同步范围请在设置中配置。"]),
  ]);
}
