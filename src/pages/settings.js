import { ArrayField, Button, Card, Input, Label, Select } from "../../assets/vendor/src/dmui.js";

const { View, Img, Link, computed, combine, classNames } = window.Timeless;

export default function SettingsPageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `settings-page popup-page ${page === "settings" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "settings-page", id: "settings-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "settings" && s.leaving !== "settings" ? true : undefined),
      inert: computed(state.page, (page) => page !== "settings" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "settings" ? "true" : undefined),
    },
  }, [
    View({ class: "settings-sidebar", attributes: { n: "settings-sidebar", role: "navigation", "aria-label": "设置菜单" } },
      ui.settings_menu.map((item) => Button({
        store: item.button$,
        class: classNames(["settings-menu-button", computed(state.settings_menu, (menu) => menu === item.name ? "is-active" : "")]),
        attributes: {
          n: `settings-menu-${item.name}`,
          "aria-current": computed(state.settings_menu, (menu) => menu === item.name ? "page" : undefined),
          "aria-controls": `${item.name}-settings`,
        },
      }, [item.title])),
    ),
    View({ class: "settings-content", attributes: { n: "settings-content" } }, [
    View({
      class: "settings-panel",
      attributes: {
        n: "savepage-settings", id: "savepage-settings", role: "region", "aria-label": "保存页面设置",
        hidden: computed(state.settings_menu, (menu) => menu === "savepage" ? undefined : true),
        inert: computed(state.settings_menu, (menu) => menu === "savepage" ? undefined : true),
      },
    }, [
      View({ class: "settings-scroll", attributes: { n: "savepage-scroll" } }, [
        Card({ class: "settings-card", attributes: { n: "parser-panel" } }, [
          View({ class: "section-title", attributes: { n: "parser-heading", role: "heading", "aria-level": "2" } }, ["域名解析规则"]),
          View({ class: "parser-list-heading", attributes: { n: "parser-list-heading" } }, [
            Label({ attributes: { n: "parsers-label", id: "parsers-label" } }, ["域名 → 解析器"]),
            Button({ store: ui.add_parser$, attributes: { n: "add-parser-button" } }, ["添加规则"]),
          ]),
          ArrayField({
            store: ui.parsers$, class: "parser-list", attributes: { n: "parsers-array-field", "aria-labelledby": "parsers-label" },
            render({ idx, field }) {
              return View({ class: "parser-row", attributes: { n: "parser-row" } }, [
                Input({ store: field.fields.domain.input, rootAttributes: { n: "parser-domain-wrapper" }, attributes: { n: "parser-domain-input", "aria-label": `第 ${idx + 1} 条规则的域名`, spellcheck: "false" } }),
                Select({ store: field.fields.parser.input, attributes: { n: "parser-type-input", "aria-label": `第 ${idx + 1} 条规则的解析器` } }),
                Button({ store: field.remove$, attributes: { n: "remove-parser-button", "aria-label": `删除第 ${idx + 1} 条规则` } }, ["删除"]),
              ]);
            },
          }),
          View({ class: "page-help", attributes: { n: "parser-list-help" } }, ["域名填写 example.com 即匹配该域名及其子域，也可写 *.example.com 或完整 URL。选「飞书文档」时 SavePage 会提取文件、图片、视频并替换为占位符；选「通用」只移除 script 标签。*.feishu.cn、*.larksuite.com 内置为飞书文档，无需配置。"]),
        ]),
      ]),
      View({ class: "settings-footer", attributes: { n: "parsers-footer" } }, [
        View({ class: "settings-feedback", attributes: { n: "parsers-feedback" } }, [
          View({ class: "settings-message", attributes: { n: "parsers-message", role: "status", title: state.parsers_message, hidden: computed(state.parsers_message, (message) => !message ? true : undefined) } }, [state.parsers_message]),
        ]),
      ]),
    ]),
    View({
      class: "settings-panel",
      attributes: {
        n: "about-settings", id: "about-settings", role: "region", "aria-label": "关于",
        hidden: computed(state.settings_menu, (menu) => menu === "about" ? undefined : true),
        inert: computed(state.settings_menu, (menu) => menu === "about" ? undefined : true),
      },
    }, [
      View({ class: "settings-scroll", attributes: { n: "about-scroll" } }, [
        Card({ class: "settings-card about-card dm-text-base", attributes: { n: "about-card" } }, [
          View({ class: "about-brand", attributes: { n: "about-brand" } }, [
            Img({ src: "../../assets/icons/logo.svg", attributes: { n: "about-logo", alt: "Download & Manage logo", width: 64, height: 64 } }),
            View({ attributes: { n: "about-identity" } }, [
              View({ class: "dm-font-semibold", attributes: { n: "about-name", role: "heading", "aria-level": "2" } }, [state.app_name]),
              View({ class: "dm-text-muted", attributes: { n: "about-version" } }, ["版本 ", state.version]),
            ]),
          ]),
          View({ attributes: { n: "about-description" } }, [
            "Download & Manage 是 ",
            Link({ href: "https://github.com/ltaoo/wx_channels_download", target: "_blank", rel: "noopener noreferrer", class: "about-project-link", attributes: { n: "about-project-link" } }, ["wx_channels_download"]),
            " 项目下载功能的配套浏览器插件，提供 Cookie 管理、同步和页面保存功能。",
          ]),
          View({ attributes: { n: "about-features", role: "list", "aria-label": "应用功能" } }, [
            View({ attributes: { n: "about-cookie-feature", role: "listitem" } }, ["Cookie 管理：查看当前页面的 Cookie，复制全部或选中项，并将当前域名添加到同步配置。"]),
            View({ attributes: { n: "about-sync-feature", role: "listitem" } }, ["Cookie 同步：管理多组接口配置，按域名规则定时同步，支持加密传输。"]),
            View({ attributes: { n: "about-save-feature", role: "listitem" } }, ["保存页面：获取当前页面内容并下载为 HTML 文件。"]),
          ]),
        ]),
      ]),
    ]),
    ]),
  ]);
}
