import { cookie$ } from "../models/store.js";
import "../../assets/vendor/timeless.dom.umd.min.js";
import "../../assets/vendor/timeless.web.umd.min.js";
import { Button } from "../../assets/vendor/src/dmui.js";
import CookiePageView from "../pages/cookie.js";
import SavePageView from "../pages/savepage.js";
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
          View({ attributes: { n: `menu-${item.name}-label` } }, [item.title]),
        ])])),
      ),
      View({ class: "popup-sidebar-footer popup-version", attributes: { n: "page-version", "aria-label": "扩展版本" } }, [state.version]),
    ]),
    View({ class: "popup-main", attributes: { n: "popup-main", role: "main" } }, [
      View({ class: "popup-header", attributes: { n: "page-header" } }, [
        View({ class: "popup-title", attributes: { n: "page-heading", role: "heading", "aria-level": "1" } }, [state.title]),
        View({ class: "popup-caption", attributes: { n: "page-brand" } }, ["Download & Manage"]),
      ]),
      View({ class: "popup-pages", attributes: { n: "popup-pages" } }, [
        CookiePageView({ store: cookie$ }),
        SavePageView({ store: cookie$ }),
        DetectPageView({ store: cookie$ }),
        SettingsPageView({ store: cookie$ }),
      ]),
    ]),
  ]);
}

DOM.render(PopupView(), document.querySelector("#root"));
window.addEventListener("pagehide", cookie$.methods.dispose, { once: true });
cookie$.methods.ready();
