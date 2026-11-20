import { getSelectedProvider, getSelectedModel, getModelsForProvider, setSelectedModel, getOwnKey, EFFORT_LEVELS, getSelectedEffort, setSelectedEffort } from "../ai-agent-settings.js";
import { fetchPlatformUsage, formatReset } from "../ai-agent-usage.js";

export function createChatSettings({ rich, options, appendError }) {
  function refreshModelBarOptions() {
    const provider = getSelectedProvider();
    const models = getModelsForProvider(provider);
    const { hasKey } = getOwnKey();
    const isGoogle = provider === "google";
    const current = getSelectedModel() || (models[0] && models[0].value) || "";
    const effortLevels = isGoogle ? EFFORT_LEVELS.map(({ value, label, hint }) => ({ id: value, label, hint })) : null;
    const selectedEffort = getSelectedEffort(provider);
    rich.setModels({
      items: models.map(({ value, label, description }) => ({
        id: value, label, description,
        locked: isGoogle && !hasKey && value !== "gemini-flash-lite-latest",
      })),
      value: current,
      disabled: false,
      effortLevels,
      selectedEffort,
      usage: { load: () => fetchPlatformUsage(), source: hasKey ? "own" : "platform", provider, formatReset },
      onChange: (id) => { setSelectedModel(getSelectedProvider(), id); refreshModelBarOptions(); },
      onLockedClick: (lockedItem) => {
        appendError(`نموذج "${lockedItem.label}" متاح فقط عند استخدام مفتاح API الخاص بك. انتقل إلى الإعدادات لإضافة مفتاحك.`);
        if (typeof options.onOpenSettings === "function") options.onOpenSettings();
        else [...document.querySelectorAll(".ai-agent-sidebar-btn")].find((button) => button.textContent.includes("الإعدادات"))?.click();
      },
      onEffortChange: (effId) => { setSelectedEffort(getSelectedProvider(), effId); refreshModelBarOptions(); },
    });
  }
  refreshModelBarOptions();
  return { refreshModelBarOptions };
}
