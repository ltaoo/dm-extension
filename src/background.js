import { alarm_name, CookieSyncModel } from "./models/sync.model.js";
import { build_clip_record, extract_region, save_clips, verify_no_external_refs } from "./clip/clip.model.js";

const sync$ = CookieSyncModel();
sync$.ready.catch(console.error);

const SYNC_ACTIONS = new Set(["get", "save", "sync", "remove"]);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.action === "clip-region") {
    clip_region(message, sender).then(
      (result) => respond({ success: true, ...result }),
      (error) => respond({ success: false, error: error.message }),
    );
    return true;
  }
  if (!SYNC_ACTIONS.has(message?.action)) return;
  sync$.run(message.action, message.settings).then(
    (result) => respond({ success: true, ...result }),
    (error) => respond({ success: false, error: error.message }),
  );
  return true;
});

// 区域剪藏：页面上的选择器挑好节点后上报 → 注入提取 → 自检 → 落库 → 开结果页。
// 结果页只能由这里开：用户在页面上点「保存」时弹窗早关了，页面自己没有开标签页的权限。
async function clip_region(message, sender) {
  const tab_id = sender?.tab?.id;
  if (!tab_id) throw new Error("找不到来源标签页");
  const result = await extract_region(tab_id, message.target, message.options);
  if (!result.ok) throw new Error(result.error || "提取失败");
  // 落库前把「零外部引用」这条硬线再验一遍：宁可这一次不保存，也不留一个会引外部资源的片段。
  const checked = verify_no_external_refs(result.html);
  if (!checked.ok) throw new Error(`产出物未通过自检：${checked.hits.map((hit) => hit.label).join("、")}`);
  const record = build_clip_record(message, result);
  await save_clips(chrome, record);
  await chrome.tabs.create({ url: `${chrome.runtime.getURL("src/clip/clip.html")}?id=${encodeURIComponent(record.id)}` });
  return { elements: record.element_count, image_missing: record.image_missing };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(`${alarm_name}:`)) {
    sync$.run("alarm", { id: alarm.name.slice(alarm_name.length + 1) }).catch(console.error);
  }
});

chrome.runtime.onStartup.addListener(() => { sync$.ready.catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { sync$.ready.catch(console.error); });
