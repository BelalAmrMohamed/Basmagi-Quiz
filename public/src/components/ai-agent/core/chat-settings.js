import { getSelectedProvider, getSelectedModel, getModelsForProvider, setSelectedModel, getOwnKey, getEffortLevelsForModel, getSelectedEffort, setSelectedEffort } from "../ai-agent-settings.js";
import { fetchPlatformUsage, formatReset } from "../ai-agent-usage.js";

export function createChatSettings({ rich, options, appendError }) {
  function refreshModelBarOptions() {
    const provider = getSelectedProvider();
    const models = getModelsForProvider(provider);
    const { hasKey } = getOwnKey();
    const isGoogle = provider === "google";
    const current = getSelectedModel() || (models[0] && models[0].value) || "";
    // Thinking-level menu only for models that support it, with only the levels they accept.
    const levelsForModel = getEffortLevelsForModel(provider, current);
    const effortLevels = levelsForModel.length ? levelsForModel.map(({ value, label, hint }) => ({ id: value, label, hint })) : null;
    const stored = getSelectedEffort(provider);
    const selectedEffort = effortLevels && effortLevels.some((e) => e.id === stored) ? stored : "auto";
    rich.setModels({
      items: models.map(({ value, label, description, badge, platformFree }) => ({
        id: value, label, description, badge,
        locked: isGoogle && !hasKey && !platformFree,
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
