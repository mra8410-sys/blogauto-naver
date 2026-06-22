const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { readHistory, appendHistory, ensureRuntimeFiles } = require("./lib/history");
const { createEmbedding, cosineSimilarity } = require("./lib/embedding");
const { collectSearchResults, summarizeSourceQuality } = require("./lib/search");
const { runCodexGeneration, fetchCodexUsageSnapshot } = require("./lib/codexRunner");
const { normalizeAgentResult, getPreviewImages } = require("./lib/imageAssets");
const { publishToNaver, checkNaverSession } = require("./lib/naverPublisher");
const { ensureSettingsFile, normalizeImageAspectRatio, readSettings, writeSettings } = require("./lib/settings");
const { listShortContentCategories, listShortContentTitles } = require("./lib/shortContents");
const {
  ensureAccountStoreFile,
  readAccountStore,
  writeAccountStore,
  updateAccountSession,
  getAccountProfileDir
} = require("./lib/accountStore");

let mainWindow;
let activeJob = null;
const activeNaverSessions = new Map();

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("no-sandbox");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#f4f7f5",
    title: "Naver Blog Automator",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason || "unknown"} (${details.exitCode || 0})`);
  });
}

function getRuntimeRoot() {
  const overrideRoot = process.env.BLOGAUTO_RUNTIME_ROOT;
  if (overrideRoot) {
    return path.resolve(overrideRoot);
  }

  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && fs.existsSync(portableDir)) {
      return path.join(portableDir, "runtime");
    }

    const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
    if (portableFile && fs.existsSync(portableFile)) {
      return path.join(path.dirname(portableFile), "runtime");
    }

    return path.join(path.dirname(process.execPath), "runtime");
  }
  return path.join(app.getAppPath(), "runtime");
}

function resolveCodexCmdPath(candidate = "") {
  const requested = String(candidate || "").trim();
  const normalized = requested.toLowerCase();
  if (!requested || normalized === "codex" || normalized === "codex.cmd") {
    const localCodex = path.join(app.getAppPath(), "node_modules", ".bin", process.platform === "win32" ? "codex.CMD" : "codex");
    if (fs.existsSync(localCodex)) return localCodex;
  }
  return requested || "codex";
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function safeLog(jobId, message, level = "info", agent = "main") {
  let text = String(message || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/password\s*[:=]\s*\S+/gi, "password=[redacted]");
  if (/^mcp:/i.test(text) || /codex_core_plugins::manifest/i.test(text)) {
    return;
  }
  if (text.includes("Call log:")) {
    text = text.split("Call log:")[0].trim();
  }
  emit("job:log", {
    jobId,
    level,
    agent,
    message: text,
    at: new Date().toISOString()
  });
}

function updateStatus(jobId, status, detail = "") {
  emit("job:status", { jobId, status, detail, at: new Date().toISOString() });
}

function persistCodexRateLimits(runtimeRoot, rateLimits) {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  return writeSettings(runtimeRoot, { codexRateLimits: rateLimits });
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function accountAssetDir(runtimeRoot, accountId) {
  return path.join(runtimeRoot, "account-assets", String(accountId || "unknown"));
}

function accountSampleImagePath(runtimeRoot, accountId, sourcePath) {
  const ext = path.extname(String(sourcePath || "")).toLowerCase();
  const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
  return path.join(accountAssetDir(runtimeRoot, accountId), `sample${safeExt}`);
}

function withAccountImageUrls(runtimeRoot, store) {
  return {
    ...store,
    accounts: (store.accounts || []).map((account) => {
      const sampleImagePath = String(account.sampleImagePath || "");
      const sampleImageUrl = sampleImagePath && fs.existsSync(sampleImagePath)
        ? pathToFileURL(sampleImagePath).toString()
        : "";
      return { ...account, sampleImageUrl };
    })
  };
}

function emitAccountStore(runtimeRoot) {
  emit("accounts:update", withAccountImageUrls(runtimeRoot, readAccountStore(runtimeRoot, readSettings(runtimeRoot))));
}

function sessionKeyFor(account, browserProfileDir) {
  return account?.id || browserProfileDir;
}

function detectChromeInstall() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  const chromePath = candidates.find((candidate) => fs.existsSync(candidate));
  return {
    available: Boolean(chromePath),
    path: chromePath || ""
  };
}

async function closeNaverSession(key) {
  const session = activeNaverSessions.get(key);
  if (!session) return;
  activeNaverSessions.delete(key);
  await session.context?.close().catch(() => {});
}

function reusableNaverSession(key) {
  const session = activeNaverSessions.get(key);
  if (!session?.context || session.page?.isClosed?.()) {
    activeNaverSessions.delete(key);
    return null;
  }
  return session;
}

function sanitizeNaverTag(value) {
  return String(value || "")
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

function buildTags(topic, keyword, articleTags) {
  const raw = [
    topic,
    keyword,
    ...(Array.isArray(articleTags) ? articleTags : [])
  ]
    .flatMap((item) => String(item || "").split(/[,\n#]+/))
    .map(sanitizeNaverTag)
    .filter(Boolean);

  return [...new Set(raw)].slice(0, 29);
}

function normalizeKeywordLane(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(" ");
  if (parts.length % 2 === 0) {
    const half = parts.length / 2;
    if (parts.slice(0, half).join(" ") === parts.slice(half).join(" ")) {
      return parts.slice(0, half).join(" ");
    }
  }
  return text;
}

function splitKeywordLanes(keyword) {
  const seen = new Set();
  return String(keyword || "")
    .split(/[,\n]+/)
    .map(normalizeKeywordLane)
    .filter(Boolean)
    .filter((lane) => {
      const key = lane.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((phrase, index) => ({ index: index + 1, phrase }));
}

function keywordLaneFromEntry(entry) {
  return String(entry?.topic_lane || entry?.topicLane || "").trim();
}

function buildKeywordLanePlan(keyword, history = [], { blogId = "", category = "" } = {}) {
  const lanes = splitKeywordLanes(keyword);
  const scopedHistory = (Array.isArray(history) ? history : [])
    .filter((entry) => !blogId || String(entry?.blog_id || "") === blogId)
    .filter((entry) => !category || String(entry?.category || "") === category || String(entry?.keyword || "") === String(keyword || ""));
  const usage = new Map(lanes.map((lane) => [lane.phrase.toLowerCase(), { count: 0, lastCreateAt: "" }]));
  for (const entry of scopedHistory) {
    const lane = keywordLaneFromEntry(entry);
    if (!lane) continue;
    const key = lane.toLowerCase();
    if (!usage.has(key)) continue;
    const stat = usage.get(key);
    stat.count += 1;
    stat.lastCreateAt = [stat.lastCreateAt, String(entry.create_at || "")].sort().pop() || stat.lastCreateAt;
  }
  const recommended = [...lanes].sort((a, b) => {
    const aStat = usage.get(a.phrase.toLowerCase()) || { count: 0, lastCreateAt: "" };
    const bStat = usage.get(b.phrase.toLowerCase()) || { count: 0, lastCreateAt: "" };
    if (aStat.count !== bStat.count) return aStat.count - bStat.count;
    if (aStat.lastCreateAt !== bStat.lastCreateAt) return String(aStat.lastCreateAt).localeCompare(String(bStat.lastCreateAt));
    return a.index - b.index;
  });
  return { lanes, recommended, usage: Object.fromEntries([...usage.entries()]) };
}

function normalizeResearchLaneResult(researchResult, lanePlan) {
  const lanes = Array.isArray(lanePlan?.lanes) ? lanePlan.lanes : [];
  const byIndex = new Map(lanes.map((lane) => [lane.index, lane]));
  const byPhrase = new Map(lanes.map((lane) => [lane.phrase.toLowerCase(), lane]));
  const selected = [];
  for (const index of Array.isArray(researchResult?.selectedKeywordIndexes) ? researchResult.selectedKeywordIndexes : []) {
    const lane = byIndex.get(Number(index));
    if (lane && !selected.some((item) => item.index === lane.index)) selected.push(lane);
  }
  for (const phrase of [
    researchResult?.topicLane,
    ...(Array.isArray(researchResult?.selectedKeywordPhrases) ? researchResult.selectedKeywordPhrases : [])
  ]) {
    const lane = byPhrase.get(String(phrase || "").trim().toLowerCase());
    if (lane && !selected.some((item) => item.index === lane.index)) selected.push(lane);
  }
  const fallback = Array.isArray(lanePlan?.recommended) ? lanePlan.recommended[0] : null;
  if (!selected.length && fallback) selected.push(fallback);
  const topicLane = String(researchResult?.topicLane || selected[0]?.phrase || "").trim();
  const lanePhrases = lanes.map((lane) => lane.phrase.toLowerCase());
  const searchQueries = (Array.isArray(researchResult?.searchQueries) ? researchResult.searchQueries : [])
    .map((query) => String(query || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((query) => {
      if (query.length > 120) return false;
      const lower = query.toLowerCase();
      const matchedLaneCount = lanePhrases.filter((phrase) => phrase && lower.includes(phrase)).length;
      return matchedLaneCount <= 2;
    })
    .slice(0, 4);
  return {
    topicLane,
    selectedKeywordIndexes: selected.map((lane) => lane.index),
    selectedKeywordPhrases: selected.map((lane) => lane.phrase),
    searchQueries
  };
}

function keywordLaneHistoryFields(laneResult = {}) {
  return {
    topic_lane: String(laneResult.topicLane || ""),
    selected_keyword_indexes: Array.isArray(laneResult.selectedKeywordIndexes) ? laneResult.selectedKeywordIndexes : [],
    selected_keyword_phrases: Array.isArray(laneResult.selectedKeywordPhrases) ? laneResult.selectedKeywordPhrases : [],
    search_queries: Array.isArray(laneResult.searchQueries) ? laneResult.searchQueries : []
  };
}

function mergeSearchResults(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const key = String(item?.url || item?.fetchedUrl || "").replace(/[#?].*$/, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.slice(0, 20).map((item, index) => ({
    ...item,
    sourceId: item.sourceId || `${item.provider || "source"}-${index + 1}`
  }));
}

function selectSearchTopicForResearch(researchResult, context = {}) {
  const topicMode = String(context.topicMode || "manual").toLowerCase();
  const directTopic = String(context.topic || "").trim();
  if (topicMode === "manual" && directTopic) return directTopic;
  return String(
    researchResult?.finalTitle
    || researchResult?.selectedTitle
    || directTopic
    || `${context.category || ""} ${context.keyword || ""}`.trim()
  ).replace(/\s+/g, " ").trim();
}

function detectCodexSourceFailure(result) {
  const status = String(result?.status || "").toLowerCase();
  const explicitReason = String(result?.failureReason || result?.reason || "").trim();
  if (["failed", "failure", "source_failed", "insufficient_sources"].includes(status)) {
    return explicitReason || "본문 발췌 실패: Codex가 발행 가능한 근거 자료를 확보하지 못했습니다.";
  }
  if (explicitReason) return explicitReason;
  return "";
}

function normalizeTopicTitle(title, fallback) {
  const cleaned = String(title || "")
    .replace(/\s*[-|:]\s*(네이버|NAVER|Google|구글|뉴스|블로그|카페).*$/i, "")
    .replace(/\[[^\]]*(광고|AD|Sponsored)[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function todayLabel() {
  const now = new Date();
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
}

async function resolveTopicInput(form, category, log) {
  const topicMode = String(form.topicMode || "manual");
  const manualTopic = String(form.topic || "").trim();
  const manualKeyword = String(form.keyword || "").trim();

  if (topicMode !== "auto") {
    return {
      topic: manualTopic,
      keyword: manualKeyword
    };
  }

  const seedKeyword = manualKeyword || category;
  log("자동 주제 모드: 카테고리와 키워드를 Research/Title Agent에 전달합니다.");
  return {
    topic: "",
    keyword: seedKeyword
  };
}

function resolveAccount(form, accountStore) {
  const accountId = String(form.accountId || "").trim();
  const account = accountStore.accounts.find((item) => item.id === accountId);
  if (account) return account;
  return {
    id: accountId,
    label: String(form.naverId || "").trim() || "Naver 계정",
    naverId: String(form.naverId || "").trim(),
    blogId: String(form.blogId || "").trim(),
    naverPassword: String(form.naverPassword || ""),
    sessionStatus: "unknown",
    categories: []
  };
}

function createSessionExpiredError(reason = "네이버 세션이 만료되어 사용자 로그인이 필요합니다.") {
  const error = new Error(reason);
  error.code = "SESSION_EXPIRED";
  return error;
}

async function verifyPublishSessionBeforeGeneration({ runtimeRoot, account, blogId, form, settings, jobId }) {
  const browserProfileDir = getAccountProfileDir(runtimeRoot, account);
  const sessionKey = sessionKeyFor(account, browserProfileDir);
  updateStatus(jobId, "publishing", "Naver 글쓰기 편집기 확인");
  safeLog(jobId, "본문 생성 전 Naver 계정 로그인 세션과 블로그 글쓰기 편집기 화면을 먼저 확인합니다.");
  safeLog(jobId, `계정 profile: ${browserProfileDir}`);
  const cached = reusableNaverSession(sessionKey);
  if (cached) {
    safeLog(jobId, "이미 확인된 글쓰기 편집기 브라우저 세션을 재사용합니다.");
    return cached;
  }

  let result;
  try {
    result = await checkNaverSession({
      naverId: account.naverId || form.naverId || blogId,
      blogId,
      naverPassword: account.naverPassword || form.naverPassword || "",
      browserProfileDir,
      interactiveLogin: false,
      keepOpen: true,
      requireEditor: true,
      domNotes: form.naverEditorDomNotes || "",
      runtimeRoot,
      log: (message, level) => safeLog(jobId, message, level)
    });
  } catch (error) {
    if (error.code === "SESSION_EXPIRED" && account.id) {
      updateAccountSession(runtimeRoot, account.id, "expired", settings);
      emitAccountStore(runtimeRoot);
    }
    throw error;
  }
  if (result.status !== "valid" || !result.preparedSession) {
    throw createSessionExpiredError("Naver 로그인 세션을 확인하지 못했습니다. 먼저 계정관리에서 세션확인을 완료해 주세요.");
  }

  if (account.id) {
    updateAccountSession(runtimeRoot, account.id, "valid", settings);
    emitAccountStore(runtimeRoot);
  }
  const prepared = result.preparedSession;
  activeNaverSessions.set(sessionKey, prepared);
  safeLog(jobId, "Naver 글쓰기 편집기 준비 결과를 앱에 저장했습니다.");
  safeLog(jobId, "Naver 글쓰기 편집기 확인 완료. Research/Title Agent를 시작합니다.");
  return prepared;
}

async function startJob(form) {
  if (activeJob) {
    throw new Error("이미 실행 중인 작업이 있습니다.");
  }

  const runtimeRoot = getRuntimeRoot();
  ensureRuntimeFiles(runtimeRoot);
  ensureSettingsFile(runtimeRoot);
  const settings = readSettings(runtimeRoot);
  ensureAccountStoreFile(runtimeRoot, settings);

  const jobId = `job_${Date.now()}`;
  activeJob = { id: jobId, cancelled: false };

  const accountStore = readAccountStore(runtimeRoot, settings);
  const account = resolveAccount(form, accountStore);
  const category = String(form.category || "").trim();
  const categoryKeyword = String(form.keyword || "").trim();
  const naverId = String(form.naverId || account.naverId || "").trim();
  const blogId = String(form.blogId || account.blogId || naverId).trim();
  const naverPassword = String(form.naverPassword || account.naverPassword || "");
  const codexCmdPath = resolveCodexCmdPath(form.codexCmdPath || "codex");
  const publishVisibility = String(form.publishVisibility || (form.publishPrivate === false ? "public" : "private"));
  const publishPrivate = publishVisibility !== "public";
  const publishScheduleMode = String(form.publishScheduleMode || "now");
  const reserveAfterHours = Number(form.reserveAfterHours || 0);
  const includeTitleImage = form.includeTitleImage !== false;
  const imageAspectRatio = normalizeImageAspectRatio(form.imageAspectRatio || settings.imageAspectRatio);
  const maxBodyImages = Math.min(10, Math.max(0, Number.isFinite(Number(form.maxBodyImages)) ? Number(form.maxBodyImages) : 2));
  const breakSentencesInBody = form.breakSentencesInBody !== false;
  const agentModels = form.agentModels || settings.agentModels || {};
  const shouldPublish = form.publishAfterGenerate === true || form.topicMode === "auto";
  if (!category) {
    activeJob = null;
    throw new Error("카테고리는 필수입니다.");
  }
  if (!categoryKeyword) {
    activeJob = null;
    throw new Error("카테고리별 검색 키워드는 필수입니다.");
  }
  if (shouldPublish && !naverId) {
    activeJob = null;
    throw new Error("발행까지 진행하려면 Naver ID가 필요합니다.");
  }
  if (shouldPublish) {
    safeLog(jobId, `Naver 로그인 ID: ${naverId} / 블로그 주소 ID: ${blogId}`);
  }

  let preparedNaverSession = null;
  let browserProfileDir = getAccountProfileDir(runtimeRoot, account);
  try {
    if (shouldPublish) {
      preparedNaverSession = await verifyPublishSessionBeforeGeneration({
        runtimeRoot,
        account,
        blogId,
        form,
        settings,
        jobId
      });
      browserProfileDir = preparedNaverSession.browserProfileDir || browserProfileDir;
      safeLog(jobId, "Naver 세션 확인 완료. 주제 입력값 준비 단계로 이동합니다.");
    }
  } catch (error) {
    activeJob = null;
    if (error.code === "SESSION_EXPIRED") {
      if (account.id) {
        updateAccountSession(runtimeRoot, account.id, "expired", settings);
        emitAccountStore(runtimeRoot);
        await closeNaverSession(sessionKeyFor(account, browserProfileDir));
      }
      safeLog(jobId, error.message, "warn");
      updateStatus(jobId, "session_expired", error.message);
      emit("job:complete", {
        jobId,
        accountId: account.id || "",
        topic: "",
        keyword: "",
        category,
        blogId,
        status: "session_expired",
        title: "",
        article: "",
        images: [],
        imageNotes: [],
        tokenUsage: { total: 0 },
        tags: [],
        history: readHistory(runtimeRoot)
      });
      return { status: "session_expired", reason: error.message };
    }
    throw error;
  }

  let resolved;
  let topic = "";
  let keyword = "";
  try {
    safeLog(jobId, "주제 입력값 준비 시작");
    resolved = await resolveTopicInput(form, category, (message, level) => safeLog(jobId, message, level, "research"));
    topic = resolved.topic;
    keyword = resolved.keyword;
    safeLog(jobId, "주제 입력값 준비 완료");
  } catch (error) {
    activeJob = null;
    throw error;
  }

  if (!topic && String(form.topicMode || "manual") !== "auto") {
    activeJob = null;
    throw new Error("주제는 필수입니다.");
  }

  const jobDir = path.join(runtimeRoot, "jobs", jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const nonSensitiveJob = { jobId, accountId: account.id || "", topic, keyword, category, blogId, status: "generating" };
  const jobTokenUsage = {
    total: 0,
    grossTotal: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    rateLimits: null
  };
  writeSettings(runtimeRoot, {
    naverId,
    blogId,
    naverPassword,
    topic,
    keyword,
    category,
    codexCmdPath,
    primarySearchProvider: form.primarySearchProvider || "naver",
    fallbackSearchProvider: form.fallbackSearchProvider || "google",
    naverSearchUrl: form.naverSearchUrl || "",
    googleSearchUrl: form.googleSearchUrl || "",
    naverEditorDomNotes: form.naverEditorDomNotes || "",
    publishAfterGenerate: shouldPublish,
    publishPrivate,
    topicMode: form.topicMode || "manual",
    repeatTermMinutes: Number(form.repeatTermMinutes || 60),
    publishVisibility,
    publishScheduleMode,
    reserveAfterHours,
    includeTitleImage,
    imageAspectRatio,
    maxBodyImages,
    breakSentencesInBody,
    agentModels
  });
  updateStatus(jobId, "generating", "Agent 생성 준비");

  let keywordLanePlan = buildKeywordLanePlan(keyword, [], { blogId, category });
  let latestLaneResult = normalizeResearchLaneResult({}, keywordLanePlan);
  let latestResearchTitleResult = null;
  try {
    const currentDateLabel = todayLabel();
    const history = readHistory(runtimeRoot);
    const accountHistory = history.filter((entry) => String(entry.blog_id || "") === blogId);
    keywordLanePlan = buildKeywordLanePlan(keyword, history, { blogId, category });
    latestLaneResult = normalizeResearchLaneResult({}, keywordLanePlan);
    const titleHistory = accountHistory
      .filter((entry) => Array.isArray(entry.embedding))
      .map((entry) => ({ title: entry.title, embedding: entry.embedding }));

    const usesImages = includeTitleImage || maxBodyImages > 0;
    const generationSubject = topic || `${category} ${keyword}`.trim();
    const modelSnapshot = {
      main: agentModels.main || "high",
      research: agentModels.research || "high",
      writer: agentModels.writer || "high",
      image: agentModels.image || "medium"
    };
    safeLog(jobId, `Agent 모델 설정: Main ${modelSnapshot.main}, Research/Title ${modelSnapshot.research}, Writer ${modelSnapshot.writer}, Image Worker ${modelSnapshot.image}`);
    safeLog(jobId, `Codex ${usesImages ? "본문/이미지 프롬프트" : "본문"} 생성 시작: ${generationSubject}`);
    const generationStartedAt = Date.now();
    let generationPhase = "준비 중";
    const generationHeartbeat = setInterval(() => {
      const minutes = Math.max(1, Math.ceil((Date.now() - generationStartedAt) / 60000));
      safeLog(jobId, `현재 작업 중입니다 - 경과 ${minutes}분`);
      updateStatus(jobId, "generating", `${generationPhase} (${minutes}분 경과)`);
    }, 60000);
    let codexResult;
    try {
      codexResult = await runCodexGeneration({
        codexCmdPath,
        runtimeRoot,
        jobDir,
        topic,
        keyword,
        category,
        topicMode: form.topicMode || "manual",
        searchResults: [],
        currentDateLabel,
        includeTitleImage,
        imageAspectRatio,
        maxBodyImages,
        sourceQuality: { status: "not_requested" },
        excludedTopics: form.excludedTopics || "",
        publishPurpose: form.publishPurpose || "",
        preferredTone: form.preferredTone || "",
        freshnessLevel: form.freshnessLevel || "auto",
        searchChannel: form.searchChannel || "blog",
        trustBlogAsSource: form.trustBlogAsSource === true,
        keywordLanes: keywordLanePlan.lanes,
        recommendedKeywordLanes: keywordLanePlan.recommended,
        agentModels,
        historyTitles: titleHistory.map((item) => item.title),
        accountImageStyle: {
          accountId: account.id || "",
          sampleImagePath: account.sampleImagePath || "",
          sampleImageHash: account.sampleImageHash || "",
          imageStylePrompt: account.imageStylePrompt || "",
          imageStylePromptStatus: account.imageStylePromptStatus || "missing",
          imageStylePromptSourceImageHash: account.imageStylePromptSourceImageHash || ""
        },
        onAccountImageStylePrompt: (styleResult) => {
          const store = readAccountStore(runtimeRoot, readSettings(runtimeRoot));
          const target = store.accounts.find((item) => item.id === account.id);
          if (!target) return;
          target.imageStylePrompt = String(styleResult.imageStylePrompt || "");
          target.imageStylePromptUpdatedAt = new Date().toISOString();
          target.imageStylePromptStatus = styleResult.status === "success" ? "ready" : "failed";
          target.imageStylePromptSourceImageHash = String(styleResult.sampleImageHash || target.sampleImageHash || "");
          target.imageStylePromptError = String(styleResult.failureReason || "");
          const saved = writeAccountStore(runtimeRoot, store, readSettings(runtimeRoot));
          emit("accounts:update", withAccountImageUrls(runtimeRoot, saved));
        },
        onResearchTitle: (researchResult) => {
          latestResearchTitleResult = researchResult || null;
          latestLaneResult = normalizeResearchLaneResult(researchResult, keywordLanePlan);
          const selectedTitle = String(researchResult.finalTitle || researchResult.selectedTitle || "").trim();
          emit("job:selectedTitle", {
            jobId,
            title: selectedTitle,
            status: researchResult.status || "",
            verdict: researchResult.status || "",
            factBased: researchResult.factBased === true,
            searchNeed: researchResult.searchNeed || "",
            at: new Date().toISOString()
          });
          if (selectedTitle) {
            safeLog(jobId, `선정 제목: ${selectedTitle}`, "info", "main");
          }
          if (latestLaneResult.topicLane) {
            safeLog(jobId, `선택 키워드 lane: ${latestLaneResult.topicLane}`, "info", "research");
          }
        },
        onTokenUsage: (usage) => {
          jobTokenUsage.total = Number(usage.total || 0);
          jobTokenUsage.grossTotal = Number(usage.grossTotal || jobTokenUsage.grossTotal || 0);
          jobTokenUsage.inputTokens = Number(usage.inputTokens || 0);
          jobTokenUsage.cachedInputTokens = Number(usage.cachedInputTokens || 0);
          jobTokenUsage.outputTokens = Number(usage.outputTokens || 0);
          if (usage.rateLimits) {
            jobTokenUsage.rateLimits = usage.rateLimits;
          }
          emit("job:tokens", {
            jobId,
            total: jobTokenUsage.total,
            grossTotal: jobTokenUsage.grossTotal,
            inputTokens: jobTokenUsage.inputTokens,
            cachedInputTokens: jobTokenUsage.cachedInputTokens,
            outputTokens: jobTokenUsage.outputTokens,
            rateLimits: jobTokenUsage.rateLimits,
            agent: usage.agent || "",
            agentTotal: Number(usage.agentTotal || 0),
            agentDelta: Number(usage.agentDelta || 0),
            agentGrossDelta: Number(usage.agentGrossDelta || 0),
            final: usage.final === true,
            at: new Date().toISOString()
          });
        },
        onSearchNeeded: async (researchResult, context) => {
          const searchContext = context || {};
          const searchTopic = selectSearchTopicForResearch(researchResult, {
            topic,
            category,
            keyword,
            topicMode: form.topicMode || "manual"
          });
          const laneResult = normalizeResearchLaneResult(researchResult, keywordLanePlan);
          latestLaneResult = laneResult;
          const searchKeyword = laneResult.selectedKeywordPhrases.join(", ") || keyword || category;
          safeLog(jobId, `Research/Title Agent 요청으로 검색 후보 수집 시작: ${researchResult.searchNeed || "normal"}`, "info", "research");
          const searchResults = await collectSearchResults({
            topic: searchTopic,
            keyword: searchKeyword,
            category,
            publishPurpose: form.publishPurpose || "",
            researchGuidance: [
              researchResult.searchFlowSummary,
              researchResult.writerBrief,
              ...(Array.isArray(researchResult.coreQuestions) ? researchResult.coreQuestions : []),
              ...(Array.isArray(researchResult.mustCover) ? researchResult.mustCover : []),
              ...(Array.isArray(researchResult.uncertainItems) ? researchResult.uncertainItems : [])
            ].filter(Boolean).join(" "),
            searchQueries: laneResult.searchQueries,
            searchNeed: researchResult.searchNeed || "",
            topicMode: form.topicMode || "manual",
            primaryProvider: form.primarySearchProvider || "naver",
            fallbackProvider: form.fallbackSearchProvider || "google",
            naverSearchUrl: form.naverSearchUrl,
            googleSearchUrl: form.googleSearchUrl,
            searchChannel: form.searchChannel || "blog",
            trustBlogAsSource: form.trustBlogAsSource === true
          }, (message, level) => safeLog(jobId, message, level, "research"));
          const mergedSearchResults = mergeSearchResults(searchContext.previousSearchResults, searchResults);
          safeLog(jobId, `검색 후보 수집 완료: ${searchResults.length}개, 누적 ${mergedSearchResults.length}개`, "info", "research");
          const sourceQuality = summarizeSourceQuality(mergedSearchResults, form.topicMode || "manual", {
            searchNeed: researchResult.searchNeed || ""
          });
          if (sourceQuality.status === "insufficient") {
            safeLog(jobId, sourceQuality.reason, "warn", "research");
          }
          return { searchResults: mergedSearchResults, sourceQuality };
        }
      }, (message, level, agent = "main") => {
        const phaseMatch = String(message || "").match(/^Codex 단계:\s*(.+)$/);
        if (phaseMatch) {
          generationPhase = phaseMatch[1];
          updateStatus(jobId, "generating", `Codex ${generationPhase}`);
        }
        safeLog(jobId, message, level, agent);
      });
    } finally {
      clearInterval(generationHeartbeat);
    }
    if (codexResult.tokenUsage?.total) {
      jobTokenUsage.total = Number(codexResult.tokenUsage.total || 0);
      jobTokenUsage.grossTotal = Number(codexResult.tokenUsage.grossTotal || 0);
      jobTokenUsage.inputTokens = Number(codexResult.tokenUsage.inputTokens || 0);
      jobTokenUsage.cachedInputTokens = Number(codexResult.tokenUsage.cachedInputTokens || 0);
      jobTokenUsage.outputTokens = Number(codexResult.tokenUsage.outputTokens || 0);
    }
    if (codexResult.tokenUsage?.rateLimits) {
      jobTokenUsage.rateLimits = codexResult.tokenUsage.rateLimits;
    }
    persistCodexRateLimits(runtimeRoot, jobTokenUsage.rateLimits);
    const sourceFailureReason = detectCodexSourceFailure(codexResult);
    if (sourceFailureReason) {
      latestResearchTitleResult = codexResult.researchTitleResult || latestResearchTitleResult;
      latestLaneResult = normalizeResearchLaneResult(latestResearchTitleResult, keywordLanePlan);
      const sourceError = new Error(sourceFailureReason);
      sourceError.failurePhase = codexResult.failurePhase || (codexResult.researchTitleResult ? "research" : "");
      throw sourceError;
    }
    const researchTitleResult = codexResult.researchTitleResult || {};

    const agentResult = normalizeAgentResult({
      runtimeRoot,
      jobDir,
      topic,
      keyword,
      includeTitleImage,
      maxBodyImages,
      currentDateLabel,
      result: codexResult
    });
    for (const note of agentResult.imageWarnings || []) {
      const imageNoteLevel = /실패|없|못|권한|거부|찾을 수 없|Access|EPERM|denied/i.test(String(note || ""))
        ? "warn"
        : "info";
      safeLog(jobId, note, imageNoteLevel);
    }

    const embedding = createEmbedding(agentResult.title);
    let maxSimilarity = 0;
    for (const item of titleHistory) {
      maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(embedding, item.embedding));
    }

    if (maxSimilarity >= 0.75) {
      const duplicateEntry = {
        id: jobId,
        create_at: new Date().toISOString(),
        account_id: account.id || "",
        blog_id: blogId,
        title: agentResult.title,
        topic,
        keyword,
        category,
        ...keywordLaneHistoryFields(latestLaneResult),
        status: "duplicate_retry",
        harness_version: "lean-agent-v1",
        final_verdict: "REVISION",
        failure_phase: "main_review",
        research_title: researchTitleResult.finalTitle || researchTitleResult.selectedTitle || "",
        embedding_model: "local-hash-v1",
        embedding,
        token_total: jobTokenUsage.total,
        reason: `기존 제목과 cosine similarity ${maxSimilarity.toFixed(3)}`
      };
      appendHistory(runtimeRoot, duplicateEntry);
      safeLog(jobId, duplicateEntry.reason, "warn");
      updateStatus(jobId, "duplicate_retry", "유사 제목으로 중단");
      emit("job:complete", {
        ...nonSensitiveJob,
        status: "duplicate_retry",
        title: agentResult.title,
        article: agentResult.article,
        images: getPreviewImages(agentResult),
        imageNotes: agentResult.imageWarnings || [],
        tokenUsage: jobTokenUsage,
        history: readHistory(runtimeRoot)
      });
      return { status: "duplicate_retry" };
    }

    const tags = buildTags(topic, keyword, agentResult.tags);
    emit("job:preview", {
      jobId,
      title: agentResult.title,
      article: agentResult.article,
      images: getPreviewImages(agentResult),
      imageNotes: agentResult.imageWarnings || [],
      tokenUsage: jobTokenUsage,
      tags
    });

    let publishStatus = "generated";
    let publishReason = "";

    if (shouldPublish) {
      updateStatus(jobId, "publishing", `Naver 블로그 ${publishVisibility === "public" ? "전체공개" : "비공개"} 발행 자동화`);
      await publishToNaver({
        accountId: account.id || "",
        naverId,
        blogId,
        naverPassword,
        category,
        publishPrivate,
        publishVisibility,
        publishScheduleMode,
        reserveAfterHours,
        failOnLoginRequired: form.failOnLoginRequired === true,
        title: agentResult.title,
        article: agentResult.article,
        titleImagePath: agentResult.titleImagePath,
        bodyImages: agentResult.bodyImages,
        breakSentencesInBody,
        tags,
        domNotes: form.naverEditorDomNotes || "",
        browserProfileDir,
        preparedContext: preparedNaverSession?.context,
        preparedPage: preparedNaverSession?.page,
        log: (message, level) => safeLog(jobId, message, level)
      });
      if (account.id) {
        updateAccountSession(runtimeRoot, account.id, "valid", settings);
        emitAccountStore(runtimeRoot);
      }
      publishStatus = "success";
      updateStatus(jobId, "success", "발행 완료");
    } else {
      publishReason = "사용자가 발행 실행을 끄고 생성만 실행했습니다.";
      updateStatus(jobId, "generated", "본문 생성 완료, 발행 대기");
    }

    const entry = {
      id: jobId,
      create_at: new Date().toISOString(),
      account_id: account.id || "",
      blog_id: blogId,
      title: agentResult.title,
      topic,
      keyword,
      category,
      ...keywordLaneHistoryFields(latestLaneResult),
      status: publishStatus,
      harness_version: "lean-agent-v1",
      final_verdict: "PASS",
      failure_phase: "",
      research_title: researchTitleResult.finalTitle || researchTitleResult.selectedTitle || "",
      topic_type: researchTitleResult.topicType || "",
      fact_based: researchTitleResult.factBased === true,
      source_summary: researchTitleResult.searchFlowSummary || "",
      embedding_model: "local-hash-v1",
      embedding,
      token_total: jobTokenUsage.total,
      reason: publishReason
    };
    appendHistory(runtimeRoot, entry);
    if (publishStatus === "success") {
      safeLog(jobId, "Naver 발행 완료");
    }

    emit("job:complete", {
      ...nonSensitiveJob,
      status: publishStatus,
      title: agentResult.title,
      article: agentResult.article,
      images: getPreviewImages(agentResult),
        imageNotes: agentResult.imageWarnings || [],
      tokenUsage: jobTokenUsage,
      tags,
      history: readHistory(runtimeRoot)
    });
    return { status: publishStatus };
  } catch (error) {
    const failedStatus = error.code === "SESSION_EXPIRED"
      ? "session_expired"
      : error.code === "CODEX_USAGE_LIMIT" ? "codex_usage_limit" : "failed";
    persistCodexRateLimits(runtimeRoot, jobTokenUsage.rateLimits);
    if (failedStatus === "session_expired" && account.id) {
      updateAccountSession(runtimeRoot, account.id, "expired", settings);
      emitAccountStore(runtimeRoot);
      await closeNaverSession(sessionKeyFor(account, browserProfileDir));
    }
    const embedding = createEmbedding(`${topic} ${keyword}`.trim() || topic);
    appendHistory(runtimeRoot, {
      id: jobId,
      create_at: new Date().toISOString(),
      account_id: account.id || "",
      blog_id: blogId,
      title: "",
      topic,
      keyword,
      category,
      ...keywordLaneHistoryFields(latestLaneResult),
      status: failedStatus,
      embedding_model: "local-hash-v1",
      embedding,
      token_total: jobTokenUsage.total,
      failure_phase: error.failurePhase || "",
      research_title: latestResearchTitleResult?.finalTitle || latestResearchTitleResult?.selectedTitle || "",
      reason: error.message
    });
    safeLog(jobId, error.message, "error");
    updateStatus(jobId, failedStatus, error.message);
    emit("job:complete", {
      ...nonSensitiveJob,
      status: failedStatus,
      title: "",
      article: "",
      images: [],
      failurePhase: error.failurePhase || "",
      tokenUsage: jobTokenUsage,
      history: readHistory(runtimeRoot)
    });
    return { status: failedStatus, reason: error.message, failurePhase: error.failurePhase || "" };
  } finally {
    activeJob = null;
  }
}

app.whenReady().then(() => {
  ensureRuntimeFiles(getRuntimeRoot());
  ensureSettingsFile(getRuntimeRoot());
  ensureAccountStoreFile(getRuntimeRoot(), readSettings(getRuntimeRoot()));
  createWindow();

  ipcMain.handle("app:getInitialData", () => {
    const runtimeRoot = getRuntimeRoot();
    const settings = readSettings(runtimeRoot);
    return {
      runtimeRoot,
      codexCmdPath: resolveCodexCmdPath(settings.codexCmdPath || "codex"),
      chrome: detectChromeInstall(),
      settings,
      accountStore: withAccountImageUrls(runtimeRoot, readAccountStore(runtimeRoot, settings)),
      history: readHistory(runtimeRoot)
    };
  });

  ipcMain.handle("chrome:installAndQuit", async () => {
    await shell.openExternal("https://www.google.com/chrome/");
    setTimeout(() => app.quit(), 500);
    return true;
  });

  ipcMain.handle("settings:save", (_event, settings) => {
    const runtimeRoot = getRuntimeRoot();
    return writeSettings(runtimeRoot, settings);
  });
  ipcMain.handle("shortcontents:categories", () => listShortContentCategories());
  ipcMain.handle("shortcontents:titles", (_event, categoryName) => listShortContentTitles(categoryName));
  ipcMain.handle("codex:refreshUsage", async () => {
    const runtimeRoot = getRuntimeRoot();
    const settings = readSettings(runtimeRoot);
    const savedRateLimits = settings.codexRateLimits || null;
    if (activeJob || process.env.BLOGAUTO_SKIP_CODEX_USAGE_REFRESH === "1") {
      return {
        skipped: true,
        rateLimits: savedRateLimits,
        tokenUsage: {
          total: 0,
          rateLimits: savedRateLimits
        }
      };
    }
    let snapshot;
    try {
      snapshot = await fetchCodexUsageSnapshot({
        codexCmdPath: resolveCodexCmdPath(settings.codexCmdPath || "codex"),
        cwd: runtimeRoot
      });
    } catch (error) {
      snapshot = {
        source: "unavailable",
        unavailableReason: error instanceof Error ? error.message : String(error || "Codex 사용량 조회 실패"),
        rateLimits: null,
        tokenUsage: {
          total: 0,
          rateLimits: null
        }
      };
    }
    if (snapshot.rateLimits) {
      persistCodexRateLimits(runtimeRoot, snapshot.rateLimits);
    }
    if (!snapshot.rateLimits && savedRateLimits) {
      return {
        ...snapshot,
        source: snapshot.source || "saved",
        savedFallback: true,
        rateLimits: savedRateLimits,
        tokenUsage: {
          ...(snapshot.tokenUsage || {}),
          total: Number(snapshot.tokenUsage?.total || 0),
          rateLimits: savedRateLimits
        }
      };
    }
    return snapshot;
  });
  ipcMain.handle("accounts:save", (_event, store) => {
    const runtimeRoot = getRuntimeRoot();
    const saved = writeAccountStore(runtimeRoot, store, readSettings(runtimeRoot));
    const publicStore = withAccountImageUrls(runtimeRoot, saved);
    emit("accounts:update", publicStore);
    return publicStore;
  });
  ipcMain.handle("accounts:chooseSampleImage", async (_event, accountId) => {
    const runtimeRoot = getRuntimeRoot();
    const settings = readSettings(runtimeRoot);
    const store = readAccountStore(runtimeRoot, settings);
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error("Account not found.");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose sample image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return withAccountImageUrls(runtimeRoot, store);
    }
    const sourcePath = result.filePaths[0];
    const destDir = accountAssetDir(runtimeRoot, account.id);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = accountSampleImagePath(runtimeRoot, account.id, sourcePath);
    fs.copyFileSync(sourcePath, destPath);
    const nextHash = fileHash(destPath);
    const changed = nextHash !== account.sampleImageHash;
    account.sampleImagePath = destPath;
    account.sampleImageHash = nextHash;
    account.sampleImageUpdatedAt = new Date().toISOString();
    if (changed) {
      account.imageStylePromptStatus = account.imageStylePrompt ? "stale" : "missing";
      account.imageStylePromptError = "";
    }
    const saved = writeAccountStore(runtimeRoot, store, settings);
    const publicStore = withAccountImageUrls(runtimeRoot, saved);
    emit("accounts:update", publicStore);
    return publicStore;
  });
  ipcMain.handle("accounts:deleteSampleImage", (_event, accountId) => {
    const runtimeRoot = getRuntimeRoot();
    const settings = readSettings(runtimeRoot);
    const store = readAccountStore(runtimeRoot, settings);
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error("Account not found.");
    const samplePath = String(account.sampleImagePath || "");
    const assetRoot = path.resolve(accountAssetDir(runtimeRoot, account.id));
    const resolvedSample = samplePath ? path.resolve(samplePath) : "";
    if (resolvedSample && resolvedSample.startsWith(assetRoot) && fs.existsSync(resolvedSample)) {
      fs.rmSync(resolvedSample, { force: true });
    }
    account.sampleImagePath = "";
    account.sampleImageHash = "";
    account.sampleImageUpdatedAt = "";
    account.imageStylePrompt = "";
    account.imageStylePromptUpdatedAt = "";
    account.imageStylePromptStatus = "missing";
    account.imageStylePromptSourceImageHash = "";
    account.imageStylePromptError = "";
    const saved = writeAccountStore(runtimeRoot, store, settings);
    const publicStore = withAccountImageUrls(runtimeRoot, saved);
    emit("accounts:update", publicStore);
    return publicStore;
  });
  ipcMain.handle("accounts:checkSession", async (_event, accountId) => {
    if (activeJob) {
      throw new Error("작업 실행 중에는 계정 세션을 다시 확인할 수 없습니다.");
    }
    const runtimeRoot = getRuntimeRoot();
    const settings = readSettings(runtimeRoot);
    const store = readAccountStore(runtimeRoot, settings);
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error("계정을 찾을 수 없습니다.");
    const browserProfileDir = getAccountProfileDir(runtimeRoot, account);
    const key = sessionKeyFor(account, browserProfileDir);
    await closeNaverSession(key);
    safeLog("session", `계정 profile: ${browserProfileDir}`);
    const result = await checkNaverSession({
      naverId: account.naverId,
      blogId: account.blogId || account.naverId,
      naverPassword: account.naverPassword || "",
      browserProfileDir,
      interactiveLogin: true,
      keepOpen: true,
      requireEditor: true,
      domNotes: settings.naverEditorDomNotes || "",
      runtimeRoot,
      log: (message, level) => safeLog("session", message, level)
    });
    const { preparedSession, page, ...publicResult } = result;
    const sessionStatus = result.status === "valid"
      ? "valid"
      : result.status === "expired"
        ? "expired"
        : "unknown";
    const saved = updateAccountSession(runtimeRoot, account.id, sessionStatus, settings);
    emit("accounts:update", saved);
    if (result.status !== "valid") {
      safeLog("session", `${account.label || account.naverId} 계정 세션이 만료 상태입니다.`, "warn");
      return publicResult;
    }
    if (preparedSession) {
      activeNaverSessions.set(key, preparedSession);
    }
    safeLog("session", `${account.label || account.naverId} 계정 글쓰기 편집기 확인 완료.`);
    return publicResult;
  });
  ipcMain.handle("history:load", () => readHistory(getRuntimeRoot()));
  ipcMain.handle("job:start", (_event, form) => startJob(form));
  ipcMain.handle("runtime:open", () => shell.openPath(getRuntimeRoot()));
  ipcMain.handle("file:open", (_event, filePath) => {
    if (!filePath) return false;
    const runtimeRoot = path.resolve(getRuntimeRoot());
    const resolved = path.resolve(String(filePath));
    if (!resolved.startsWith(runtimeRoot)) {
      throw new Error("런타임 폴더 밖의 파일은 열 수 없습니다.");
    }
    return shell.openExternal(pathToFileURL(resolved).toString());
  });
  ipcMain.handle("file:showInFolder", (_event, filePath) => {
    if (!filePath) return false;
    const runtimeRoot = path.resolve(getRuntimeRoot());
    const resolved = path.resolve(String(filePath));
    if (!resolved.startsWith(runtimeRoot)) {
      throw new Error("런타임 폴더 밖의 파일 위치는 열 수 없습니다.");
    }
    shell.showItemInFolder(resolved);
    return true;
  });

  if (process.env.BLOGAUTO_AUTOSTART === "1") {
    const runAutostart = () => {
      const runtimeRoot = getRuntimeRoot();
      const settings = readSettings(runtimeRoot);
      setTimeout(() => {
        startJob(settings).catch((error) => {
          safeLog("autorun", error.message, "error");
          updateStatus("autorun", "failed", error.message);
        });
      }, 700);
    };

    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", runAutostart);
    } else {
      runAutostart();
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const session of activeNaverSessions.values()) {
    session.context?.close().catch(() => {});
  }
  activeNaverSessions.clear();
});
