const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = {
  naverId: "",
  blogId: "",
  naverPassword: "",
  topic: "",
  keyword: "",
  category: "",
  codexCmdPath: "codex.cmd",
  primarySearchProvider: "naver",
  fallbackSearchProvider: "google",
  naverSearchUrl: "https://search.naver.com/search.naver?where=web&query={query}",
  googleSearchUrl: "https://www.google.com/search?q={query}&num=20&hl=ko",
  naverEditorDomNotes: "",
  publishAfterGenerate: false,
  publishPrivate: true,
  topicMode: "manual",
  repeatTermMinutes: 60,
  publishVisibility: "private",
  publishScheduleMode: "now",
  reserveAfterHours: 3,
  includeTitleImage: true,
  maxBodyImages: 2,
  breakSentencesInBody: true,
  agentModels: {
    main: "high",
    research: "high",
    writer: "high",
    image: "medium"
  },
  codexRateLimits: null,
  agentHarnessMode: "lean"
};

function getSettingsPath(runtimeRoot) {
  return path.join(runtimeRoot, "user-settings.json");
}

function ensureSettingsFile(runtimeRoot) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const settingsPath = getSettingsPath(runtimeRoot);
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf8");
  }
}

function readSettings(runtimeRoot) {
  ensureSettingsFile(runtimeRoot);
  try {
    const raw = fs.readFileSync(getSettingsPath(runtimeRoot), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      agentModels: {
        ...DEFAULT_SETTINGS.agentModels,
        ...(parsed.agentModels || {})
      }
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(runtimeRoot, nextSettings) {
  ensureSettingsFile(runtimeRoot);
  const current = readSettings(runtimeRoot);
  const merged = {
    ...current,
    ...Object.fromEntries(Object.entries(nextSettings || {}).filter(([, value]) => value !== undefined))
  };
  fs.writeFileSync(getSettingsPath(runtimeRoot), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureSettingsFile,
  readSettings,
  writeSettings,
  getSettingsPath
};
