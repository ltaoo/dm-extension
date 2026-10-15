import { capture_snapshot } from "./snapshot.model.js";

export async function render_screenshot(snapshot) {
  const { svg, width, height, pixel_ratio, background_color } = snapshot;
  if (!svg?.startsWith("<svg") || ![width, height, pixel_ratio].every(value => Number.isFinite(value) && value > 0)) throw new Error("未获取到有效的 SVG 截图");
  const image_width = Math.max(1, Math.round(width * pixel_ratio)), image_height = Math.max(1, Math.round(height * pixel_ratio));
  if (image_width > 32767 || image_height > 32767 || image_width * image_height > 64 * 1024 * 1024) throw new Error("长截图超过图片尺寸限制，请缩小网页后重试");
  const image = new Image();
  const canvas = new OffscreenCanvas(image_width, image_height);
  try {
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    try { await image.decode(); }
    catch { throw new Error("SVG 截图渲染失败，请等待页面加载完成后重试"); }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建长截图画布");
    context.fillStyle = background_color || "white";
    context.fillRect(0, 0, image_width, image_height);
    context.drawImage(image, 0, 0, image_width, image_height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    image.src = "";
    canvas.width = canvas.height = 0;
  }
}

export async function capture_page_screenshot(client, tab, on_progress = () => {}) {
  on_progress("正在识别主内容并打包图片与字体，请保持面板打开。");
  const [entry] = await client.scripting.executeScript({ target: { tabId: tab.id }, func: capture_snapshot, args: [true] });
  if (entry?.error || !entry?.result) throw new Error(entry?.error || "未获取到页面快照");
  on_progress("正在通过 SVG 渲染长截图，请保持面板打开。");
  const blob = await render_screenshot(entry.result);
  return { blob, title: entry.result.title, warnings: entry.result.warnings || [] };
}
