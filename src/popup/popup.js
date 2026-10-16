import "../../assets/vendor/timeless.umd.min.js";
import "../../assets/vendor/timeless.dom.umd.min.js";
import "../../assets/vendor/timeless.web.umd.min.js";
import { cookie$ } from "../models/store.js";
import { Button } from "../../assets/vendor/src/dmui.js";
import CookiePageView from "../pages/cookie.js";
import CookieSyncPageView from "../pages/cookie-sync.js";
import SavePageView from "../pages/savepage.js";
import DownloadPageView from "../pages/download.js";
import ClipPageView from "../pages/clip.js";
import DetectPageView from "../pages/detect.js";
import SettingsPageView from "../pages/settings.js";

const { View, Img, Icon, computed, classNames, ui, web, DOM } = window.Timeless;
ui.InputPrimitive.setInputProvider(web);
ui.ScrollViewPrimitive.setScrollViewProvider(web);

function PopupView() {
  const { state, ui: controls } = cookie$;
  return View({ class: "popup-shell", attributes: { n: "popup-shell" } }, [
    View({ class: "popup-sidebar", attributes: { n: "popup-sidebar", role: "complementary" } }, [
      View({ class: "popup-brand", attributes: { n: "popup-brand" } }, [
        Img({ src: "../../assets/icons/logo.svg", attributes: { n: "page-logo", alt: "D&M", width: 42, height: 42 } }),
      ]),
      View({ class: "popup-menu", attributes: { n: "popup-menu", role: "navigation", "aria-label": "页面导航" } },
        controls.menu.map((item) => Button({
          store: item.button$,
          class: classNames(["popup-menu-button", computed(state.page, (page) => page === item.name ? "is-active" : "")]),
          attributes: {
            n: `menu-${item.name}`,
            "aria-label": item.title,
            "aria-controls": `${item.name}-page`,
            "aria-current": computed(state.page, (page) => page === item.name ? "page" : undefined),
          },
        }, [View({ class: "popup-menu-item", attributes: { n: `menu-${item.name}-content` } }, [
          Icon({ name: item.icon, size: 21, attributes: { n: `menu-${item.name}-icon`, "aria-hidden": "true" } }),
          View({ attributes: { n: `menu-${item.name}-label` } }, item.name === "cookie-sync" ? [
            View({ attributes: { n: "menu-cookie-sync-cookie-label" } }, ["Cookie"]),
            View({ attributes: { n: "menu-cookie-sync-sync-label" } }, ["同步"]),
          ] : [item.title]),
        ])])),
      ),
      View({ class: "popup-sidebar-footer popup-version", attributes: { n: "page-version", "aria-label": "扩展版本" } }, [state.version]),
    ]),
    View({ class: "popup-main", attributes: { n: "popup-main", role: "main" } }, [
      View({ class: "popup-header", attributes: { n: "page-header" } }, [
        View({ class: "popup-heading", attributes: { n: "page-heading-group" } }, [
          View({ class: "popup-title", attributes: { n: "page-heading", role: "heading", "aria-level": "1" } }, [state.title]),
          View({ class: "cookie-url", attributes: { n: "page-url", title: state.url, hidden: computed(state.page, (page) => page !== "cookie" ? true : undefined) } }, [computed(state.url, (url) => url || "未获取到当前页面 Cookie")]),
        ]),
        Button({ store: controls.refresh$, attributes: { n: "refresh-button", hidden: computed(state.page, (page) => page !== "cookie" ? true : undefined) } }, [computed(state.loading, (loading) => loading ? "读取中…" : "刷新")]),
        Button({ store: controls.add_profile$, attributes: { n: "add-profile-button", hidden: computed(state.page, (page) => page !== "cookie-sync" ? true : undefined) } }, ["新增"]),
      ]),
      View({ class: "popup-pages", attributes: { n: "popup-pages" } }, [
        CookiePageView({ store: cookie$ }),
        CookieSyncPageView({ store: cookie$ }),
        DownloadPageView({ store: cookie$ }),
        SavePageView({ store: cookie$ }),
        ClipPageView({ store: cookie$ }),
        DetectPageView({ store: cookie$ }),
        SettingsPageView({ store: cookie$ }),
      ]),
    ]),
    View({ class: "popup-toast", attributes: { n: "popup-toast", role: "status", "aria-atomic": "true", hidden: computed(state.message, (message) => !message ? true : undefined) } }, [state.message]),
  ]);
}

DOM.render(PopupView(), document.querySelector("#root"));
window.addEventListener("pagehide", cookie$.methods.dispose, { once: true });
cookie$.methods.ready();
