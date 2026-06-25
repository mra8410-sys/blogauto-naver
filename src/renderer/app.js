const state = {
  currentJobId: "",
  running: false,
  autoRunning: false,
  autoPausedForSession: false,
  autoWaitingSessionAccountId: "",
  autoResumeAccountId: "",
  autoPendingSessionTarget: null,
  saveTimer: null,
  autoDelayWake: null,
  tokenTotal: 0,
  codexRateLimits: null,
  chrome: { available: true, path: "" },
  accountStore: { selectedAccountId: "", accounts: [] },
  accountManagerOpen: false,
  categoryManagerOpen: false,
  editingCategoryId: "",
  history: [],
  staleTitleResetHistory: {},
  shortContentTitles: [],
  selectedShortContentTitles: [],
  currentArticleTitle: "",
  articlePromptFilePath: "",
  imagePromptFilePath: "",
  articlePromptText: "",
  imagePromptText: ""
};

const $ = (selector) => document.querySelector(selector);
const DEFAULT_NAVER_SEARCH_URL = "https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query={query}";
const DEFAULT_GOOGLE_SEARCH_URL = "https://www.google.com/search?q={query}&num=20&hl=ko";
const STARTUP_NOTICE_KEY = "blogauto.startupNotice.dismissed.v2";
const DEFAULT_AGENT_MODELS = {
  main: "low",
  research: "medium",
  writer: "medium",
  image: "low"
};
const AGENT_MODEL_SELECTORS = {
  main: "#mainAgentModel",
  research: "#researchAgentModel",
  writer: "#writerAgentModel",
  image: "#imageWorkerModel"
};
const VALID_AGENT_MODEL_VALUES = new Set(["low", "medium", "high", "xhigh"]);
const AUTO_TARGET_MAX_ATTEMPTS = 3;
const AUTO_RESEARCH_MAX_ATTEMPTS = 2;
const SHORT_CONTENT_RESET_GAP_MS = 8 * 60 * 60 * 1000;
const DEFAULT_IMAGE_ASPECT_RATIO = "16:9";
const IMAGE_ASPECT_RATIOS = new Set([DEFAULT_IMAGE_ASPECT_RATIO, "9:16", "1:1"]);
const IMAGE_COUNTS = new Set([1, 3, 5, 7]);

