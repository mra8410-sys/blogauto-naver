const fs = require("node:fs");
const path = require("node:path");
const { decodeHtml } = require("./shortContents");

const ECONOMY_IMAGE_PROMPT_PATH = path.join(__dirname, "..", "prompts", "economy-infographic.txt");
const ECONOMY_IMAGE_CATEGORIES = new Set(["증권", "생활경제"]);

function readBundledPrompt(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

const ECONOMY_IMAGE_PROMPT = readBundledPrompt(ECONOMY_IMAGE_PROMPT_PATH);

const DEFAULT_ACCOUNT_STORE = {
  selectedAccountId: "",
  accounts: []
};

function getAccountStorePath(runtimeRoot) {
  return path.join(runtimeRoot, "account-categories.json");
}

function makeId(prefix = "acct") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSearchChannel() {
  return "blog";
}

function normalizeArticleLength(value) {
  const length = Number(value || 1500);
  return [1200, 1500, 2000].includes(length) ? length : 1500;
}

function normalizeTopicMode(value) {
  return String(value || "manual") === "auto" ? "auto" : "manual";
}

function normalizeRandomSelectionCount(value) {
  const count = Number(value || 5);
  return Number.isInteger(count) && count >= 1 && count <= 15 ? count : 5;
}

function normalizePromptProfile(profile = {}) {
  return {
    articlePromptFilePath: String(profile?.articlePromptFilePath || ""),
    imagePromptFilePath: String(profile?.imagePromptFilePath || ""),
    articlePromptText: String(profile?.articlePromptText || ""),
    imagePromptText: String(profile?.imagePromptText || "")
  };
}

function normalizeShortContentPromptProfiles(account) {
  const rawProfiles = account?.shortContentPromptProfiles && typeof account.shortContentPromptProfiles === "object"
    ? account.shortContentPromptProfiles
    : {};
  const profiles = Object.fromEntries(
    Object.entries(rawProfiles)
      .map(([category, profile]) => [String(category || "").trim(), normalizePromptProfile(profile)])
      .filter(([category]) => category)
  );
  const selectedCategory = String(account?.shortContentCategory || "").trim();
  if (selectedCategory) {
    const current = normalizePromptProfile(profiles[selectedCategory]);
    if (!current.articlePromptFilePath && account?.shortContentArticlePromptFilePath) {
      current.articlePromptFilePath = String(account.shortContentArticlePromptFilePath);
    }
    if (!current.imagePromptFilePath && account?.shortContentImagePromptFilePath) {
      current.imagePromptFilePath = String(account.shortContentImagePromptFilePath);
    }
    profiles[selectedCategory] = current;
  }
  for (const category of ECONOMY_IMAGE_CATEGORIES) {
    const current = normalizePromptProfile(profiles[category]);
    if (!current.imagePromptText && !current.imagePromptFilePath) {
      current.imagePromptFilePath = ECONOMY_IMAGE_PROMPT_PATH;
      current.imagePromptText = ECONOMY_IMAGE_PROMPT;
    }
    profiles[category] = current;
  }
  return profiles;
}

function normalizeCategory(category) {
  if (typeof category === "string") {
    const name = category.trim();
    return {
      id: makeId("cat"),
      name,
      keyword: "",
      excludedTopics: "",
      publishPurpose: "",
      preferredTone: "",
      freshnessLevel: "high",
      searchChannel: "blog",
      trustBlogAsSource: false,
      checked: true
    };
  }
  const name = String(category?.name || category?.category || "").trim();
  return {
    id: String(category?.id || makeId("cat")),
    name,
    keyword: "",
    excludedTopics: String(category?.excludedTopics || "").trim(),
    publishPurpose: String(category?.publishPurpose || "").trim(),
    preferredTone: String(category?.preferredTone || "").trim(),
    freshnessLevel: ["auto", "low", "medium", "high"].includes(category?.freshnessLevel)
      ? category.freshnessLevel
      : "high",
    searchChannel: normalizeSearchChannel(category?.searchChannel),
    trustBlogAsSource: category?.trustBlogAsSource === true,
    checked: category?.checked !== false
  };
}

function normalizeAccount(account) {
  const naverId = String(account?.naverId || account?.idValue || "").trim();
  const blogId = String(account?.blogId || account?.naverBlogId || "").trim();
  const id = String(account?.id || "").trim() || makeId("acct");
  const categories = (Array.isArray(account?.categories) ? account.categories : [])
    .map(normalizeCategory)
    .filter((category) => category.name);

  const normalizedAccount = {
    id,
    label: String(account?.label || naverId || "Naver 계정").trim(),
    naverId,
    blogId,
    naverPassword: String(account?.naverPassword || account?.password || ""),
    sampleImagePath: String(account?.sampleImagePath || ""),
    sampleImageHash: String(account?.sampleImageHash || ""),
    sampleImageUpdatedAt: String(account?.sampleImageUpdatedAt || ""),
    imageStylePrompt: String(account?.imageStylePrompt || ""),
    imageStylePromptUpdatedAt: String(account?.imageStylePromptUpdatedAt || ""),
    imageStylePromptStatus: ["missing", "ready", "stale", "failed"].includes(account?.imageStylePromptStatus)
      ? account.imageStylePromptStatus
      : (account?.imageStylePrompt ? "ready" : "missing"),
    imageStylePromptSourceImageHash: String(account?.imageStylePromptSourceImageHash || ""),
    imageStylePromptError: String(account?.imageStylePromptError || ""),
    checked: account?.checked !== false,
    sessionStatus: ["valid", "expired", "unknown"].includes(account?.sessionStatus)
      ? account.sessionStatus
      : "unknown",
    sessionCheckedAt: String(account?.sessionCheckedAt || ""),
    categories,
    shortContentCategory: String(account?.shortContentCategory || "").trim(),
    shortContentSelectedTitles: Array.isArray(account?.shortContentSelectedTitles)
      ? account.shortContentSelectedTitles.map((title) => decodeHtml(title).trim()).filter(Boolean)
      : [],
    shortContentTitleCache: Array.isArray(account?.shortContentTitleCache)
      ? account.shortContentTitleCache
        .map((item, index) => ({
          id: String(item?.id || `short_title_${index + 1}`),
          title: decodeHtml(item?.title || item).trim(),
          source: String(item?.source || "").trim(),
          url: String(item?.url || "").trim()
        }))
        .filter((item) => item.title)
      : [],
    shortContentWritingTone: String(account?.shortContentWritingTone || "").trim(),
    shortContentArticleLength: normalizeArticleLength(account?.shortContentArticleLength),
    shortContentTopicMode: normalizeTopicMode(account?.shortContentTopicMode),
    shortContentRandomSelectionCount: normalizeRandomSelectionCount(account?.shortContentRandomSelectionCount),
    shortContentArticlePromptFilePath: String(account?.shortContentArticlePromptFilePath || ""),
    shortContentImagePromptFilePath: String(account?.shortContentImagePromptFilePath || "")
  };
  normalizedAccount.shortContentPromptProfiles = normalizeShortContentPromptProfiles({
    ...normalizedAccount,
    shortContentPromptProfiles: account?.shortContentPromptProfiles
  });
  return normalizedAccount;
}

function migrateFromSettings(settings) {
  const naverId = String(settings?.naverId || "").trim();
  const category = String(settings?.category || "").trim();
  const keyword = String(settings?.keyword || "").trim();
  if (!naverId && !category) return null;

  return normalizeAccount({
    label: naverId || "기본 계정",
    naverId,
    naverPassword: settings?.naverPassword || "",
    checked: true,
    categories: category ? [{ name: category, keyword, checked: true }] : []
  });
}

function normalizeStore(rawStore, settingsForMigration) {
  const rawAccounts = Array.isArray(rawStore?.accounts) ? rawStore.accounts : [];
  let accounts = rawAccounts.map(normalizeAccount);
  if (!accounts.length) {
    const migrated = migrateFromSettings(settingsForMigration);
    if (migrated) accounts = [migrated];
  }

  const selectedAccountId = accounts.some((account) => account.id === rawStore?.selectedAccountId)
    ? rawStore.selectedAccountId
    : (accounts[0]?.id || "");

  return {
    selectedAccountId,
    accounts
  };
}

function ensureAccountStoreFile(runtimeRoot, settingsForMigration = {}) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const storePath = getAccountStorePath(runtimeRoot);
  if (!fs.existsSync(storePath)) {
    const initial = normalizeStore(DEFAULT_ACCOUNT_STORE, settingsForMigration);
    fs.writeFileSync(storePath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
}

function readAccountStore(runtimeRoot, settingsForMigration = {}) {
  ensureAccountStoreFile(runtimeRoot, settingsForMigration);
  const storePath = getAccountStorePath(runtimeRoot);
  try {
    const raw = fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "");
    return normalizeStore(JSON.parse(raw), settingsForMigration);
  } catch {
    return normalizeStore(DEFAULT_ACCOUNT_STORE, settingsForMigration);
  }
}

function writeAccountStore(runtimeRoot, nextStore, settingsForMigration = {}) {
  ensureAccountStoreFile(runtimeRoot, settingsForMigration);
  const normalized = normalizeStore(nextStore || DEFAULT_ACCOUNT_STORE, settingsForMigration);
  fs.writeFileSync(getAccountStorePath(runtimeRoot), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function resetShortContentSelectedTitles(runtimeRoot, settingsForMigration = {}) {
  const store = readAccountStore(runtimeRoot, settingsForMigration);
  let changed = false;
  for (const account of store.accounts) {
    if (account.shortContentSelectedTitles.length) {
      account.shortContentSelectedTitles = [];
      changed = true;
    }
  }
  return changed ? writeAccountStore(runtimeRoot, store, settingsForMigration) : store;
}

function updateAccountSession(runtimeRoot, accountId, sessionStatus, settingsForMigration = {}) {
  const store = readAccountStore(runtimeRoot, settingsForMigration);
  let changed = false;
  for (const account of store.accounts) {
    if (account.id === accountId) {
      account.sessionStatus = sessionStatus;
      account.sessionCheckedAt = new Date().toISOString();
      changed = true;
      break;
    }
  }
  return changed ? writeAccountStore(runtimeRoot, store, settingsForMigration) : store;
}

function safeProfileSegment(value) {
  return String(value || "account")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function getAccountProfileDir(runtimeRoot, account) {
  const segment = safeProfileSegment(`${account?.naverId || "naver"}_${account?.id || "profile"}`);
  return path.join(runtimeRoot, "browser-profiles", segment);
}

module.exports = {
  DEFAULT_ACCOUNT_STORE,
  ensureAccountStoreFile,
  readAccountStore,
  writeAccountStore,
  resetShortContentSelectedTitles,
  updateAccountSession,
  getAccountProfileDir,
  getAccountStorePath
};
