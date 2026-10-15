import { Button, IconButton, Popover, Table } from "../../assets/vendor/src/dmui.js";

const { View, Icon, Show, For, computed, combine } = window.Timeless;

function CopyIcon(copied, name) {
  return Show({
    when: copied,
    ok: () => Icon({ name: "check", size: 13, attributes: { n: `${name}-success-icon`, "aria-hidden": "true" } }),
    else: () => Icon({ name: "copy", size: 13, attributes: { n: `${name}-icon`, "aria-hidden": "true" } }),
  });
}

export default function CookiePageView({ store }) {
  const { state, ui } = store;
  const dismiss_picker = (event) => { if (event.key === "Escape") ui.sync_profiles$.hide(); };
  return View({
    class: computed(state.page, (page) => `cookie-page popup-page ${page === "cookie" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "cookie-page", id: "cookie-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "cookie" && s.leaving !== "cookie" ? true : undefined),
      inert: computed(state.page, (page) => page !== "cookie" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "cookie" ? "true" : undefined),
    },
  }, [
    View({ class: "cookie-actions", attributes: { n: "cookie-actions" } }, [
      View({ class: "muted", attributes: { n: "cookie-count" } }, [computed(state.cookies, (cookies) => `共 ${cookies.length} 项 Cookie`)]),
      Popover({
        store: ui.sync_profiles$, class: "sync-profile-picker",
        onKeyDown: dismiss_picker,
        attributes: { n: "sync-profile-picker", role: "dialog", "aria-label": "选择同步配置" },
        content: [Show({
          when: state.sync_profiles_open,
          ok: () => For({
            each: state.profiles, key: "id",
            render: (profile) => Button({
              store: ui.profile_button(profile.id).add_domain, class: "sync-profile-option",
              attributes: { n: "sync-profile-option", "data-profile-id": profile.id },
            }, [computed(state.profile_titles, (titles) => titles[profile.id])]),
          }),
        })],
      }),
      Button({
        store: ui.add_to_sync$,
        onKeyDown: dismiss_picker,
        attributes: { n: "add-to-sync-button", "aria-haspopup": "dialog", "aria-expanded": computed(state.sync_profiles_open, String) },
        onMounted({ target }) {
          ui.sync_profiles$.popper.setReference({ $el: target, getRect: () => target.getBoundingClientRect() }, { force: true });
        },
      }, ["添加到同步配置"]),
      Button({ store: ui.copy_all$, attributes: { n: "copy-all-button" } }, ["复制全部"]),
      Button({ store: ui.copy_selected$, attributes: { n: "copy-selected-button" } }, [computed(state.selected_count, (count) => `复制已选（${count}）`)]),
    ]),
    View({ class: "cookie-feedback", attributes: { n: "cookie-feedback", role: "status", hidden: computed(state.cookie_feedback, (message) => !message ? true : undefined) } }, [state.cookie_feedback]),
    Table({
      name: "cookies", rows: state.rows, rowKey: "index", rowSelection: ui.row_selection,
      pagination: {
        page: state.cookie_page, pageCount: state.cookie_page_count, pageSize: state.cookie_page_size,
        visible: computed(state.cookie_page_count, (count) => count > 1), onChange: store.methods.select_cookie_page,
      },
      status: state.table_status, loading: state.loading,
      error: state.cookie_error, errorTitle: "无法读取 Cookie",
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
  ]);
}