function normalizeImageAspectRatio(value) {
  const normalized = String(value || "").trim();
  return IMAGE_ASPECT_RATIOS.has(normalized) ? normalized : DEFAULT_IMAGE_ASPECT_RATIO;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function selectedAccount() {
  return state.accountStore.accounts.find((account) => account.id === state.accountStore.selectedAccountId)
    || state.accountStore.accounts[0]
    || null;
}

function setRunState(status, detail = "") {
  const badge = $("#runState");
  const classMap = {
    success: "success",
    generated: "success",
    failed: "danger",
    codex_usage_limit: "danger",
    session_expired: "danger",
    duplicate_retry: "warning",
    publishing: "info",
    generating: "info"
  };
  const labelMap = {
    success: "성공",
    generated: "생성",
    failed: "실패",
    codex_usage_limit: "한도초과",
    session_expired: "세션만료",
    duplicate_retry: "중복",
    publishing: "발행",
    generating: "생성중"
  };
  badge.className = `badge ${classMap[status] || "info"}`;
  badge.textContent = detail && detail !== status ? detail : (labelMap[status] || status || "대기");
}

function addLog(payload) {
  const streamMap = {
    main: "#mainLogStream",
    research: "#researchLogStream",
    writer: "#writerLogStream",
    image: "#mainLogStream"
  };
  const stream = $(streamMap[payload.agent] || streamMap.main);
  if (!stream) return;
  const line = document.createElement("div");
  line.className = `log-line ${payload.level || "info"}`;
  const time = payload.at ? new Date(payload.at).toLocaleTimeString() : new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${payload.message}`;
  stream.appendChild(line);
  stream.scrollTop = stream.scrollHeight;
}

function shouldRetryAutoResult(result) {
  const status = String(result?.status || "").toLowerCase();
  return !["success", "generated", "codex_usage_limit", "session_expired"].includes(status);
}

function autoAttemptLimitForResult(result) {
  return String(result?.failurePhase || "").toLowerCase() === "research"
    ? AUTO_RESEARCH_MAX_ATTEMPTS
    : AUTO_TARGET_MAX_ATTEMPTS;
}

function autoResultReason(result) {
  return String(result?.reason || result?.failureReason || result?.status || "unknown").trim();
}

function runAutoStartJob(form) {
  const testStartJob = window.__blogAutoTestHooks?.startJob;
  if (typeof testStartJob === "function") {
    return testStartJob(form);
  }
  return window.blogAuto.startJob(form);
}

function clearAgentLogs() {
  ["#mainLogStream", "#researchLogStream", "#writerLogStream"].forEach((selector) => {
    const stream = $(selector);
    if (stream) stream.innerHTML = "";
  });
}

function formatTokens(total) {
  const value = Number(total || 0);
  return `${value.toLocaleString()} tokens`;
}

function setTokenTotal(total) {
  state.tokenTotal = Number(total || 0);
  $("#tokenBadge").textContent = `누적 ${formatTokens(state.tokenTotal)}`;
}

function formatPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return "-";
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function limitBadgeClass(limitWindow) {
  const remaining = Number(limitWindow?.remainingPercent);
  if (!Number.isFinite(remaining)) return "badge limit unknown";
  if (remaining <= 10) return "badge limit danger";
  if (remaining <= 25) return "badge limit warning";
  return "badge limit";
}

function renderCodexRateLimits(status = "") {
  const primaryBadge = $("#codexPrimaryLimitBadge");
  const secondaryBadge = $("#codexSecondaryLimitBadge");
  if (!primaryBadge || !secondaryBadge) return;

  const rateLimits = state.codexRateLimits || {};
  const primary = rateLimits.primary || null;
  const secondary = rateLimits.secondary || null;

  primaryBadge.className = limitBadgeClass(primary);
  secondaryBadge.className = limitBadgeClass(secondary);
  primaryBadge.textContent = `5시간 잔량 ${formatPercent(primary?.remainingPercent)}`;
  secondaryBadge.textContent = `주간 잔량 ${formatPercent(secondary?.remainingPercent)}`;

  if (status === "checking" && !primary && !secondary) {
    primaryBadge.textContent = "5시간 확인 중";
    secondaryBadge.textContent = "주간 확인 중";
  }
  if (status === "failed" && !primary && !secondary) {
    primaryBadge.textContent = "5시간 확인 실패";
    secondaryBadge.textContent = "주간 확인 실패";
  }
}

function setCodexRateLimits(rateLimits, status = "") {
  if (rateLimits && typeof rateLimits === "object") {
    state.codexRateLimits = rateLimits;
  }
  renderCodexRateLimits(status);
}

function statusBadge(status) {
  const classMap = {
    success: "success",
    generated: "success",
    failed: "danger",
    codex_usage_limit: "danger",
    session_expired: "danger",
    duplicate_retry: "warning",
    publishing: "info",
    generating: "info"
  };
  const labelMap = {
    success: "성공",
    generated: "생성",
    failed: "실패",
    codex_usage_limit: "한도초과",
    session_expired: "세션만료",
    duplicate_retry: "중복",
    publishing: "발행",
    generating: "생성중"
  };
  return `<span class="badge ${classMap[status] || "info"}">${labelMap[status] || status || "대기"}</span>`;
}

function sessionBadge(account) {
  const status = account.sessionStatus || "unknown";
  const className = status === "valid" ? "success" : status === "expired" ? "danger" : "warning";
  const label = status === "valid" ? "정상" : status === "expired" ? "세션만료" : "미확인";
  return `<span class="badge ${className}">${label}</span>`;
}

function updateSessionNotice() {
  const notice = $("#sessionNotice");
  const text = $("#sessionNoticeText");
  if (!notice || !text) return;

  const accounts = state.accountStore.accounts || [];
  const needsLogin = !accounts.length || accounts.some((account) => account.sessionStatus !== "valid");
  if (!needsLogin) {
    notice.hidden = true;
    return;
  }

  if (!accounts.length) {
    text.textContent = "처음 실행 상태입니다. 계정을 추가한 뒤 계정별 세션 확인을 눌러 브라우저에서 로그인을 완료해 주세요.";
  } else {
    const names = accounts
      .filter((account) => account.sessionStatus !== "valid")
      .map((account) => account.label || account.naverId || "Naver 계정")
      .join(", ");
    text.textContent = `로그인이 필요한 계정: ${names}. 계정별로 선택 후 세션 확인을 진행해 주세요.`;
  }
  notice.hidden = false;
}

function wakeAutoDelay() {
  const wake = state.autoDelayWake;
  if (typeof wake === "function") {
    state.autoDelayWake = null;
    wake();
  }
}

function signalAutoSessionResume(accountId) {
  const verifiedAccountId = String(accountId || "");
  if (state.autoWaitingSessionAccountId && state.autoWaitingSessionAccountId === verifiedAccountId) {
    state.autoResumeAccountId = verifiedAccountId;
    wakeAutoDelay();
  }
}

async function checkAccountSession(account, options = {}) {
  if (!account) return;
  const resumeAuto = options.resumeAuto !== false;
  const startAuto = options.startAuto !== false;
  setRunState("generating", "로그인 완료 대기 중");
  addLog({
    level: "info",
    message: `${account.label || account.naverId} 계정의 브라우저가 열리면 로그인 완료까지 진행해 주세요.`,
    at: new Date().toISOString()
  });
  try {
    const result = await window.blogAuto.checkAccountSession(account.id);
    const currentAccount = state.accountStore.accounts.find((item) => item.id === account.id);
    if (result.status === "valid") {
      if (currentAccount) currentAccount.sessionStatus = "valid";
      renderAccounts();
      setRunState("generated", "세션 정상");
      const verifiedAccountId = currentAccount?.id || account.id || "";
      await loadNewsTitles({
        account: currentAccount || account,
        preserveSelected: true,
        reason: "계정 세션 시작"
      });
      if (resumeAuto && state.autoRunning && state.autoWaitingSessionAccountId === verifiedAccountId) {
        addLog({
          level: "info",
          message: "현재 대기 중인 계정의 세션확인이 완료되어 자동 작업을 바로 이어갑니다.",
          at: new Date().toISOString()
        });
        signalAutoSessionResume(verifiedAccountId);
      } else if (resumeAuto && state.autoRunning && state.autoWaitingSessionAccountId) {
        addLog({
          level: "info",
          message: "세션확인은 완료되었지만 현재 대기 중인 계정이 아니므로 대기 작업은 유지합니다.",
          at: new Date().toISOString()
        });
      } else if (startAuto && !state.autoRunning && state.autoPendingSessionTarget?.accountId === verifiedAccountId) {
        const pending = state.autoPendingSessionTarget;
        addLog({
          level: "info",
          message: `${pending.accountLabel || account.naverId} / ${pending.categoryName} 대기 작업을 다시 시작합니다.`,
          at: new Date().toISOString()
        });
        const startKey = pending.key;
        state.autoPendingSessionTarget = null;
        window.setTimeout(() => {
          startAutoPublishing(startKey).catch((error) => {
            state.running = false;
            state.autoRunning = false;
            state.autoPausedForSession = false;
            state.autoWaitingSessionAccountId = "";
            state.autoResumeAccountId = "";
            state.autoPendingSessionTarget = null;
            addLog({ level: "error", message: error.message, at: new Date().toISOString() });
            setRunState("failed", "실패");
          });
        }, 0);
      } else {
        const autoTarget = startAuto && $("#topicMode").value === "auto" ? firstAutoTargetForAccount(verifiedAccountId) : null;
        if (autoTarget && !state.running && !state.autoRunning) {
          const startKey = autoTargetKey(autoTarget);
          addLog({
            level: "info",
            message: `${autoTarget.account.label || autoTarget.account.naverId} / ${autoTarget.category.name} 자동 작업을 바로 시작합니다.`,
            at: new Date().toISOString()
          });
          window.setTimeout(() => {
            startAutoPublishing(startKey).catch((error) => {
              state.running = false;
              state.autoRunning = false;
              state.autoPausedForSession = false;
              state.autoWaitingSessionAccountId = "";
              state.autoResumeAccountId = "";
              state.autoPendingSessionTarget = null;
              $("#startButton").disabled = false;
              $("#stopAutoButton").disabled = true;
              addLog({ level: "error", message: error.message, at: new Date().toISOString() });
              setRunState("failed", "실패");
            });
          }, 0);
        } else {
          addLog({
            level: "info",
            message: "계정 세션확인이 완료되었습니다. 작업 시작을 누르면 이 세션으로 바로 진행합니다.",
            at: new Date().toISOString()
          });
        }
      }
    } else if (result.status === "expired") {
      if (currentAccount) currentAccount.sessionStatus = "expired";
      renderAccounts();
      setRunState("session_expired", "세션만료");
    } else {
      if (currentAccount) currentAccount.sessionStatus = "unknown";
      renderAccounts();
      setRunState("failed", "세션 확인 실패");
    }
  } catch (error) {
    addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    setRunState("failed", "세션 확인 실패");
  }
}

async function checkSelectedAccountSessions() {
  if (state.running || state.autoRunning) {
    addLog({ level: "warn", message: "작업 실행 중에는 세션일괄확인을 시작할 수 없습니다.", at: new Date().toISOString() });
    return;
  }
  const button = $("#bulkSessionCheckButton");
  const accounts = (state.accountStore.accounts || []).filter((account) => account.checked !== false);
  if (!accounts.length) {
    addLog({ level: "warn", message: "세션을 확인할 체크된 계정이 없습니다.", at: new Date().toISOString() });
    return;
  }

  if (button) button.disabled = true;
  addLog({ level: "info", message: `체크된 계정 ${accounts.length}개의 세션을 순차 확인합니다.`, at: new Date().toISOString() });
  try {
    for (const account of accounts) {
      addLog({
        level: "info",
        message: `${account.label || account.naverId} 계정 세션 확인을 시작합니다.`,
        at: new Date().toISOString()
      });
      await checkAccountSession(account, { resumeAuto: false, startAuto: false });
    }
    addLog({ level: "info", message: "세션일괄확인이 완료되었습니다.", at: new Date().toISOString() });
  } finally {
    if (button) button.disabled = false;
  }
}

function showStartupNoticeIfNeeded() {
  const notice = $("#startupNotice");
  if (!notice) return;
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(STARTUP_NOTICE_KEY) === "true";
  } catch {
    dismissed = false;
  }
  notice.hidden = dismissed;
}

async function dismissStartupNotice() {
  const notice = $("#startupNotice");
  if (notice) notice.hidden = true;
  try {
    window.localStorage.setItem(STARTUP_NOTICE_KEY, "true");
  } catch {
    // Ignore storage failures; the notice can still be dismissed for this session.
  }
  if (state.chrome.available === false) {
    addLog({
      level: "warn",
      message: "Chrome is not installed in a standard path. Article generation can continue, but Naver session checks and publishing require Chrome.",
      at: new Date().toISOString()
    });
  }
}

async function refreshCodexUsageOnStartup() {
  renderCodexRateLimits("checking");
  try {
    const usage = await window.blogAuto.refreshCodexUsage();
    if (usage?.rateLimits) {
      setCodexRateLimits(usage.rateLimits);
    } else if (!state.codexRateLimits) {
      renderCodexRateLimits();
    }
  } catch (error) {
    if (!state.codexRateLimits) {
      renderCodexRateLimits();
    }
  }
}

function renderHistory(history) {
  const body = $("#historyBody");
  body.innerHTML = "";
  if (!history || history.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"7\">기존 작업 기록이 없습니다.</td>";
    body.appendChild(row);
    return;
  }

  for (const item of history) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${statusBadge(item.status)}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(item.topic || "-")}</td>
      <td>${escapeHtml(item.keyword || "-")}</td>
      <td>${escapeHtml(formatTokens(item.token_total || 0))}</td>
      <td>${escapeHtml(item.create_at || "-")}</td>
      <td>${escapeHtml(item.reason || "")}</td>
    `;
    body.appendChild(row);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeImageCount(value) {
  const count = Number(value);
  return IMAGE_COUNTS.has(count) ? count : 5;
}

function setSelectedTitleText(value) {
  state.currentArticleTitle = String(value || "");
  const selectedTitle = $("#selectedTitle");
  if (selectedTitle) selectedTitle.textContent = value;
  renderSelectedTitleList();
}

function renderSelectedTitleList() {
  const list = $("#selectedTitleList");
  const count = $("#selectedTitleCount");
  if (!list) return;
  const titles = state.selectedShortContentTitles
    .map((title) => String(title || "").trim())
    .filter(Boolean);
  if (count) count.textContent = `${titles.length}개`;
  if (!titles.length) {
    list.innerHTML = "<span class=\"hint\">아직 선택된 제목이 없습니다.</span>";
    return;
  }
  list.innerHTML = titles
    .map((title, index) => (
      `<div class="selected-title-pill" title="${escapeHtml(title)}"><span>${index + 1}</span><strong>${escapeHtml(title)}</strong></div>`
    ))
    .join("");
}

function renderImages(images) {
  const grid = $("#imageGrid");
  grid.innerHTML = "";
  if (!images || images.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "생성된 이미지 파일이 없습니다. 아래 상태 메시지를 확인하세요.";
    grid.appendChild(empty);
    return;
  }

  for (const image of images) {
    const card = document.createElement("div");
    card.className = "thumb";
    card.title = image.path;
    card.innerHTML = `
      <img src="${image.url}" alt="${image.role === "title" ? "타이틀 이미지" : `본문 이미지 ${image.sequence}`}" />
      <span>${image.role === "title" ? "title" : `IMAGE ${image.sequence}`}</span>
      <code class="image-path">${escapeHtml(image.path)}</code>
      <div class="thumb-actions">
        <button type="button" data-action="open">열기</button>
        <button type="button" data-action="show">위치</button>
      </div>
    `;
    card.querySelector("[data-action='open']").addEventListener("click", () => window.blogAuto.openFile(image.path));
    card.querySelector("[data-action='show']").addEventListener("click", () => window.blogAuto.showFileInFolder(image.path));
    grid.appendChild(card);
  }
}

function renderImageNotes(imageNotes) {
  const notes = $("#imageNotes");
  notes.innerHTML = "";
  const usefulNotes = (imageNotes || []).filter(Boolean);
  for (const note of usefulNotes) {
    const item = document.createElement("div");
    item.className = note.includes("이미지") ? "note warn" : "note";
    item.textContent = note;
    notes.appendChild(item);
  }
}

function renderAccounts() {
  const list = $("#accountList");
  const manager = $("#accountManager");
  const toggle = $("#toggleAccountManagerButton");
  if (manager && toggle) {
    manager.classList.toggle("collapsed", !state.accountManagerOpen);
    toggle.textContent = state.accountManagerOpen ? "접기" : "펼치기";
  }
  list.innerHTML = "";
  if (!state.accountStore.accounts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "등록된 계정이 없습니다.";
    list.appendChild(empty);
    renderCategories();
    syncShortContentsFromAccount(null);
    updateSessionNotice();
    return;
  }

  for (const account of state.accountStore.accounts) {
    const row = document.createElement("div");
    row.className = `account-row${account.id === state.accountStore.selectedAccountId ? " selected" : ""}`;
    row.innerHTML = `
      <input class="list-check" type="checkbox" ${account.checked !== false ? "checked" : ""} aria-label="자동 발행 계정 선택" />
      <div class="account-main">
        <strong title="${escapeHtml(account.label || account.naverId || "Naver 계정")}">${escapeHtml(account.label || account.naverId || "Naver 계정")}</strong>
        <span title="${escapeHtml(account.naverId || "-")}">${escapeHtml(account.naverId || "-")}</span>
        <small>블로그 ${escapeHtml(account.blogId || account.naverId || "-")}</small>
        <small>카테고리 ${(account.categories || []).length}개</small>
        <small>숏텐츠 ${(account.shortContentSelectedTitles || []).length}개 대기 · 랜덤 ${normalizeRandomSelectionCount(account.shortContentRandomSelectionCount)}개</small>
      </div>
      <div class="account-actions">
        ${sessionBadge(account)}
        <button type="button" class="ghost small" data-action="session">세션확인</button>
        <button type="button" class="select-button small" data-action="select">${account.id === state.accountStore.selectedAccountId ? "선택됨" : "선택"}</button>
        <button type="button" class="ghost small danger-button" data-action="delete">삭제</button>
      </div>
    `;
    row.addEventListener("click", () => selectAccount(account.id));
    row.querySelector("input").addEventListener("click", (event) => {
      event.stopPropagation();
      account.checked = event.target.checked;
      saveAccountStoreNow();
    });
    row.querySelector("[data-action='select']").addEventListener("click", (event) => {
      event.stopPropagation();
      selectAccount(account.id);
    });
    row.querySelector("[data-action='session']").addEventListener("click", (event) => {
      event.stopPropagation();
      checkAccountSession(account);
    });
    row.querySelector("[data-action='delete']").addEventListener("click", async (event) => {
      event.stopPropagation();
      const label = account.label || account.naverId || "Naver 계정";
      if (!window.confirm(`${label} 계정을 삭제할까요? 이 계정에 등록된 카테고리도 함께 삭제됩니다.`)) {
        return;
      }
      state.accountStore.accounts = state.accountStore.accounts.filter((item) => item.id !== account.id);
      if (state.accountStore.selectedAccountId === account.id) {
        state.accountStore.selectedAccountId = state.accountStore.accounts[0]?.id || "";
        const nextAccount = selectedAccount();
        $("#accountLabel").value = nextAccount?.label || "";
        $("#naverId").value = nextAccount?.naverId || "";
        $("#blogId").value = nextAccount?.blogId || "";
        $("#naverPassword").value = nextAccount?.naverPassword || "";
      }
      await saveAccountStoreNow();
      addLog({
        agent: "main",
        level: "warn",
        message: `${label} 계정과 종속 카테고리를 삭제했습니다.`,
        at: new Date().toISOString()
      });
    });
    list.appendChild(row);
  }
  renderCategories();
  updateSessionNotice();
}

function renderCategories() {
  const account = selectedAccount();
  const list = $("#categoryList");
  const manager = $("#categoryManager");
  manager.classList.toggle("collapsed", !state.categoryManagerOpen);
  list.innerHTML = "";
  if (!account) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "카테고리를 등록할 계정을 먼저 선택하세요.";
    list.appendChild(empty);
    return;
  }
  if (!account.categories || !account.categories.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "등록된 카테고리가 없습니다.";
    list.appendChild(empty);
    return;
  }

  for (const category of account.categories) {
    const row = document.createElement("div");
    row.className = `category-row${state.editingCategoryId === category.id ? " selected" : ""}`;
    row.innerHTML = `
      <input class="list-check" type="checkbox" ${category.checked !== false ? "checked" : ""} aria-label="자동 발행 카테고리 선택" />
      <div class="category-main">
        <strong>${escapeHtml(category.name)}</strong>
        <span>블로그 발행 카테고리</span>
      </div>
      <div class="category-actions">
        <button type="button" class="ghost small" data-action="edit">수정</button>
        <button type="button" class="ghost small" data-action="delete">삭제</button>
      </div>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      category.checked = event.target.checked;
      saveAccountStoreNow();
    });
    row.querySelector("[data-action='edit']").addEventListener("click", () => {
      editCategory(category);
    });
    row.querySelector("[data-action='delete']").addEventListener("click", () => {
      account.categories = account.categories.filter((item) => item.id !== category.id);
      if (state.editingCategoryId === category.id) {
        clearCategoryForm();
      }
      saveAccountStoreNow();
      renderCategories();
    });
    list.appendChild(row);
  }
}

function selectAccount(accountId) {
  const account = state.accountStore.accounts.find((item) => item.id === accountId);
  if (!account) return;
  state.accountStore.selectedAccountId = account.id;
  fillAccountForm(account);
  clearCategoryForm();
  renderAccounts();
  syncShortContentsFromAccount(account);
  saveAccountStoreNow();
}

function fillAccountForm(account) {
  $("#accountLabel").value = account?.label || "";
  $("#naverId").value = account?.naverId || "";
  $("#blogId").value = account?.blogId || "";
  $("#naverPassword").value = account?.naverPassword || "";
  renderAccountSampleImage(account);
}

function accountImageStatusLabel(account) {
  if (!account?.sampleImagePath) return "Default image style";
  const status = account.imageStylePromptStatus || (account.imageStylePrompt ? "ready" : "missing");
  if (status === "ready") return "Custom style prompt ready";
  if (status === "stale") return "Image changed - prompt will regenerate";
  if (status === "failed") return `Prompt generation failed${account.imageStylePromptError ? `: ${account.imageStylePromptError}` : ""}`;
  return "Prompt will be generated on next run";
}

function renderAccountSampleImage(account = selectedAccount()) {
  const preview = $("#accountSampleImagePreview");
  const status = $("#accountImagePromptStatus");
  const chooseButton = $("#chooseAccountSampleImageButton");
  const deleteButton = $("#deleteAccountSampleImageButton");
  if (!preview || !status) return;
  preview.innerHTML = "";
  if (account?.sampleImageUrl) {
    const image = document.createElement("img");
    image.src = account.sampleImageUrl;
    image.alt = "Account sample image";
    preview.appendChild(image);
  } else {
    const empty = document.createElement("span");
    empty.textContent = "No sample image";
    preview.appendChild(empty);
  }
  status.textContent = accountImageStatusLabel(account);
  if (chooseButton) chooseButton.disabled = !account;
  if (deleteButton) deleteButton.disabled = !account || !account.sampleImagePath;
}

function clearAccountForm() {
  fillAccountForm(null);
}

function setCategoryButtonLabel() {
  const button = $("#addCategoryButton");
  if (button) {
    button.textContent = state.editingCategoryId ? "카테고리 수정" : "카테고리 등록";
  }
}

function fillCategoryForm(category = null) {
  $("#categoryName").value = category?.name || "";
  $("#categoryKeyword").value = "";
  $("#categoryExcludedTopics").value = "";
  $("#categoryPublishPurpose").value = "";
  $("#categoryPreferredTone").value = "";
  $("#categoryFreshnessLevel").value = "high";
  $("#categorySearchChannel").value = "blog";
  $("#categoryTrustBlogAsSource").checked = false;
}

function clearCategoryForm() {
  state.editingCategoryId = "";
  fillCategoryForm(null);
  setCategoryButtonLabel();
}

function editCategory(category) {
  if (!category) return;
  state.editingCategoryId = category.id || "";
  state.categoryManagerOpen = true;
  renderCategories();
  fillCategoryForm(category);
  setCategoryButtonLabel();
  $("#categoryName")?.focus();
}

function hasCategoryName(category) {
  return Boolean(String(category?.name || "").trim());
}

function autoTargetKey(target) {
  const accountId = String(target?.account?.id || "");
  const categoryId = String(target?.category?.id || target?.category?.name || "");
  return `${accountId}::${categoryId}`;
}

function setPendingAutoTarget(target) {
  state.autoPendingSessionTarget = {
    key: autoTargetKey(target),
    accountId: String(target?.account?.id || ""),
    categoryId: String(target?.category?.id || target?.category?.name || ""),
    accountLabel: String(target?.account?.label || target?.account?.naverId || ""),
    categoryName: String(target?.category?.name || "")
  };
}

function clearPendingAutoTarget(key = "") {
  if (!key || state.autoPendingSessionTarget?.key === key) {
    state.autoPendingSessionTarget = null;
  }
}

function findAutoTargetIndex(targets, key) {
  const index = targets.findIndex((target) => autoTargetKey(target) === key);
  return index >= 0 ? index : 0;
}

function firstAutoTargetForAccount(accountId) {
  const id = String(accountId || "");
  return getAutoTargets().find((target) => String(target?.account?.id || "") === id) || null;
}

async function saveAccountStoreNow() {
  state.accountStore = await window.blogAuto.saveAccountStore(state.accountStore);
  renderAccounts();
  syncShortContentsFromAccount(selectedAccount());
}

function normalizeAgentModels(models = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_AGENT_MODELS).map(([agent, fallback]) => {
    const value = String(models?.[agent] || fallback);
    return [agent, VALID_AGENT_MODEL_VALUES.has(value) ? value : fallback];
  }));
}

function currentAgentModels() {
  return normalizeAgentModels(Object.fromEntries(Object.entries(AGENT_MODEL_SELECTORS).map(([agent, selector]) => (
    [agent, $(selector)?.value || DEFAULT_AGENT_MODELS[agent]]
  ))));
}

function applyAgentModels(models = {}) {
  const normalized = normalizeAgentModels(models);
  for (const [agent, selector] of Object.entries(AGENT_MODEL_SELECTORS)) {
    const control = $(selector);
    if (control) control.value = normalized[agent];
  }
}

function normalizeShortContentTitleCache(titles = []) {
  return (Array.isArray(titles) ? titles : [])
    .map((item, index) => ({
      id: String(item?.id || `short_title_${index + 1}`),
      title: String(item?.title || item || "").trim(),
      source: String(item?.source || "").trim(),
      url: String(item?.url || "").trim()
    }))
    .filter((item) => item.title);
}

function normalizeArticleLengthValue(value) {
  const length = Number(value || 1500);
  return [1200, 1500, 2000].includes(length) ? length : 1500;
}

function normalizeTopicModeValue(value) {
  return String(value || "manual") === "auto" ? "auto" : "manual";
}

function normalizeRandomSelectionCount(value) {
  const count = Number(value || 5);
  return Number.isInteger(count) && count >= 1 && count <= 15 ? count : 5;
}

function promptProfileFromAccount(account = selectedAccount(), categoryName = "") {
  const defaultCategory = (account?.categories || []).find((item) => item.checked !== false && hasCategoryName(item))
    || (account?.categories || []).find((item) => hasCategoryName(item));
  const category = String(categoryName || defaultCategory?.name || account?.shortContentCategory || "").trim();
  const profile = category && account?.shortContentPromptProfiles?.[category]
    ? account.shortContentPromptProfiles[category]
    : {};
  return {
    category,
    articlePromptFilePath: String(profile?.articlePromptFilePath || ""),
    imagePromptFilePath: String(profile?.imagePromptFilePath || ""),
    articlePromptText: String(profile?.articlePromptText || ""),
    imagePromptText: String(profile?.imagePromptText || "")
  };
}

function shortContentSettingsFromAccount(account = selectedAccount(), categoryName = "") {
  const promptProfile = promptProfileFromAccount(account, categoryName);
  return {
    writingTone: String(account?.shortContentWritingTone || ""),
    articleLength: normalizeArticleLengthValue(account?.shortContentArticleLength),
    topicMode: normalizeTopicModeValue(account?.shortContentTopicMode),
    randomSelectionCount: normalizeRandomSelectionCount(account?.shortContentRandomSelectionCount),
    ...promptProfile
  };
}

function syncShortContentsFromAccount(account = selectedAccount()) {
  const activeAccount = account || null;
  const shortSettings = shortContentSettingsFromAccount(activeAccount);
  state.selectedShortContentTitles = Array.isArray(activeAccount?.shortContentSelectedTitles)
    ? activeAccount.shortContentSelectedTitles.map((title) => String(title || "").trim()).filter(Boolean)
    : [];
  state.shortContentTitles = normalizeShortContentTitleCache(activeAccount?.shortContentTitleCache || []);
  state.articlePromptFilePath = shortSettings.articlePromptFilePath;
  state.imagePromptFilePath = shortSettings.imagePromptFilePath;
  state.articlePromptText = shortSettings.articlePromptText;
  state.imagePromptText = shortSettings.imagePromptText;
  if ($("#writingTone")) $("#writingTone").value = shortSettings.writingTone;
  if ($("#articleLength")) $("#articleLength").value = String(shortSettings.articleLength);
  if ($("#topicMode")) $("#topicMode").value = shortSettings.topicMode;
  if ($("#shortContentRandomSelectionCount")) {
    $("#shortContentRandomSelectionCount").value = String(shortSettings.randomSelectionCount);
  }
  if ($("#articlePromptText")) $("#articlePromptText").value = state.articlePromptText;
  if ($("#imagePromptText")) $("#imagePromptText").value = state.imagePromptText;
  renderPromptFileLabels();
  updateModeControls();
  renderShortContentTitles(state.shortContentTitles);
  setSelectedTitleText(state.selectedShortContentTitles[0] || "아직 선정 전");
}

function persistShortContentsToAccount() {
  const account = selectedAccount();
  if (!account) return null;
  account.shortContentSelectedTitles = [...state.selectedShortContentTitles];
  account.shortContentTitleCache = normalizeShortContentTitleCache(state.shortContentTitles);
  account.shortContentWritingTone = $("#writingTone")?.value.trim() || "";
  account.shortContentArticleLength = normalizeArticleLengthValue($("#articleLength")?.value || 1500);
  account.shortContentTopicMode = normalizeTopicModeValue($("#topicMode")?.value || "manual");
  account.shortContentRandomSelectionCount = normalizeRandomSelectionCount($("#shortContentRandomSelectionCount")?.value || 5);
  const category = promptProfileFromAccount(account).category;
  state.articlePromptText = $("#articlePromptText")?.value || "";
  state.imagePromptText = $("#imagePromptText")?.value || "";
  if (category) {
    account.shortContentPromptProfiles = account.shortContentPromptProfiles || {};
    account.shortContentPromptProfiles[category] = {
      articlePromptFilePath: state.articlePromptFilePath,
      imagePromptFilePath: state.imagePromptFilePath,
      articlePromptText: state.articlePromptText,
      imagePromptText: state.imagePromptText
    };
  }
  return account;
}

function renderShortContentTitles(titles = []) {
  const container = $("#shortContentsTitleList");
  if (!container) return;
  container.hidden = false;
  if (!selectedAccount()) {
    container.innerHTML = "<span class=\"hint\">계정을 선택하면 계정별 숏텐츠 제목을 관리할 수 있습니다.</span>";
    return;
  }
  const title = "<strong>경제 뉴스 제목 15개</strong>";
  if (!titles.length) {
    container.innerHTML = `${title}<span class="hint">표시할 제목이 없습니다.</span>`;
    return;
  }
  container.innerHTML = [
    title,
    "<div class=\"shortcontents-title-items\">",
    ...titles.map((item, index) => {
      const selected = state.selectedShortContentTitles.includes(item.title) ? " selected" : "";
      const source = item.source ? `<small>${escapeHtml(item.source)}</small>` : "";
      return `<button class="shortcontents-title-item${selected}" type="button" data-title="${escapeHtml(item.title)}"><span>${index + 1}</span><span>${escapeHtml(item.title)}${source}</span></button>`;
    }),
    "</div>"
  ].join("");
}

function fileNameFromPath(filePath = "") {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function renderPromptFileLabels() {
  const articleLabel = $("#articlePromptFileName");
  const imageLabel = $("#imagePromptFileName");
  const categoryLabel = $("#promptCategoryName");
  if (categoryLabel) {
    const category = promptProfileFromAccount().category;
    categoryLabel.textContent = category ? `${category} 카테고리 설정` : "블로그 발행 카테고리를 등록하세요.";
  }
  if (articleLabel) {
    articleLabel.textContent = state.articlePromptFilePath
      ? fileNameFromPath(state.articlePromptFilePath)
      : (state.articlePromptText ? "직접 입력한 프롬프트" : "선택된 파일 없음");
    articleLabel.title = state.articlePromptFilePath || "";
  }
  if (imageLabel) {
    imageLabel.textContent = state.imagePromptFilePath
      ? fileNameFromPath(state.imagePromptFilePath)
      : (state.imagePromptText ? "직접 입력한 프롬프트" : "선택된 파일 없음");
    imageLabel.title = state.imagePromptFilePath || "";
  }
}

async function loadNewsTitles(options = {}) {
  const button = $("#loadNewsTitlesButton");
  const account = options.account || selectedAccount();
  if (!account) {
    addLog({ level: "warn", message: "뉴스 제목을 저장할 계정을 먼저 선택하세요.", at: new Date().toISOString() });
    return;
  }
  if (button) button.disabled = true;
  try {
    const result = await window.blogAuto.loadNewsTitles(account.id);
    const titles = normalizeShortContentTitleCache(result?.titles || []);
    account.shortContentTitleCache = titles;
    if (options.preserveSelected !== true) {
      account.shortContentSelectedTitles = [];
    }
    if (account.id === selectedAccount()?.id) {
      state.shortContentTitles = titles;
      state.selectedShortContentTitles = Array.isArray(account.shortContentSelectedTitles)
        ? [...account.shortContentSelectedTitles]
        : [];
      persistShortContentsToAccount();
      renderShortContentTitles(state.shortContentTitles);
      renderSelectedTitleList();
    }
    await saveAccountStoreNow();
    addLog({
      level: "info",
      message: `${account.label || account.naverId} 경제 뉴스 제목 ${titles.length}개를 다시 검색했습니다. (네이버 5개 + 다음 10개${options.reason ? ` / ${options.reason}` : ""})`,
      at: new Date().toISOString()
    });
  } catch (error) {
    addLog({ level: "error", message: `경제 뉴스 제목 로드 실패: ${error.message}`, at: new Date().toISOString() });
  } finally {
    if (button) button.disabled = false;
  }
}

function collectForm(target = {}) {
  const account = target.account || selectedAccount();
  const category = target.category
    || (account?.categories || []).find((item) => item.checked !== false && hasCategoryName(item))
    || (account?.categories || []).find((item) => item.checked !== false);
  const useSelectedAccount = Boolean(target.account || account);
  const accountShortSettings = shortContentSettingsFromAccount(account, category?.name || "");
  const usesTargetAccountSettings = Boolean(target.account);
  const publishMode = usesTargetAccountSettings
    ? accountShortSettings.topicMode
    : normalizeTopicModeValue($("#topicMode").value);
  const accountSelectedTitles = Array.isArray(account?.shortContentSelectedTitles)
    ? account.shortContentSelectedTitles.map((title) => String(title || "").trim()).filter(Boolean)
    : [];
  const selectedTitle = target.title
    ? String(target.title).trim()
    : target.account
      ? (accountSelectedTitles[0] || "")
    : (state.selectedShortContentTitles[0] || accountSelectedTitles[0] || "");
  return {
    accountId: account?.id || "",
    naverId: useSelectedAccount ? (account?.naverId || "") : $("#naverId").value.trim(),
    blogId: useSelectedAccount ? (account?.blogId || account?.naverId || "") : ($("#blogId").value.trim() || $("#naverId").value.trim()),
    naverPassword: useSelectedAccount ? (account?.naverPassword || "") : $("#naverPassword").value,
    topicMode: publishMode,
    autoRepeatEnabled: $("#autoRepeatEnabled").checked,
    repeatTermMinutes: Number($("#repeatTermMinutes").value || 60),
    topic: selectedTitle,
    category: category?.name || "",
    keyword: "",
    excludedTopics: "",
    publishPurpose: "",
    preferredTone: (usesTargetAccountSettings ? accountShortSettings.writingTone : ($("#writingTone")?.value.trim() || "")) || category?.preferredTone || "",
    writingTone: usesTargetAccountSettings ? accountShortSettings.writingTone : ($("#writingTone")?.value.trim() || ""),
    articleLength: usesTargetAccountSettings ? accountShortSettings.articleLength : normalizeArticleLengthValue($("#articleLength")?.value || 1500),
    articlePromptFilePath: usesTargetAccountSettings ? accountShortSettings.articlePromptFilePath : state.articlePromptFilePath,
    imagePromptFilePath: usesTargetAccountSettings ? accountShortSettings.imagePromptFilePath : state.imagePromptFilePath,
    articlePromptText: usesTargetAccountSettings ? accountShortSettings.articlePromptText : ($("#articlePromptText")?.value || state.articlePromptText),
    imagePromptText: usesTargetAccountSettings ? accountShortSettings.imagePromptText : ($("#imagePromptText")?.value || state.imagePromptText),
    freshnessLevel: "high",
    searchChannel: ["blog", "web"].includes(category?.searchChannel) ? category.searchChannel : "blog",
    trustBlogAsSource: category?.trustBlogAsSource === true,
    codexCmdPath: "codex",
    primarySearchProvider: "naver",
    fallbackSearchProvider: "google",
    naverSearchUrl: DEFAULT_NAVER_SEARCH_URL,
    googleSearchUrl: DEFAULT_GOOGLE_SEARCH_URL,
    naverEditorDomNotes: "",
    publishAfterGenerate: true,
    publishVisibility: $("#publishVisibility").value,
    publishPrivate: $("#publishVisibility").value !== "public",
    publishScheduleMode: $("#publishScheduleMode").value,
    reserveAfterHours: Number($("#reserveAfterHours").value || 0),
    includeTitleImage: false,
    imageAspectRatio: normalizeImageAspectRatio($("#imageAspectRatio").value),
    maxBodyImages: normalizeImageCount($("#maxBodyImages").value),
    breakSentencesInBody: $("#breakSentencesInBody").checked,
    agentModels: currentAgentModels(),
    failOnLoginRequired: target.failOnLoginRequired === true
  };
}

function applySettings(settings) {
  const map = {
    topicMode: "#topicMode",
    repeatTermMinutes: "#repeatTermMinutes",
    publishVisibility: "#publishVisibility",
    publishScheduleMode: "#publishScheduleMode",
    reserveAfterHours: "#reserveAfterHours",
    maxBodyImages: "#maxBodyImages",
    writingTone: "#writingTone",
    articleLength: "#articleLength"
  };
  for (const [key, selector] of Object.entries(map)) {
    if (settings[key] !== undefined && $(selector)) {
      $(selector).value = settings[key];
    }
  }
  $("#publishAfterGenerate").checked = true;
  $("#autoRepeatEnabled").checked = settings.autoRepeatEnabled === true;
  $("#imageAspectRatio").value = normalizeImageAspectRatio(settings.imageAspectRatio);
  $("#maxBodyImages").value = String(normalizeImageCount(settings.maxBodyImages));
  $("#breakSentencesInBody").checked = settings.breakSentencesInBody !== false;
  applyAgentModels(settings.agentModels);
  if (settings.publishPrivate === false) $("#publishVisibility").value = "public";
  updateModeControls();
}

async function saveSettingsNow() {
  $("#settingsState").textContent = "설정 저장 중";
  persistShortContentsToAccount();
  const form = collectForm();
  await window.blogAuto.saveSettings({
    naverId: form.naverId,
    blogId: form.blogId,
    naverPassword: form.naverPassword,
    topic: "",
    keyword: form.keyword,
    category: form.category,
    primarySearchProvider: form.primarySearchProvider,
    fallbackSearchProvider: form.fallbackSearchProvider,
    naverSearchUrl: form.naverSearchUrl,
    googleSearchUrl: form.googleSearchUrl,
    naverEditorDomNotes: form.naverEditorDomNotes,
    publishAfterGenerate: form.publishAfterGenerate,
    publishPrivate: form.publishPrivate,
    topicMode: form.topicMode,
    autoRepeatEnabled: form.autoRepeatEnabled,
    repeatTermMinutes: form.repeatTermMinutes,
    publishVisibility: form.publishVisibility,
    publishScheduleMode: form.publishScheduleMode,
    reserveAfterHours: form.reserveAfterHours,
    includeTitleImage: false,
    imageAspectRatio: form.imageAspectRatio,
    maxBodyImages: form.maxBodyImages,
    breakSentencesInBody: form.breakSentencesInBody,
    writingTone: form.writingTone,
    articleLength: form.articleLength,
    articlePromptFilePath: form.articlePromptFilePath,
    imagePromptFilePath: form.imagePromptFilePath,
    agentModels: form.agentModels
  });
  await saveAccountStoreNow();
  $("#settingsState").textContent = "설정 저장됨";
}

function scheduleSettingsSave() {
  window.clearTimeout(state.saveTimer);
  $("#settingsState").textContent = "변경 감지";
  state.saveTimer = window.setTimeout(() => {
    saveSettingsNow().catch((error) => {
      $("#settingsState").textContent = "설정 저장 실패";
      addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    });
  }, 450);
}

function updateModeControls() {
  const isAuto = $("#topicMode").value === "auto";
  const repeatEnabled = $("#autoRepeatEnabled").checked;
  const isPrivatePublish = $("#publishVisibility").value !== "public";
  $("#repeatTermLabel").style.display = isAuto ? "grid" : "none";
  $("#repeatTermMinutes").disabled = !repeatEnabled;
  $("#publishOptionsRow").style.display = isAuto ? "flex" : "none";
  $("#manualTopicLabel").style.display = "none";
  $("#publishAfterGenerate").checked = true;
  $("#publishAfterGenerate").disabled = true;
  if (isAuto) {
    $("#publishVisibility").value = "public";
    $("#publishScheduleMode").value = "now";
  }
  if (isPrivatePublish && $("#publishScheduleMode").value === "reserve") {
    $("#publishScheduleMode").value = "now";
  }
  $("#publishScheduleMode").disabled = isPrivatePublish;
  $("#reserveAfterLabel").style.display = !isPrivatePublish && $("#publishScheduleMode").value === "reserve" ? "grid" : "none";
}

function getAutoTargets() {
  const targets = [];
  for (const account of state.accountStore.accounts.filter((item) => item.checked !== false)) {
    for (const category of (account.categories || []).filter((item) => item.checked !== false && hasCategoryName(item))) {
      targets.push({ account, category });
    }
  }
  return targets;
}

function shuffledTitles(titles = []) {
  const items = (Array.isArray(titles) ? titles : [])
    .map((item) => String(item?.title || item || "").trim())
    .filter(Boolean);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function refillAutoTitleQueue(account, options = {}) {
  if (!account) return [];
  const count = normalizeRandomSelectionCount(account.shortContentRandomSelectionCount);
  const result = await window.blogAuto.loadNewsTitles(account.id);
  const titles = normalizeShortContentTitleCache(result?.titles || []);
  const selected = shuffledTitles(titles).slice(0, Math.min(count, titles.length));
  account.shortContentTitleCache = titles;
  account.shortContentSelectedTitles = selected;

  if (account.id === selectedAccount()?.id) {
    state.shortContentTitles = titles;
    state.selectedShortContentTitles = [...selected];
    renderShortContentTitles(titles);
    setSelectedTitleText(selected[0] || "아직 선정 전");
  }
  await saveAccountStoreNow();
  addLog({
    level: "info",
    message: `${account.label || account.naverId} 계정에서 경제 뉴스 제목 ${titles.length}개 중 ${selected.length}개를 랜덤 선택했습니다.`,
    at: new Date().toISOString()
  });
  return selected;
}

function latestCompletedArticleForAccount(account) {
  const blogId = String(account?.blogId || account?.naverId || "").trim();
  if (!blogId) return null;
  return (Array.isArray(state.history) ? state.history : [])
    .filter((entry) => (
      String(entry?.blog_id || "").trim() === blogId
      && ["success", "generated"].includes(String(entry?.status || "").toLowerCase())
      && String(entry?.title || "").trim()
      && Number.isFinite(Date.parse(entry?.create_at || ""))
    ))
    .sort((a, b) => Date.parse(b.create_at) - Date.parse(a.create_at))[0] || null;
}

async function resetStaleShortContentQueue(account) {
  if (!account || !Array.isArray(account.shortContentSelectedTitles) || !account.shortContentSelectedTitles.length) {
    return false;
  }
  const latestArticle = latestCompletedArticleForAccount(account);
  if (!latestArticle) return false;
  const latestCreatedAt = String(latestArticle.create_at || "");
  if (Date.now() - Date.parse(latestCreatedAt) < SHORT_CONTENT_RESET_GAP_MS) return false;
  if (state.staleTitleResetHistory[account.id] === latestCreatedAt) return false;

  state.staleTitleResetHistory[account.id] = latestCreatedAt;
  account.shortContentSelectedTitles = [];
  if (account.id === selectedAccount()?.id) {
    state.selectedShortContentTitles = [];
    renderShortContentTitles(state.shortContentTitles);
    renderSelectedTitleList();
  }
  await saveAccountStoreNow();
  addLog({
    level: "info",
    message: `${account.label || account.naverId}의 마지막 생성 글 이후 8시간 이상 지나 선택된 숏텐츠 제목 목록을 초기화하고 새 제목을 불러옵니다.`,
    at: new Date().toISOString()
  });
  await refillAutoTitleQueue(account);
  return true;
}

function consumeAutoTitle(account, title) {
  const target = String(title || "").trim();
  account.shortContentSelectedTitles = (Array.isArray(account.shortContentSelectedTitles)
    ? account.shortContentSelectedTitles
    : []).filter((item, index) => index > 0 || String(item || "").trim() !== target);
  if (account.id === selectedAccount()?.id) {
    state.selectedShortContentTitles = [...account.shortContentSelectedTitles];
    renderShortContentTitles(state.shortContentTitles);
    setSelectedTitleText(state.selectedShortContentTitles[0] || "아직 선정 전");
  }
}

function nextDifferentAccountIndex(targets, index) {
  if (!targets.length) return 0;
  const currentAccountId = targets[index % targets.length]?.account?.id || "";
  for (let offset = 1; offset <= targets.length; offset += 1) {
    const nextIndex = (index + offset) % targets.length;
    if ((targets[nextIndex]?.account?.id || "") !== currentAccountId) {
      return nextIndex;
    }
  }
  return index;
}

function delayAuto(minutes) {
  const ms = Math.max(1, Number(minutes || 1)) * 60 * 1000;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (state.autoDelayWake === finish) state.autoDelayWake = null;
      resolve();
    };
    const started = Date.now();
    state.autoDelayWake = finish;
    const tick = () => {
      if (!state.autoRunning) {
        finish();
        return;
      }
      const remaining = Math.max(0, ms - (Date.now() - started));
      setRunState("generated", `다음 발행까지 ${Math.ceil(remaining / 1000)}초`);
      if (remaining <= 0) finish();
      else window.setTimeout(tick, Math.min(1000, remaining));
    };
    tick();
  });
}

function logNextArticleWait(minutes, detail = "") {
  const waitMinutes = Math.max(1, Number(minutes || 1));
  addLog({
    level: "info",
    message: `[다음 글 대기 중] ${waitMinutes}분 후 다음 글 작성을 시작합니다.${detail ? ` (${detail})` : ""}`,
    at: new Date().toISOString()
  });
}

function waitForAccountSessionOrTerm(accountId, minutes) {
  const waitingAccountId = String(accountId || "");
  const ms = Math.max(1, Number(minutes || 1)) * 60 * 1000;
  return new Promise((resolve) => {
    if (state.autoResumeAccountId === waitingAccountId) {
      state.autoResumeAccountId = "";
      resolve("session");
      return;
    }
    let settled = false;
    const started = Date.now();
    const wake = () => {
      if (state.autoResumeAccountId === waitingAccountId) {
        finish("session");
      }
    };
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      if (state.autoDelayWake === wake) state.autoDelayWake = null;
      if (reason === "session") state.autoResumeAccountId = "";
      resolve(reason);
    };
    state.autoDelayWake = wake;
    const tick = () => {
      if (!state.autoRunning) {
        finish("stopped");
        return;
      }
      if (state.autoResumeAccountId === waitingAccountId) {
        finish("session");
        return;
      }
      const remaining = Math.max(0, ms - (Date.now() - started));
      setRunState("session_expired", `세션 확인 대기 중 ${Math.ceil(remaining / 1000)}초`);
      if (remaining <= 0) {
        finish("term");
        return;
      }
      window.setTimeout(tick, Math.min(1000, remaining));
    };
    tick();
  });
}

async function startAutoPublishing(startTargetKey = "") {
  const checkedTargets = state.accountStore.accounts
    .filter((account) => account.checked !== false)
    .flatMap((account) => (account.categories || [])
      .filter((category) => category.checked !== false)
      .map((category) => ({ account, category })));
  if (!checkedTargets.length) {
    throw new Error("자동 발행할 체크된 계정/카테고리 조합이 없습니다.");
  }
  const checkedTargetsWithCategory = checkedTargets.filter((target) => hasCategoryName(target.category));
  if (!checkedTargetsWithCategory.length) {
    throw new Error("자동 발행하려면 체크된 카테고리의 블로그 카테고리명을 먼저 등록하세요.");
  }
  const checkedAccounts = [...new Map(
    checkedTargetsWithCategory.map((target) => [target.account.id, target.account])
  ).values()];
  for (const account of checkedAccounts) {
    await resetStaleShortContentQueue(account);
  }
  const checkedTargetsWithShortTitles = checkedTargetsWithCategory.filter((target) => (
    Array.isArray(target.account?.shortContentSelectedTitles)
      && target.account.shortContentSelectedTitles.some((title) => String(title || "").trim())
  ));
  const repeatEnabled = $("#autoRepeatEnabled").checked;
  if (!repeatEnabled && !checkedTargetsWithShortTitles.length) {
    throw new Error("자동 발행하려면 계정별 숏텐츠 제목을 먼저 선택하세요.");
  }
  state.running = true;
  state.autoRunning = true;
  state.autoPausedForSession = false;
  $("#startButton").disabled = true;
  $("#stopAutoButton").disabled = false;
  await saveSettingsNow();
  setTokenTotal(0);

  const oneShotTargetKeys = new Set(
    getAutoTargets()
      .filter((target) => Array.isArray(target.account.shortContentSelectedTitles) && target.account.shortContentSelectedTitles.length)
      .map(autoTargetKey)
  );
  addLog({
    level: "info",
    message: repeatEnabled
      ? `반복 자동 발행을 시작합니다. 작업 사이 대기 시간은 ${Number($("#repeatTermMinutes").value || 60)}분입니다.`
      : `1회성 자동 발행을 시작합니다. 대상 ${oneShotTargetKeys.size}개를 한 번씩 처리합니다.`,
    at: new Date().toISOString()
  });
  let index = startTargetKey ? findAutoTargetIndex(getAutoTargets(), startTargetKey) : 0;
  autoLoop:
  while (state.autoRunning) {
    const targets = getAutoTargets()
      .filter((target) => repeatEnabled || oneShotTargetKeys.has(autoTargetKey(target)));
    if (!targets.length) {
      if (!repeatEnabled) {
        addLog({
          level: "info",
          message: "1회성 자동 발행 대상 처리를 완료했습니다.",
          at: new Date().toISOString()
        });
        break;
      }
      addLog({
        level: "warn",
        message: "체크된 계정 중 자동 발행 가능한 대상이 없습니다.",
        at: new Date().toISOString()
      });
      const waitMinutes = Number($("#repeatTermMinutes").value || 60);
      logNextArticleWait(waitMinutes, "발행 가능한 계정/카테고리 재확인");
      await delayAuto(waitMinutes);
      continue;
    }
    index %= targets.length;
    const target = targets[index];
    await resetStaleShortContentQueue(target.account);
    if (!Array.isArray(target.account.shortContentSelectedTitles) || !target.account.shortContentSelectedTitles.length) {
      if (repeatEnabled) {
        await refillAutoTitleQueue(target.account);
        if (!target.account.shortContentSelectedTitles.length) {
          addLog({
            level: "warn",
            message: `${target.account.label || target.account.naverId} 계정에서 선택할 숏텐츠 제목을 찾지 못해 다음 주기에 다시 시도합니다.`,
            at: new Date().toISOString()
          });
          index += 1;
          const waitMinutes = Number($("#repeatTermMinutes").value || 60);
          logNextArticleWait(waitMinutes, "숏텐츠 제목 재추출");
          await delayAuto(waitMinutes);
          continue;
        }
      } else {
        oneShotTargetKeys.delete(autoTargetKey(target));
        index = 0;
        continue;
      }
    }
    if (target.account.sessionStatus === "expired") {
      if (!repeatEnabled) {
        addLog({
          level: "warn",
          message: `${target.account.label || target.account.naverId} 계정은 세션만료 상태라 이번 1회성 작업에서 건너뜁니다.`,
          at: new Date().toISOString()
        });
        oneShotTargetKeys.delete(autoTargetKey(target));
        index = 0;
        continue;
      }
      setPendingAutoTarget(target);
      addLog({
        level: "warn",
        message: `${target.account.label || target.account.naverId} 계정은 세션만료 상태입니다. ${target.category.name} 작업은 세션확인 또는 반복주기까지 대기합니다.`,
        at: new Date().toISOString()
      });
      state.autoPausedForSession = true;
      state.autoWaitingSessionAccountId = target.account.id || "";
      const waitResult = await waitForAccountSessionOrTerm(target.account.id, Number($("#repeatTermMinutes").value || 60));
      state.autoPausedForSession = false;
      state.autoWaitingSessionAccountId = "";
      if (waitResult === "session") {
        clearPendingAutoTarget(autoTargetKey(target));
        addLog({
          level: "info",
          message: `${target.account.label || target.account.naverId} 계정 세션확인이 완료되어 ${target.category.name} 작업을 즉시 재시도합니다.`,
          at: new Date().toISOString()
        });
        continue;
      }
      if (waitResult === "term") {
        clearPendingAutoTarget(autoTargetKey(target));
        index = nextDifferentAccountIndex(targets, index);
        continue;
      }
      break;
    }
    clearPendingAutoTarget(autoTargetKey(target));
    const currentTitle = String(target.account.shortContentSelectedTitles[0] || "").trim();
    let autoAttemptLimit = AUTO_TARGET_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= autoAttemptLimit && state.autoRunning; attempt += 1) {
      addLog({
        level: "info",
        message: `자동 Cycle 시작 (${attempt}/${autoAttemptLimit}): ${target.account.label || target.account.naverId} / ${target.category.name}`,
        at: new Date().toISOString()
      });
      setSelectedTitleText("아직 선정 전");
      $("#articlePreview").value = "";
      renderImages([]);
      renderImageNotes([]);
      const result = await runAutoStartJob(collectForm({
        account: target.account,
        category: target.category,
        title: currentTitle,
        failOnLoginRequired: true
      }));
      if (result?.status === "codex_usage_limit") {
        addLog({
          level: "error",
          message: "Codex 사용량 한도 초과로 자동 작업을 중지합니다.",
          at: new Date().toISOString()
        });
        state.autoRunning = false;
        break autoLoop;
      }
      if (result?.status === "session_expired") {
        target.account.sessionStatus = "expired";
        setPendingAutoTarget(target);
        renderAccounts();
        if (!repeatEnabled) {
          addLog({
            level: "warn",
            message: `${target.account.label || target.account.naverId} 계정 세션이 만료되어 이번 1회성 작업에서 건너뜁니다.`,
            at: new Date().toISOString()
          });
          clearPendingAutoTarget(autoTargetKey(target));
          oneShotTargetKeys.delete(autoTargetKey(target));
          index = 0;
          continue autoLoop;
        }
        addLog({
          level: "warn",
          message: `${target.account.label || target.account.naverId} 계정은 세션만료 상태입니다. ${target.category.name} 작업은 세션확인 또는 반복주기까지 대기합니다.`,
          at: new Date().toISOString()
        });
        state.autoPausedForSession = true;
        state.autoWaitingSessionAccountId = target.account.id || "";
        const waitResult = await waitForAccountSessionOrTerm(target.account.id, Number($("#repeatTermMinutes").value || 60));
        state.autoPausedForSession = false;
        state.autoWaitingSessionAccountId = "";
        if (waitResult === "session") {
          clearPendingAutoTarget(autoTargetKey(target));
          addLog({
            level: "info",
            message: `${target.account.label || target.account.naverId} 계정 세션확인이 완료되어 ${target.category.name} 작업을 즉시 재시도합니다.`,
            at: new Date().toISOString()
          });
          continue autoLoop;
        }
        if (waitResult === "term") {
          clearPendingAutoTarget(autoTargetKey(target));
          index = nextDifferentAccountIndex(targets, index);
          continue autoLoop;
        }
        break autoLoop;
      }
      if (!shouldRetryAutoResult(result)) {
        break;
      }
      autoAttemptLimit = Math.min(autoAttemptLimit, autoAttemptLimitForResult(result));
      if (attempt < autoAttemptLimit) {
        addLog({
          level: "warn",
          message: `자동 Cycle 실패, 같은 대상으로 재시도합니다 (${attempt + 1}/${autoAttemptLimit}): ${autoResultReason(result)}`,
          at: new Date().toISOString()
        });
        continue;
      }
      addLog({
        level: "warn",
        message: `자동 Cycle ${autoAttemptLimit}회 실패로 다음 대상으로 이동합니다: ${autoResultReason(result)}`,
        at: new Date().toISOString()
      });
    }
    consumeAutoTitle(target.account, currentTitle);
    await saveAccountStoreNow();
    addLog({
      level: "info",
      message: `${target.account.label || target.account.naverId} 제목 처리 완료: ${currentTitle} / 남은 제목 ${target.account.shortContentSelectedTitles.length}개`,
      at: new Date().toISOString()
    });
    if (repeatEnabled && target.account.shortContentSelectedTitles.length === 0) {
      addLog({
        level: "info",
        message: `${target.account.label || target.account.naverId} 선택 제목 목록을 모두 작성해 경제 뉴스를 다시 검색합니다.`,
        at: new Date().toISOString()
      });
      await refillAutoTitleQueue(target.account);
    }
    if (!repeatEnabled) {
      oneShotTargetKeys.delete(autoTargetKey(target));
      index = 0;
    } else {
      index += 1;
    }
    if (state.autoRunning && repeatEnabled) {
      const waitMinutes = Number($("#repeatTermMinutes").value || 60);
      logNextArticleWait(waitMinutes);
      await delayAuto(waitMinutes);
    }
  }

  state.autoRunning = false;
  state.autoPausedForSession = false;
  state.autoWaitingSessionAccountId = "";
  state.autoResumeAccountId = "";
  state.autoPendingSessionTarget = null;
  state.running = false;
  $("#startButton").disabled = false;
  $("#stopAutoButton").disabled = true;
  setRunState("generated", repeatEnabled ? "자동 중지" : "1회 발행 완료");
}

async function startManualJob() {
  persistShortContentsToAccount();
  const form = collectForm();
  if (!form.category) throw new Error("선택 계정에서 카테고리를 체크하세요.");
  if (!form.topic) throw new Error("글을 작성할 숏텐츠 제목을 먼저 선택하세요.");
  if (form.publishAfterGenerate && !form.naverId) throw new Error("발행까지 진행하려면 작업할 계정을 선택하거나 등록하세요.");
  state.running = true;
  $("#startButton").disabled = true;
  await saveSettingsNow();
  setTokenTotal(0);
  $("#articlePreview").value = "";
  setSelectedTitleText("아직 선정 전");
  renderImages([]);
  renderImageNotes([]);
  setRunState("generating", "생성 준비");
  try {
    await window.blogAuto.startJob(form);
  } finally {
    if (!state.autoRunning) {
      state.running = false;
      $("#startButton").disabled = false;
    }
  }
}

async function boot() {
  const initial = await window.blogAuto.getInitialData();
  $("#runtimePath").textContent = initial.runtimeRoot;
  state.chrome = initial.chrome || state.chrome;
  state.accountStore = initial.accountStore || state.accountStore;
  state.history = Array.isArray(initial.history) ? initial.history : [];
  applySettings(initial.settings || {});
  setCodexRateLimits(initial.settings?.codexRateLimits || null);
  refreshCodexUsageOnStartup();
  showStartupNoticeIfNeeded();
  renderAccounts();
  const account = selectedAccount();
  if (account) {
    selectAccount(account.id);
    await loadNewsTitles({
      account,
      preserveSelected: true,
      reason: "앱 새 세션 시작"
    });
  }
  renderHistory(state.history);

  window.blogAuto.onAccountsUpdate((store) => {
    state.accountStore = store;
    renderAccounts();
    fillAccountForm(selectedAccount());
    syncShortContentsFromAccount(selectedAccount());
  });
  window.blogAuto.onLog(addLog);
  window.blogAuto.onStatus((payload) => {
    state.currentJobId = payload.jobId;
    setRunState(payload.status, payload.detail || payload.status);
  });
  window.blogAuto.onTokens((payload) => {
    setTokenTotal(payload.total || 0);
    if (payload.rateLimits) setCodexRateLimits(payload.rateLimits);
  });
  window.blogAuto.onPreview((payload) => {
    $("#articlePreview").value = payload.article || "";
    $("#articleMeta").textContent = payload.title || "본문 생성 완료";
    if (payload.title) setSelectedTitleText(payload.title);
    if (payload.tokenUsage) setTokenTotal(payload.tokenUsage.total || 0);
    if (payload.tokenUsage?.rateLimits) setCodexRateLimits(payload.tokenUsage.rateLimits);
    renderImages(payload.images || []);
    renderImageNotes(payload.imageNotes || []);
  });
  window.blogAuto.onSelectedTitle((payload) => {
    if (payload.title) setSelectedTitleText(payload.title);
    $("#articleMeta").textContent = payload.verdict || payload.status || "제목 선정 완료";
  });
  window.blogAuto.onComplete((payload) => {
    if (!state.autoRunning) {
      state.running = false;
      $("#startButton").disabled = false;
    }
    setRunState(payload.status, payload.status);
    $("#articlePreview").value = payload.article || $("#articlePreview").value;
    $("#articleMeta").textContent = payload.title || payload.status || "완료";
    if (payload.title) setSelectedTitleText(payload.title);
    if (payload.tokenUsage) setTokenTotal(payload.tokenUsage.total || 0);
    if (payload.tokenUsage?.rateLimits) setCodexRateLimits(payload.tokenUsage.rateLimits);
    renderImages(payload.images || []);
    renderImageNotes(payload.imageNotes || []);
    state.history = Array.isArray(payload.history) ? payload.history : state.history;
    renderHistory(state.history);
  });

  $("#jobForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.running) return;
    try {
      if ($("#topicMode").value === "auto") {
        await startAutoPublishing();
      } else {
        await startManualJob();
      }
    } catch (error) {
      state.running = false;
      state.autoRunning = false;
      state.autoPausedForSession = false;
      state.autoWaitingSessionAccountId = "";
      state.autoResumeAccountId = "";
      state.autoPendingSessionTarget = null;
      $("#startButton").disabled = false;
      $("#stopAutoButton").disabled = true;
      setRunState("failed", "실패");
      addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    }
  });

  $("#loadNewsTitlesButton")?.addEventListener("click", () => {
    loadNewsTitles().catch((error) => {
      addLog({ level: "error", message: `경제 뉴스 제목 로드 실패: ${error.message}`, at: new Date().toISOString() });
    });
  });
  $("#shortContentsTitleList")?.addEventListener("click", (event) => {
    const button = event.target.closest(".shortcontents-title-item");
    if (!button) return;
    const title = String(button.dataset.title || "").trim();
    if (!title) return;
    if (state.selectedShortContentTitles.includes(title)) {
      state.selectedShortContentTitles = state.selectedShortContentTitles.filter((item) => item !== title);
    } else {
      state.selectedShortContentTitles.push(title);
    }
    persistShortContentsToAccount();
    renderShortContentTitles(state.shortContentTitles);
    setSelectedTitleText(state.selectedShortContentTitles[0] || "아직 선정 전");
    saveAccountStoreNow().catch((error) => {
      addLog({ level: "error", message: `숏텐츠 선택 저장 실패: ${error.message}`, at: new Date().toISOString() });
    });
  });
  $("#chooseArticlePromptFileButton")?.addEventListener("click", async () => {
    const filePath = await window.blogAuto.choosePromptFile("글 작성 프롬프트 파일 선택");
    if (!filePath) return;
    state.articlePromptFilePath = filePath;
    state.articlePromptText = await window.blogAuto.readPromptFile(filePath);
    $("#articlePromptText").value = state.articlePromptText;
    renderPromptFileLabels();
    scheduleSettingsSave();
  });
  $("#clearArticlePromptFileButton")?.addEventListener("click", () => {
    state.articlePromptFilePath = "";
    state.articlePromptText = "";
    $("#articlePromptText").value = "";
    renderPromptFileLabels();
    scheduleSettingsSave();
  });
  $("#chooseImagePromptFileButton")?.addEventListener("click", async () => {
    const filePath = await window.blogAuto.choosePromptFile("이미지 프롬프트 파일 선택");
    if (!filePath) return;
    state.imagePromptFilePath = filePath;
    state.imagePromptText = await window.blogAuto.readPromptFile(filePath);
    $("#imagePromptText").value = state.imagePromptText;
    renderPromptFileLabels();
    scheduleSettingsSave();
  });
  $("#clearImagePromptFileButton")?.addEventListener("click", () => {
    state.imagePromptFilePath = "";
    state.imagePromptText = "";
    $("#imagePromptText").value = "";
    renderPromptFileLabels();
    scheduleSettingsSave();
  });
  $("#articlePromptText")?.addEventListener("input", () => {
    state.articlePromptText = $("#articlePromptText").value;
    scheduleSettingsSave();
  });
  $("#imagePromptText")?.addEventListener("input", () => {
    state.imagePromptText = $("#imagePromptText").value;
    scheduleSettingsSave();
  });

  $("#addAccountButton").addEventListener("click", async () => {
    const naverId = $("#naverId").value.trim();
    if (!naverId) {
      addLog({ level: "error", message: "Naver ID를 입력하세요.", at: new Date().toISOString() });
      return;
    }
    const duplicate = state.accountStore.accounts.find((account) => account.naverId === naverId);
    if (duplicate) {
      addLog({ level: "error", message: "이미 등록된 Naver ID입니다. 기존 계정을 선택한 뒤 수정하세요.", at: new Date().toISOString() });
      return;
    }
    const account = {
      id: makeId("acct"),
      label: $("#accountLabel").value.trim() || naverId,
      naverId,
      blogId: $("#blogId").value.trim(),
      naverPassword: $("#naverPassword").value,
      sampleImagePath: "",
      sampleImageHash: "",
      sampleImageUpdatedAt: "",
      imageStylePrompt: "",
      imageStylePromptUpdatedAt: "",
      imageStylePromptStatus: "missing",
      imageStylePromptSourceImageHash: "",
      imageStylePromptError: "",
      checked: true,
      sessionStatus: "unknown",
      sessionCheckedAt: "",
      categories: [],
      shortContentCategory: "",
      shortContentSelectedTitles: [],
      shortContentTitleCache: [],
      shortContentWritingTone: "",
      shortContentArticleLength: 1500,
      shortContentTopicMode: "manual",
      shortContentRandomSelectionCount: 5,
      shortContentArticlePromptFilePath: "",
      shortContentImagePromptFilePath: ""
    };
    state.accountStore.accounts.push(account);
    state.accountStore.selectedAccountId = account.id;
    await saveAccountStoreNow();
  });

  $("#updateAccountButton").addEventListener("click", async () => {
    const account = selectedAccount();
    if (!account) {
      addLog({ level: "error", message: "수정할 계정을 먼저 선택하세요.", at: new Date().toISOString() });
      return;
    }
    const naverId = $("#naverId").value.trim();
    if (!naverId) {
      addLog({ level: "error", message: "Naver ID를 입력하세요.", at: new Date().toISOString() });
      return;
    }
    const duplicate = state.accountStore.accounts.find((item) => item.id !== account.id && item.naverId === naverId);
    if (duplicate) {
      addLog({ level: "error", message: "다른 계정에 이미 등록된 Naver ID입니다.", at: new Date().toISOString() });
      return;
    }
    account.label = $("#accountLabel").value.trim() || naverId;
    account.naverId = naverId;
    account.blogId = $("#blogId").value.trim();
    account.naverPassword = $("#naverPassword").value;
    await saveAccountStoreNow();
  });

  $("#clearAccountFormButton").addEventListener("click", () => {
    clearAccountForm();
    addLog({ level: "info", message: "신규 계정 입력을 시작합니다.", at: new Date().toISOString() });
  });

  $("#chooseAccountSampleImageButton").addEventListener("click", async () => {
    const account = selectedAccount();
    if (!account) {
      addLog({ level: "error", message: "Select an account before adding a sample image.", at: new Date().toISOString() });
      return;
    }
    state.accountStore = await window.blogAuto.chooseAccountSampleImage(account.id);
    renderAccounts();
    fillAccountForm(selectedAccount());
    scheduleSettingsSave();
  });

  $("#deleteAccountSampleImageButton").addEventListener("click", async () => {
    const account = selectedAccount();
    if (!account || !account.sampleImagePath) return;
    if (!window.confirm("Delete the sample image and custom image prompt?")) return;
    state.accountStore = await window.blogAuto.deleteAccountSampleImage(account.id);
    renderAccounts();
    fillAccountForm(selectedAccount());
    scheduleSettingsSave();
  });

  $("#toggleAccountManagerButton").addEventListener("click", () => {
    state.accountManagerOpen = !state.accountManagerOpen;
    if (state.accountManagerOpen) {
      fillAccountForm(selectedAccount());
    }
    renderAccounts();
  });

  const legacyCheckSessionButton = $("#checkSessionButton");
  if (legacyCheckSessionButton) {
    legacyCheckSessionButton.addEventListener("click", () => checkAccountSession(selectedAccount()));
  }
  $("#bulkSessionCheckButton").addEventListener("click", checkSelectedAccountSessions);

  $("#toggleCategoryManagerButton").addEventListener("click", () => {
    clearCategoryForm();
    state.categoryManagerOpen = !state.categoryManagerOpen;
    renderCategories();
  });
  $("#addCategoryButton").addEventListener("click", async () => {
    const account = selectedAccount();
    const name = $("#categoryName").value.trim();
    const keyword = "";
    const excludedTopics = "";
    const publishPurpose = "";
    const preferredTone = "";
    const freshnessLevel = "high";
    const searchChannel = "blog";
    const trustBlogAsSource = false;
    if (!account) return;
    if (!name) {
      addLog({
        level: "warn",
        message: "카테고리를 등록하려면 블로그 카테고리명을 입력하세요.",
        at: new Date().toISOString()
      });
      setRunState("failed", "카테고리명 필요");
      return;
    }
    account.categories = account.categories || [];
    const editingId = state.editingCategoryId;
    const existing = editingId
      ? account.categories.find((category) => category.id === editingId)
      : null;
    if (editingId && existing) {
      existing.keyword = keyword;
      existing.name = name;
      existing.excludedTopics = excludedTopics;
      existing.publishPurpose = publishPurpose;
      existing.preferredTone = preferredTone;
      existing.freshnessLevel = freshnessLevel;
      existing.searchChannel = searchChannel;
      existing.trustBlogAsSource = trustBlogAsSource;
      existing.checked = true;
    } else if (account.categories.some((category) => category.name === name)) {
      addLog({
        level: "warn",
        message: "같은 이름의 카테고리가 이미 있습니다. 기존 카테고리를 수정하려면 목록의 수정 버튼을 눌러 주세요.",
        at: new Date().toISOString()
      });
      setRunState("failed", "중복 카테고리명");
      return;
    } else {
      account.categories.push({
        id: makeId("cat"),
        name,
        keyword,
        excludedTopics,
        publishPurpose,
        preferredTone,
        freshnessLevel,
        searchChannel,
        trustBlogAsSource,
        checked: true
      });
    }
    clearCategoryForm();
    await saveAccountStoreNow();
  });

  $("#stopAutoButton").addEventListener("click", () => {
    state.autoRunning = false;
    state.autoPausedForSession = false;
    state.autoWaitingSessionAccountId = "";
    state.autoResumeAccountId = "";
    state.autoPendingSessionTarget = null;
    $("#stopAutoButton").disabled = true;
    setRunState("generated", "자동 중지 요청");
  });
  $("#reloadHistoryButton").addEventListener("click", async () => {
    renderHistory(await window.blogAuto.loadHistory());
  });
  $("#clearLogButton").addEventListener("click", () => {
    clearAgentLogs();
  });
  $("#openRuntimeButton").addEventListener("click", () => {
    window.blogAuto.openRuntimeFolder();
  });
  $("#dismissSessionNoticeButton").addEventListener("click", () => {
    $("#sessionNotice").hidden = true;
  });
  $("#dismissStartupNoticeButton").addEventListener("click", dismissStartupNotice);
  $("#saveSettingsButton").addEventListener("click", () => {
    saveSettingsNow().catch((error) => {
      $("#settingsState").textContent = "설정 저장 실패";
      addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    });
  });
  for (const selector of Object.values(AGENT_MODEL_SELECTORS)) {
    const control = $(selector);
    if (!control) continue;
    control.addEventListener("change", () => {
      saveSettingsNow().catch((error) => {
        $("#settingsState").textContent = "설정 저장 실패";
        addLog({ level: "error", message: error.message, at: new Date().toISOString() });
      });
    });
  }
  $("#imageAspectRatio").addEventListener("change", () => {
    saveSettingsNow().catch((error) => {
      $("#settingsState").textContent = "설정 저장 실패";
      addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    });
  });
  $("#topicMode").addEventListener("change", updateModeControls);
  $("#autoRepeatEnabled").addEventListener("change", () => {
    updateModeControls();
    saveSettingsNow().catch((error) => {
      $("#settingsState").textContent = "설정 저장 실패";
      addLog({ level: "error", message: error.message, at: new Date().toISOString() });
    });
  });
  $("#writingTone")?.addEventListener("input", scheduleSettingsSave);
  $("#articleLength")?.addEventListener("change", scheduleSettingsSave);
  $("#shortContentRandomSelectionCount")?.addEventListener("change", () => {
    const count = normalizeRandomSelectionCount($("#shortContentRandomSelectionCount").value);
    $("#shortContentRandomSelectionCount").value = String(count);
    persistShortContentsToAccount();
    saveAccountStoreNow().catch((error) => {
      addLog({ level: "error", message: `랜덤 선택 수량 저장 실패: ${error.message}`, at: new Date().toISOString() });
    });
  });
  $("#publishVisibility").addEventListener("change", updateModeControls);
  $("#publishScheduleMode").addEventListener("change", updateModeControls);
  $("#jobForm").querySelectorAll("input, select, textarea").forEach((control) => {
    if ([
      "accountLabel",
      "naverId",
      "blogId",
      "naverPassword",
      "categoryName",
      "categoryKeyword",
      "categoryExcludedTopics",
      "categoryPublishPurpose",
      "categoryPreferredTone",
      "categoryFreshnessLevel",
      "categorySearchChannel",
      "categoryTrustBlogAsSource"
    ].includes(control.id)) {
      return;
    }
    control.addEventListener("input", scheduleSettingsSave);
    control.addEventListener("change", scheduleSettingsSave);
  });
}

boot().catch((error) => {
  addLog({ level: "error", message: error.message, at: new Date().toISOString() });
});
