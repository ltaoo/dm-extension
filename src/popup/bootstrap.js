function start() {
  // load 后先绘制静态外壳，再加载框架和业务模块。
  requestAnimationFrame(() => setTimeout(() => {
    import("./popup.js").catch((error) => {
      console.error(error);
      const message = document.querySelector('[data-n="popup-loading"]');
      if (message) message.textContent = "界面加载失败，请关闭后重试。";
    });
  }, 0));
}

if (document.readyState === "complete") start();
else window.addEventListener("load", start, { once: true });
