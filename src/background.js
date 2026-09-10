import { alarm_name, CookieSyncModel } from "./models/sync.model.js";

const sync$ = CookieSyncModel();
sync$.ready.catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !["get", "save", "sync", "remove"].includes(message?.action)) return;
  sync$.run(message.action, message.settings).then(
    (result) => respond({ success: true, ...result }),
    (error) => respond({ success: false, error: error.message }),
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(`${alarm_name}:`)) {
    sync$.run("alarm", { id: alarm.name.slice(alarm_name.length + 1) }).catch(console.error);
  }
});

chrome.runtime.onStartup.addListener(() => { sync$.ready.catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { sync$.ready.catch(console.error); });
