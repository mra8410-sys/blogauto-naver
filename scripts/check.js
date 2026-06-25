const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targets = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      targets.push(full);
    }
  }
}

walk(path.join(root, "src"));
walk(path.join(root, "scripts"));

let failed = false;
for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exit(1);
}

function assertIncludes(file, text, description) {
  if (!file.content.includes(text)) {
    failed = true;
    console.error(`${file.relative}: missing ${description}`);
  }
}

function assertNotIncludes(file, text, description) {
  if (file.content.includes(text)) {
    failed = true;
    console.error(`${file.relative}: unexpected ${description}`);
  }
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractBlockAfter(file, marker, description) {
  const markerIndex = file.content.indexOf(marker);
  if (markerIndex === -1) {
    failed = true;
    console.error(`${file.relative}: missing ${description}`);
    return null;
  }
  const openIndex = file.content.indexOf("{", markerIndex);
  const closeIndex = openIndex === -1 ? -1 : findMatchingBrace(file.content, openIndex);
  if (openIndex === -1 || closeIndex === -1) {
    failed = true;
    console.error(`${file.relative}: cannot parse ${description}`);
    return null;
  }
  return {
    start: openIndex,
    end: closeIndex,
    content: file.content.slice(openIndex, closeIndex + 1)
  };
}

function extractFunctionBlock(file, marker, description) {
  const markerIndex = file.content.indexOf(marker);
  if (markerIndex === -1) {
    failed = true;
    console.error(`${file.relative}: missing ${description}`);
    return null;
  }
  const bodyStartMarker = file.content.indexOf(") {", markerIndex);
  const openIndex = bodyStartMarker === -1 ? -1 : file.content.indexOf("{", bodyStartMarker);
  const closeIndex = openIndex === -1 ? -1 : findMatchingBrace(file.content, openIndex);
  if (openIndex === -1 || closeIndex === -1) {
    failed = true;
    console.error(`${file.relative}: cannot parse ${description}`);
    return null;
  }
  return {
    start: openIndex,
    end: closeIndex,
    content: file.content.slice(openIndex, closeIndex + 1)
  };
}

function allIndexesOf(text, needle) {
  const indexes = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return indexes;
}

const sourceFiles = {
  main: {
    relative: "src/main.js",
    content: fs.readFileSync(path.join(root, "src", "main.js"), "utf8")
  },
  codexRunner: {
    relative: "src/lib/codexRunner.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "codexRunner.js"), "utf8")
  },
  naverPublisher: {
    relative: "src/lib/naverPublisher.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "naverPublisher.js"), "utf8")
  },
  accountStore: {
    relative: "src/lib/accountStore.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "accountStore.js"), "utf8")
  },
  imageAssets: {
    relative: "src/lib/imageAssets.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "imageAssets.js"), "utf8")
  },
  shortContents: {
    relative: "src/lib/shortContents.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "shortContents.js"), "utf8")
  },
  rendererIndex: {
    relative: "src/renderer/index.html",
    content: fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8")
  },
  rendererApp: {
    relative: "src/renderer/app.js",
    content: fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8")
  },
  preload: {
    relative: "src/preload.js",
    content: fs.readFileSync(path.join(root, "src", "preload.js"), "utf8")
  },
  settings: {
    relative: "src/lib/settings.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "settings.js"), "utf8")
  },
  search: {
    relative: "src/lib/search.js",
    content: fs.readFileSync(path.join(root, "src", "lib", "search.js"), "utf8")
  }
};

const searchLib = require(path.join(root, "src", "lib", "search.js"));
const searchPrivate = searchLib._private || {};
const naverPublisherLib = require(path.join(root, "src", "lib", "naverPublisher.js"));
const naverPublisherPrivate = naverPublisherLib._private || {};

function assertCondition(condition, description) {
  if (!condition) {
    failed = true;
    console.error(description);
  }
}

const naverBlogSearchTemplate = "https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query={query}";
const naverBlogSearchFallback = "https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${query}";
assertCondition(
  sourceFiles.settings.content.includes(`DEFAULT_NAVER_SEARCH_URL = "${naverBlogSearchTemplate}"`)
    && sourceFiles.settings.content.includes("LEGACY_NAVER_SEARCH_URL")
    && sourceFiles.settings.content.includes("normalized.naverSearchUrl = DEFAULT_NAVER_SEARCH_URL"),
  "src/lib/settings.js: Naver default search URL must use the blog tab and migrate the legacy web default"
);
assertCondition(
  sourceFiles.rendererApp.content.includes(`DEFAULT_NAVER_SEARCH_URL = "${naverBlogSearchTemplate}"`),
  "src/renderer/app.js: renderer default Naver search URL must use the blog tab"
);
assertCondition(
  sourceFiles.settings.content.includes("imageAspectRatio: DEFAULT_IMAGE_ASPECT_RATIO")
    && sourceFiles.settings.content.includes("function normalizeImageAspectRatio")
    && sourceFiles.settings.content.includes("normalized.imageAspectRatio = normalizeImageAspectRatio(normalized.imageAspectRatio)"),
  "src/lib/settings.js: image aspect ratio must default to 16:9 and be normalized"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("id=\"imageAspectRatio\"")
    && sourceFiles.rendererIndex.content.includes("value=\"16:9\"")
    && sourceFiles.rendererIndex.content.includes("value=\"9:16\"")
    && sourceFiles.rendererIndex.content.includes("value=\"1:1\""),
  "src/renderer/index.html: image preview controls must expose 16:9, 9:16, and 1:1 aspect ratio options"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("id=\"autoRepeatEnabled\"")
    && sourceFiles.rendererIndex.content.indexOf("id=\"autoRepeatEnabled\"") < sourceFiles.rendererIndex.content.indexOf("id=\"repeatTermMinutes\"")
    && sourceFiles.settings.content.includes("autoRepeatEnabled: false")
    && sourceFiles.rendererApp.content.includes("const repeatEnabled = $(\"#autoRepeatEnabled\").checked")
    && sourceFiles.rendererApp.content.includes("1회성 자동 발행 대상 처리를 완료했습니다.")
    && sourceFiles.rendererApp.content.includes("state.autoRunning && repeatEnabled"),
  "automatic publishing must run once unless repeat execution is checked"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("id=\"shortContentRandomSelectionCount\"")
    && sourceFiles.accountStore.content.includes("shortContentRandomSelectionCount")
    && sourceFiles.rendererApp.content.includes("function refillAutoTitleQueue")
    && sourceFiles.rendererApp.content.includes("shuffledTitles(titles)")
    && sourceFiles.rendererApp.content.includes("await refillAutoTitleQueue(target.account)")
    && sourceFiles.rendererApp.content.includes("consumeAutoTitle(target.account, currentTitle)")
    && sourceFiles.rendererApp.content.includes("target.account.shortContentSelectedTitles.length === 0"),
  "repeat publishing must refill a random short-content title queue after the selected batch is exhausted"
);
assertCondition(
  sourceFiles.accountStore.content.includes("function resetShortContentSelectedTitles")
    && sourceFiles.accountStore.content.includes("account.shortContentSelectedTitles = []")
    && sourceFiles.main.content.includes("resetShortContentSelectedTitles(getRuntimeRoot(), startupSettings)"),
  "app startup must clear every account's selected short-content title queue"
);
assertCondition(
  sourceFiles.shortContents.content.includes("/&#x([0-9a-f]+);/gi")
    && sourceFiles.shortContents.content.includes("String.fromCodePoint(Number.parseInt(hex, 16))")
    && sourceFiles.accountStore.content.includes("decodeHtml(item?.title || item).trim()"),
  "short-content titles must decode hexadecimal HTML entities such as &#x27;"
);
assertCondition(
  sourceFiles.shortContents.content.includes("sds-comps-text-type-headline(?:1|2)")
    && sourceFiles.shortContents.content.includes("(body2|headline1|headline2)"),
  "short-content extraction must support both current headline1 and legacy headline2 Naver markup"
);
assertCondition(
  sourceFiles.codexRunner.content.includes("Never write first-person investment, purchase, profit/loss")
    && sourceFiles.codexRunner.content.includes("Keep the title promise and the body aligned")
    && sourceFiles.codexRunner.content.includes("Each bodyImages[n].prompt must depict only information actually stated")
    && sourceFiles.codexRunner.content.includes("do not enforce article-prompt instructions that prohibit exaggerated")
    && sourceFiles.codexRunner.content.includes("When the only concern is tone strength or decisiveness, set riskExpressionPass to true"),
  "writer and main review must prevent fabricated experience and content drift while allowing strong wording"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("id=\"maxBodyImages\"")
    && sourceFiles.rendererIndex.content.includes("value=\"1\"")
    && sourceFiles.rendererIndex.content.includes("value=\"3\"")
    && sourceFiles.rendererIndex.content.includes("value=\"5\"")
    && sourceFiles.rendererIndex.content.includes("value=\"7\"")
    && !sourceFiles.rendererIndex.content.includes("id=\"includeTitleImage\""),
  "src/renderer/index.html: image count must be limited to 1, 3, 5, 7 and title-image toggle must be removed"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("id=\"articlePromptText\"")
    && sourceFiles.rendererIndex.content.includes("id=\"imagePromptText\"")
    && sourceFiles.accountStore.content.includes("shortContentPromptProfiles")
    && sourceFiles.accountStore.content.includes("[\"증권\", \"생활경제\"]"),
  "category prompt profiles must be editable and seed the finance image prompt for 증권 and 생활경제"
);
assertCondition(
  sourceFiles.rendererApp.content.includes("imageAspectRatio: normalizeImageAspectRatio($(\"#imageAspectRatio\").value)")
    && sourceFiles.rendererApp.content.includes("imageAspectRatio: form.imageAspectRatio")
    && sourceFiles.rendererApp.content.includes("$(\"#imageAspectRatio\").addEventListener(\"change\""),
  "src/renderer/app.js: image aspect ratio must be collected, saved, and persisted immediately on change"
);
assertCondition(
  sourceFiles.main.content.includes("const imageAspectRatio = normalizeImageAspectRatio(form.imageAspectRatio || settings.imageAspectRatio)")
    && sourceFiles.main.content.includes("imageAspectRatio,"),
  "src/main.js: image aspect ratio must flow from the form into saved settings and generation options"
);
assertCondition(
  sourceFiles.search.content.includes(naverBlogSearchFallback),
  "src/lib/search.js: Naver search fallback URL must use the blog tab"
);
assertCondition(
  sourceFiles.accountStore.content.includes("searchChannel: normalizeSearchChannel(category?.searchChannel)")
    && sourceFiles.accountStore.content.includes("trustBlogAsSource: category?.trustBlogAsSource === true"),
  "src/lib/accountStore.js: category search channel and blog trust settings must be normalized"
);
assertCondition(
  sourceFiles.rendererIndex.content.includes("categorySearchChannel")
    && sourceFiles.rendererIndex.content.includes("categoryTrustBlogAsSource"),
  "src/renderer/index.html: category manager must expose search channel and blog trust controls"
);
assertCondition(
  sourceFiles.rendererApp.content.includes("searchChannel: [\"blog\", \"web\"].includes(category?.searchChannel) ? category.searchChannel : \"blog\"")
    && sourceFiles.rendererApp.content.includes("trustBlogAsSource: category?.trustBlogAsSource === true"),
  "src/renderer/app.js: category search settings must be included in collected run form"
);
assertCondition(
  sourceFiles.main.content.includes("searchChannel: form.searchChannel || \"blog\"")
    && sourceFiles.main.content.includes("trustBlogAsSource: form.trustBlogAsSource === true"),
  "src/main.js: category search settings must flow into generation and search callbacks"
);
assertCondition(
  naverPublisherPrivate.shouldUseReservedPublishSchedule?.({
    publishVisibility: "private",
    publishPrivate: true,
    publishScheduleMode: "reserve"
  }) === false
    && naverPublisherPrivate.shouldUseReservedPublishSchedule?.({
      publishVisibility: "public",
      publishPrivate: false,
      publishScheduleMode: "reserve"
    }) === true,
  "src/lib/naverPublisher.js: private publishing must force current publish instead of reserved publish"
);
const overnightReserveParts = naverPublisherPrivate.getReservedDateParts?.(3, new Date(2026, 5, 20, 22, 37, 0));
assertCondition(
  overnightReserveParts?.date === "2026. 06. 21"
    && overnightReserveParts?.hour === "01"
    && overnightReserveParts?.minute === "40",
  "src/lib/naverPublisher.js: reserved publishing must increment date when the offset crosses midnight"
);
assertCondition(
  sourceFiles.naverPublisher.content.includes("async function clickFinalPublishButton(page, selectors, log, options = {})")
    && sourceFiles.naverPublisher.content.includes("clickFinalPublishButton(page, selectors, log, options)")
    && sourceFiles.naverPublisher.content.includes("input[class*='input_date'][readonly][type='text']")
    && sourceFiles.naverPublisher.content.includes("node.setAttribute(\"value\", nextValue)"),
  "src/lib/naverPublisher.js: reserved/current publish automation must use mode-aware final buttons and robust readonly date input"
);

assertCondition(
  typeof searchLib.summarizeSourceQuality === "function",
  "src/lib/search.js: source quality summarizer must be exported for runtime and checks"
);
assertCondition(
  searchPrivate.isLowValueResult?.("feedback", "https://support.google.com/websearch") === true,
  "src/lib/search.js: generic support/search-help pages must be filtered before content extraction"
);
assertCondition(
  searchPrivate.isUnsupportedContentUrl?.("https://example.com/report.xlsx") === true
    && searchPrivate.isLowValueResult?.("PDF", "https://example.com/file.pdf") === true,
  "src/lib/search.js: non-HTML document URLs must be filtered before content extraction"
);
assertCondition(
  searchPrivate.naverSearchTemplateFor?.({ searchChannel: "blog" }) === naverBlogSearchTemplate
    && searchPrivate.naverSearchTemplateFor?.({ searchChannel: "web" }) === "https://search.naver.com/search.naver?where=web&query={query}",
  "src/lib/search.js: category search channel must select Naver blog or web search URLs"
);
const foodSearchQuery = searchPrivate.buildQueryText?.(
  "생생정보통에 소개된 최신 맛집 중 독자가 실제 방문 전 확인해야 할 메뉴, 위치, 주변 볼거리 정보를 함께 정리하는 방향이 적합하다.",
  "생생정보통 맛집 추천",
  "auto"
);
assertCondition(
  typeof foodSearchQuery === "string"
    && foodSearchQuery.startsWith("생생정보통 맛집 추천")
    && foodSearchQuery.length <= 90
    && !foodSearchQuery.includes("적합하다"),
  "src/lib/search.js: automatic food/news searches must prioritize compact category keywords over long Research topicThesis sentences"
);
assertCondition(
  searchPrivate.candidateMatchesSearchIntent?.(
    { title: "생생정보통 오늘 맛집 위치", url: "https://example.com/post" },
    { topic: "생생정보통 맛집 추천", keyword: "생생정보통 맛집 추천" }
  ) === true
    && searchPrivate.candidateMatchesSearchIntent?.(
      { title: "기초학문자료센터 XLS", url: "https://www.krm.or.kr/data/frbr/file.xlsx" },
      { topic: "생생정보통 맛집 추천", keyword: "생생정보통 맛집 추천" }
    ) === false,
  "src/lib/search.js: search candidates must match keyword intent before fetch attempts"
);
const longBroadcastQuery = searchPrivate.buildQueryText?.(
  "가장 최근 전현무계획 방송에 나온 맛집 소개",
  "전현무계획 맛집, 전현무계획 오늘 맛집, 전현무계획 지역 맛집, 전현무계획 식당 위치, 전현무계획 메뉴 가격, 백반기행 맛집, 생생정보 맛집, 6시내고향 맛집",
  "auto"
);
assertCondition(
  typeof longBroadcastQuery === "string" && longBroadcastQuery.length <= 260 && !longBroadcastQuery.includes("6시내고향 맛집"),
  "src/lib/search.js: automatic search queries must be compacted instead of sending every category keyword"
);
assertCondition(
  JSON.stringify(searchPrivate.normalizeSearchQueries?.([
    "OpenAI copyright lawsuit latest filing",
    "OpenAI copyright lawsuit latest filing",
    "The New York Times OpenAI Microsoft copyright lawsuit",
    "AI copyright court document 2026",
    "OpenAI settlement status 2026"
  ])) === JSON.stringify([
    "OpenAI copyright lawsuit latest filing",
    "The New York Times OpenAI Microsoft copyright lawsuit",
    "AI copyright court document 2026",
    "OpenAI settlement status 2026"
  ]),
  "src/lib/search.js: Research/Title searchQueries must stay deduped separate query variants"
);
assertCondition(
  sourceFiles.search.content.includes("queryOverride")
    && sourceFiles.search.content.includes("Narrow search query:")
    && sourceFiles.search.content.includes("includeNaverWebFallback")
    && sourceFiles.search.content.includes("forceAllProviders: profile.strictEvidence"),
  "src/lib/search.js: strict search must run separate Research/Title query variants and avoid early provider cutoff"
);
const strictSearchOptions = {
  searchNeed: "strict",
  topic: "2026 소상공인 정책자금 신청 대상",
  keyword: "소상공인정책자금, 소상공인공고",
  researchGuidance: "공고 신청 기간 대상 자격 확인"
};
const strictProfile = searchPrivate.buildSearchProfile?.(strictSearchOptions);
const institutionalRelevance = searchPrivate.scoreCandidate?.({
  title: "소상공인24 소상공인정책자금 신청 대상 공고",
  url: "https://www.sbiz.or.kr/cot/cm/intro.do",
  excerpt: "2026년 소상공인정책자금 신청 기간과 지원 대상, 자격, 공고 내용을 안내합니다."
}, ["소상공인정책자금", "신청", "대상"], strictSearchOptions, strictProfile);
assertCondition(
  institutionalRelevance?.institutionalSource === true && institutionalRelevance?.currentFactSignal === true,
  "src/lib/search.js: institutional current sources must be recognized without category-specific site hardcoding"
);
const institutionalSummary = searchLib.summarizeSourceQuality?.([{
  title: "소상공인24 소상공인정책자금 신청 대상 공고",
  url: "https://www.sbiz.or.kr/cot/cm/intro.do",
  contentLength: 420,
  excerpt: "2026년 소상공인정책자금 신청 기간과 지원 대상, 자격, 공고 내용을 안내합니다.",
  relevance: institutionalRelevance
}], "auto", { searchNeed: "strict" });
assertCondition(
  institutionalSummary?.status === "usable" && institutionalSummary?.strongEvidenceCandidates === 1,
  "src/lib/search.js: strict source quality must accept reliable current institutional evidence"
);
const strictBlogOptions = {
  searchNeed: "strict",
  topic: "생생정보통 맛집 추천",
  keyword: "생생정보통 맛집 추천",
  researchGuidance: "공식 최신 출처와 현재 운영 정보 확인",
  trustBlogAsSource: true
};
const strictBlogProfile = searchPrivate.buildSearchProfile?.(strictBlogOptions);
const trustedBlogRelevance = searchPrivate.scoreCandidate?.({
  title: "생생정보통 맛집 추천 방문 후기",
  url: "https://blog.naver.com/sample/223000000000",
  excerpt: "2026년 6월 20일 기준 메뉴, 위치, 영업시간, 예약, 주차 정보를 직접 방문 후 정리했습니다."
}, ["생생정보통", "맛집", "추천"], strictBlogOptions, strictBlogProfile);
assertCondition(
  trustedBlogRelevance?.blogTrustedSource === true
    && trustedBlogRelevance?.lowTrustSource === false
    && searchPrivate.hasStrongEvidence?.({ relevance: trustedBlogRelevance }) === true,
  "src/lib/search.js: trusted Naver blog categories must allow directly relevant current blog evidence"
);
const strictUntrustedBlogOptions = { ...strictBlogOptions, trustBlogAsSource: false };
const strictUntrustedBlogProfile = searchPrivate.buildSearchProfile?.(strictUntrustedBlogOptions);
const untrustedBlogRelevance = searchPrivate.scoreCandidate?.({
  title: "생생정보통 맛집 추천 방문 후기",
  url: "https://blog.naver.com/sample/223000000000",
  excerpt: "2026년 6월 20일 기준 메뉴, 위치, 영업시간, 예약, 주차 정보를 직접 방문 후 정리했습니다."
}, ["생생정보통", "맛집", "추천"], strictUntrustedBlogOptions, strictUntrustedBlogProfile);
assertCondition(
  untrustedBlogRelevance?.blogTrustedSource !== true
    && untrustedBlogRelevance?.lowTrustSource === true
    && searchPrivate.hasStrongEvidence?.({ relevance: untrustedBlogRelevance }) === false,
  "src/lib/search.js: untrusted blog categories must keep Naver blog evidence out of strict strong evidence"
);
const irrelevantSummary = searchLib.summarizeSourceQuality?.([{
  title: "feedback",
  url: "https://support.google.com/websearch",
  contentLength: 361,
  excerpt: "Google 검색 고객센터 도움말 센터 검색 도움말 포럼 서비스 약관 의견 보내기",
  relevance: { score: 0, matchedTerms: [] }
}], "auto", { searchNeed: "normal" });
assertCondition(
  irrelevantSummary?.status === "insufficient",
  "src/lib/search.js: source quality must reject extracted text with no direct relevance"
);

assertNotIncludes(
  sourceFiles.main,
  "prepareNaverPostWrite",
  "pre-generation editor-loading preparation in main process"
);
const naverExports = extractBlockAfter(sourceFiles.naverPublisher, "module.exports = ", "Naver publisher exports");
if (naverExports?.content.includes("prepareNaverPostWrite")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: prepareNaverPostWrite must not be exported for pre-generation reuse");
}
const resolveTopicInput = extractFunctionBlock(sourceFiles.main, "async function resolveTopicInput", "resolveTopicInput function");
if (resolveTopicInput && !resolveTopicInput.content.includes("topic: \"\"")) {
  failed = true;
  console.error("src/main.js: auto topic mode must not reuse stale topic text as a direct topic");
}

const searchTopicSelector = extractFunctionBlock(sourceFiles.main, "function selectSearchTopicForResearch", "selectSearchTopicForResearch function");
if (searchTopicSelector && !searchTopicSelector.content.includes("researchResult?.finalTitle")) {
  failed = true;
  console.error("src/main.js: search topic selection must prefer Research/Title finalTitle over topicThesis for search queries");
}

const generationOptions = extractBlockAfter(sourceFiles.main, "codexResult = await runCodexGeneration(", "main runCodexGeneration options");
if (generationOptions && !generationOptions.content.includes("searchResults: []")) {
  failed = true;
  console.error("src/main.js: initial runCodexGeneration options must pass searchResults: []");
}
if (generationOptions && !generationOptions.content.includes("onSearchNeeded: async")) {
  failed = true;
  console.error("src/main.js: runCodexGeneration options must include onSearchNeeded");
}
const searchCallback = extractBlockAfter(sourceFiles.main, "onSearchNeeded: async", "main onSearchNeeded callback");
if (searchCallback && !searchCallback.content.includes("selectSearchTopicForResearch(researchResult")) {
  failed = true;
  console.error("src/main.js: onSearchNeeded must use compact search topic selection instead of raw topicThesis");
}
if (
  !sourceFiles.main.content.includes("function splitKeywordLanes")
  || !sourceFiles.main.content.includes("function buildKeywordLanePlan")
  || !sourceFiles.main.content.includes("function keywordLaneHistoryFields")
) {
  failed = true;
  console.error("src/main.js: automatic keyword pools must be split into history-aware keyword lanes");
}
if (
  searchCallback
  && (!searchCallback.content.includes("normalizeResearchLaneResult(researchResult, keywordLanePlan)")
    || !searchCallback.content.includes("searchQueries: laneResult.searchQueries")
    || searchCallback.content.includes("laneResult.searchQueries.join")
    || searchCallback.content.includes("const searchKeyword = keyword || category"))
) {
  failed = true;
  console.error("src/main.js: search must use selected keyword lane/searchQueries instead of the full category keyword pool");
}
if (
  !sourceFiles.main.content.includes("topic_lane")
  || !sourceFiles.main.content.includes("selected_keyword_phrases")
  || !sourceFiles.main.content.includes("search_queries")
) {
  failed = true;
  console.error("src/main.js: keyword lane choices must always be written to blog history");
}
for (const index of allIndexesOf(sourceFiles.main.content, "collectSearchResults({")) {
  if (!searchCallback || index < searchCallback.start || index > searchCallback.end) {
    failed = true;
    console.error("src/main.js: collectSearchResults must only run inside onSearchNeeded after Research/Title Agent asks for search");
  }
}

const codexGeneration = extractFunctionBlock(sourceFiles.codexRunner, "async function runCodexGeneration", "runCodexGeneration function");
const codexTask = extractFunctionBlock(sourceFiles.codexRunner, "async function runCodexTask", "runCodexTask function");
const codexFeedbackFilter = extractFunctionBlock(sourceFiles.codexRunner, "function isUsefulCodexFeedback", "Codex feedback filter");
const codexResultReader = extractFunctionBlock(sourceFiles.codexRunner, "function readAgentResult", "Codex agent result reader");
if (codexFeedbackFilter && !codexFeedbackFilter.content.includes("codex_core::tools::router")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex internal tool-router errors must be hidden from user-facing logs");
}
if (codexFeedbackFilter && !codexFeedbackFilter.content.includes("ConvertFrom-Json")) {
  failed = true;
  console.error("src/lib/codexRunner.js: PowerShell JSON validation noise must be hidden from user-facing logs");
}
if (
  codexFeedbackFilter
  && (!codexFeedbackFilter.content.includes("Copy-Item")
    || !codexFeedbackFilter.content.includes("AccessException")
    || !codexFeedbackFilter.content.includes("Invoke-WebRequest"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: PowerShell command errors must be hidden from user-facing logs");
}
if (codexFeedbackFilter && !sourceFiles.codexRunner.content.includes("function looksLikeMojibake")) {
  failed = true;
  console.error("src/lib/codexRunner.js: mojibake Codex output must be filtered before reaching user-facing logs");
}
if (!sourceFiles.codexRunner.content.includes("\"묒\"") || !sourceFiles.codexRunner.content.includes("\"쒕\"") || !sourceFiles.codexRunner.content.includes("\"씤\"")) {
  failed = true;
  console.error("src/lib/codexRunner.js: mojibake filter must cover observed broken Korean Research/Title output fragments");
}
if (codexFeedbackFilter && !codexFeedbackFilter.content.includes("^\"[^\"]+\"\\s*:\\s*")) {
  failed = true;
  console.error("src/lib/codexRunner.js: raw JSON fragments must be hidden from user-facing Codex feedback");
}
if (
  codexFeedbackFilter
  && (!codexFeedbackFilter.content.includes("const inlineJsonFragment")
    || !codexFeedbackFilter.content.includes("inlineJsonFragment.indexOf(\"\\\":\")")
    || !codexFeedbackFilter.content.includes("inlineJsonColonIndex"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: inline object-shaped JSON fragments must be hidden from user-facing Codex feedback");
}
if (codexResultReader && !codexResultReader.content.includes("try {")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex agent result reader must catch JSON parse failures");
}
if (codexResultReader && !codexResultReader.content.includes("Codex Agent 결과 JSON 파싱 실패")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex agent JSON parse failures must be summarized without dumping raw result content");
}
if (codexTask && codexTask.content.includes("handleOutputLine(nestedLine, level)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: assistant output from Codex JSON events must not be recursively logged to the UI");
}
if (codexTask && !codexTask.content.includes("assistantProgress = parseProgressLine")) {
  failed = true;
  console.error("src/lib/codexRunner.js: assistant output should only contribute BLOGAUTO_PROGRESS lines");
}
if (codexTask && !codexTask.content.includes("outputState.section === \"assistant\"")) {
  failed = true;
  console.error("src/lib/codexRunner.js: raw assistant sections must be suppressed from user-facing logs");
}
if (codexTask && !codexTask.content.includes("streamBuffers")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex JSONL stdout/stderr chunks must be buffered before parsing/logging");
}
if (!sourceFiles.codexRunner.content.includes("function shouldForwardRawCodexOutput")) {
  failed = true;
  console.error("src/lib/codexRunner.js: raw Codex output forwarding must be behind an explicit debug switch");
}
if (codexTask && !codexTask.content.includes("shouldForwardRawCodexOutput(options) && isUsefulCodexFeedback")) {
  failed = true;
  console.error("src/lib/codexRunner.js: raw Codex stdout/stderr must not reach UI logs by default");
}
if (!sourceFiles.codexRunner.content.includes("BLOGAUTO_DEBUG_CODEX_RAW")) {
  failed = true;
  console.error("src/lib/codexRunner.js: raw Codex output debug mode must be explicit");
}
for (const requiredLimitType of [
  "workspace_owner_usage_limit_reached",
  "workspace_member_usage_limit_reached"
]) {
  if (!sourceFiles.codexRunner.content.includes(requiredLimitType)) {
    failed = true;
    console.error(`src/lib/codexRunner.js: Codex usage-limit detection must include ${requiredLimitType}`);
  }
}
if (codexTask && !codexTask.content.includes("\"--json\"")) {
  failed = true;
  console.error("src/lib/codexRunner.js: codex exec must use --json so rate_limit_reached_type can be read exactly");
}
if (codexTask && !codexTask.content.includes("detectCodexUsageLimitSignal(line)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: runCodexTask must detect Codex usage limits from the output stream");
}
if (codexTask && !codexTask.content.includes("isCodexUsageLimitError(error)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: xhigh fallback must not retry after Codex usage-limit errors");
}
if (sourceFiles.codexRunner.content.includes("CODEX_LIMIT_REACHED_TYPES")) {
  failed = true;
  console.error("src/lib/codexRunner.js: usage-limit handling must not collapse generic rate/credit limits into codex_usage_limit");
}
if (!sourceFiles.codexRunner.content.includes("function jsonRateLimits")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex rate_limits JSON must be parsed for usage badges");
}
if (!sourceFiles.codexRunner.content.includes("remainingPercent")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Codex usage badges must expose remainingPercent, not only used_percent");
}
if (codexTask && !codexTask.content.includes("jsonRateLimits(parsedJson)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: runCodexTask must collect rate_limits from JSON token_count events");
}
if (codexTask && !codexTask.content.includes("rateLimits: tokenState.rateLimits")) {
  failed = true;
  console.error("src/lib/codexRunner.js: onTokenUsage and tokenUsage must include latest rateLimits");
}
if (codexTask && !codexTask.content.includes("const reportTokenUsage")) {
  failed = true;
  console.error("src/lib/codexRunner.js: token usage reporting must be centralized per Codex task");
}
if (codexTask && !codexTask.content.includes("reportTokenUsage({ final: true })")) {
  failed = true;
  console.error("src/lib/codexRunner.js: each agent must report final token usage when its Codex task completes");
}
if (codexTask && !codexTask.content.includes("agentTotal")) {
  failed = true;
  console.error("src/lib/codexRunner.js: token usage payload must include per-agent totals");
}
if (!sourceFiles.codexRunner.content.includes("function readLatestCodexTokenUsageFromSessions")) {
  failed = true;
  console.error("src/lib/codexRunner.js: must recover token usage from Codex session JSONL when stdout has no token_count event");
}
if (codexTask && !codexTask.content.includes("recoverTokenUsageFromSession")) {
  failed = true;
  console.error("src/lib/codexRunner.js: runCodexTask must call token session fallback before final reporting");
}
if (!sourceFiles.main.content.includes("agentTotal: Number(usage.agentTotal || 0)")) {
  failed = true;
  console.error("src/main.js: token IPC payload must preserve per-agent totals");
}
if (!sourceFiles.main.content.includes("현재 작업 중입니다 - 경과")) {
  failed = true;
  console.error("src/main.js: generation heartbeat must say current work is in progress, not Codex preparation");
}
if (!sourceFiles.codexRunner.content.includes("async function fetchCodexUsageSnapshot")) {
  failed = true;
  console.error("src/lib/codexRunner.js: app startup must have a lightweight Codex usage snapshot reader");
}
if (!sourceFiles.codexRunner.content.includes("readLatestCodexRateLimitsFromSessions")) {
  failed = true;
  console.error("src/lib/codexRunner.js: startup usage refresh must fall back to latest local Codex session rate_limits");
}
if (!sourceFiles.codexRunner.content.includes("codexSessionsRoot")) {
  failed = true;
  console.error("src/lib/codexRunner.js: local Codex session scanning must use the CODEX_HOME/.codex sessions root");
}
if (!sourceFiles.codexRunner.content.includes("\"--ephemeral\"") || !sourceFiles.codexRunner.content.includes("\"--ignore-rules\"")) {
  failed = true;
  console.error("src/lib/codexRunner.js: startup usage snapshot should be ephemeral and ignore project rules");
}
if (!sourceFiles.settings.content.includes("codexRateLimits: null")) {
  failed = true;
  console.error("src/lib/settings.js: settings defaults must include codexRateLimits: null");
}
if (!sourceFiles.main.content.includes("fetchCodexUsageSnapshot")) {
  failed = true;
  console.error("src/main.js: main process must expose startup Codex usage refresh");
}
if (!sourceFiles.main.content.includes("ipcMain.handle(\"codex:refreshUsage\"")) {
  failed = true;
  console.error("src/main.js: codex:refreshUsage IPC must be registered");
}
const codexRefreshHandler = extractBlockAfter(sourceFiles.main, "ipcMain.handle(\"codex:refreshUsage\"", "Codex usage refresh IPC handler");
if (codexRefreshHandler && !codexRefreshHandler.content.includes("try {")) {
  failed = true;
  console.error("src/main.js: codex:refreshUsage must catch refresh failures instead of rejecting the Electron IPC handler");
}
if (codexRefreshHandler && !codexRefreshHandler.content.includes("savedFallback")) {
  failed = true;
  console.error("src/main.js: codex:refreshUsage must return saved rate limits when live usage refresh is unavailable");
}
if (!sourceFiles.codexRunner.content.includes("rate_limits가 포함되지 않아 배지를 갱신하지 못했습니다")) {
  failed = true;
  console.error("src/lib/codexRunner.js: missing Codex rate_limits during usage refresh must be treated as badge refresh unavailable, not a fatal job error");
}
if (!sourceFiles.main.content.includes("persistCodexRateLimits(runtimeRoot, jobTokenUsage.rateLimits)")) {
  failed = true;
  console.error("src/main.js: latest Codex rate limits must be persisted after terminal jobs");
}
if (!sourceFiles.main.content.includes("rateLimits: jobTokenUsage.rateLimits")) {
  failed = true;
  console.error("src/main.js: job token/complete payloads must carry rateLimits");
}
if (!sourceFiles.preload.content.includes("refreshCodexUsage")) {
  failed = true;
  console.error("src/preload.js: renderer must be able to request startup Codex usage refresh");
}
if (!sourceFiles.rendererIndex.content.includes("codexPrimaryLimitBadge") || !sourceFiles.rendererIndex.content.includes("codexSecondaryLimitBadge")) {
  failed = true;
  console.error("src/renderer/index.html: topbar must include primary and secondary Codex usage badges");
}
if (!sourceFiles.rendererApp.content.includes("refreshCodexUsageOnStartup")) {
  failed = true;
  console.error("src/renderer/app.js: renderer must refresh Codex usage once on startup");
}
if (!sourceFiles.rendererApp.content.includes("initial.settings?.codexRateLimits")) {
  failed = true;
  console.error("src/renderer/app.js: renderer must initialize badges from saved codexRateLimits");
}
if (!sourceFiles.rendererApp.content.includes("payload.rateLimits") || !sourceFiles.rendererApp.content.includes("payload.tokenUsage?.rateLimits")) {
  failed = true;
  console.error("src/renderer/app.js: renderer must update usage badges from live and complete events");
}
if (!sourceFiles.rendererApp.content.includes("remainingPercent")) {
  failed = true;
  console.error("src/renderer/app.js: renderer must display remaining percent values");
}
if (!sourceFiles.main.content.includes("error.code === \"CODEX_USAGE_LIMIT\" ? \"codex_usage_limit\"")) {
  failed = true;
  console.error("src/main.js: CODEX_USAGE_LIMIT must map to codex_usage_limit job status");
}
if (!sourceFiles.rendererApp.content.includes("result?.status === \"codex_usage_limit\"")) {
  failed = true;
  console.error("src/renderer/app.js: automatic loop must stop when Codex usage limit is reached");
}
if (codexGeneration && !codexGeneration.content.includes("const validSearchNeeds = new Set([\"skip\", \"light\", \"normal\", \"strict\"])")) {
  failed = true;
  console.error("src/lib/codexRunner.js: runCodexGeneration must define the strict searchNeed enum");
}
const researchSourceFailure = extractFunctionBlock(sourceFiles.codexRunner, "function isResearchSourceFailure", "Research source failure classifier");
if (codexGeneration && !codexGeneration.content.includes("isResearchSourceFailure(researchResult)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: adaptive Research/Title search retry must use the source failure classifier");
}
if (researchSourceFailure && !researchSourceFailure.content.includes("searchNeed")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research source failure classifier must only trigger for explicit searchNeed values");
}
if (researchSourceFailure && (!researchSourceFailure.content.includes("insufficient") || !researchSourceFailure.content.includes("official"))) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research source failure classifier must cover source and official-evidence failures");
}
if (codexGeneration && !codexGeneration.content.includes("if (!validSearchNeeds.has(requestedSearchNeed))")) {
  failed = true;
  console.error("src/lib/codexRunner.js: runCodexGeneration must fail invalid searchNeed values");
}
if (codexGeneration && !codexGeneration.content.includes("const finalTitle = String(researchResult.finalTitle || \"\").trim();")) {
  failed = true;
  console.error("src/lib/codexRunner.js: finalTitle must come only from Research/Title finalTitle");
}
if (codexGeneration && !codexGeneration.content.includes("if (!finalTitle)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: missing Research/Title finalTitle must fail before Writer");
}
if (codexGeneration && !codexGeneration.content.includes("title: finalTitle || String(writerResult.title || \"\").trim()")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer title must not override Research/Title finalTitle");
}
if (codexGeneration && !codexGeneration.content.includes("buildMainReviewPrompt")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must run after Writer output");
}
if (codexGeneration && !codexGeneration.content.includes("main-review-result.json")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must write a dedicated review result");
}
if (codexGeneration && !codexGeneration.content.includes("(mainReviewStatus === \"REVISION\" || mainReviewPassIssue) && attempt < maxReviewAttempts")) {
  failed = true;
  console.error("src/lib/codexRunner.js: REVISION Main Agent review must retry before blocking publishing");
}
if (codexGeneration && !codexGeneration.content.includes("Main Agent 수정 요청으로 다시 시도합니다")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent revision retry must be visible in logs");
}
if (codexGeneration && !codexGeneration.content.includes("retryableWriterFailureReason(writerResult")) {
  failed = true;
  console.error("src/lib/codexRunner.js: retryable Writer date-leak failures must be detected");
}
if (codexGeneration && !codexGeneration.content.includes("Writer Agent 작성 실패")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer failures must be logged with the reason before stopping or retrying");
}
if (codexGeneration && !codexGeneration.content.includes("Research/Title Agent가 본문 작성 가능 상태가 아닙니다")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title REVISION must stop before wasting Writer attempts");
}
if (!sourceFiles.codexRunner.content.includes("function writerOutputIssueReason")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer output must have a structural failure gate before Main review");
}
if (!sourceFiles.codexRunner.content.includes("function buildWriterContract")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer drift prevention must use a compact writerContract handoff");
}
const researchTitlePrompt = extractFunctionBlock(sourceFiles.codexRunner, "function buildResearchTitlePrompt", "Research/Title Agent prompt");
if (researchTitlePrompt && !researchTitlePrompt.content.includes("writerContract")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must return writerContract for Writer anchoring");
}
if (researchTitlePrompt && !researchTitlePrompt.content.includes("compact Writer handoff")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must describe writerContract as a compact Writer handoff");
}
if (researchTitlePrompt && !researchTitlePrompt.content.includes("Preferred tone is provided, it is the highest style signal")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must prioritize explicit Preferred tone for title and writerContract style");
}
if (
  researchTitlePrompt
  && (!researchTitlePrompt.content.includes("Naver-home title judgment")
    || !researchTitlePrompt.content.includes("not a template filler")
    || !researchTitlePrompt.content.includes("Build at least three titleCandidates from different editorial angles")
    || !researchTitlePrompt.content.includes("Treat Current writing date as an internal freshness reference")
    || !researchTitlePrompt.content.includes("Do not append a generic freshness or preparation suffix"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must use an editorial Naver-home title judgment rubric instead of a fixed hook template");
}
if (
  !sourceFiles.codexRunner.content.includes("Keyword lanes:")
  || !sourceFiles.codexRunner.content.includes("Recommended keyword lane order from HISTORY")
  || !sourceFiles.codexRunner.content.includes("topicLane")
  || !sourceFiles.codexRunner.content.includes("selectedKeywordIndexes")
  || !sourceFiles.codexRunner.content.includes("searchQueries")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must select a keyword lane and return searchQueries");
}
if (
  researchTitlePrompt
  && (!researchTitlePrompt.content.includes("Current bridge rule")
    || !researchTitlePrompt.content.includes("anchorEvent")
    || !researchTitlePrompt.content.includes("currentPeg")
    || !researchTitlePrompt.content.includes("currentBridgeRequired")
    || !researchTitlePrompt.content.includes("currentBridgeSatisfied")
    || !researchTitlePrompt.content.includes("current web discussion"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title Agent must distinguish older anchor events from current web/blog discussion");
}
if (
  !sourceFiles.codexRunner.content.includes("function currentBridgeIssueReason")
  || !sourceFiles.codexRunner.content.includes("currentBridgeIssueReason(researchResult)")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: current bridge handling must be explicit for current-issue topics");
}
if (
  !sourceFiles.codexRunner.content.includes("currentBridgeRequired,")
  || !sourceFiles.codexRunner.content.includes("currentBridgeSatisfied,")
  || !sourceFiles.codexRunner.content.includes("anchorEvent,")
  || !sourceFiles.codexRunner.content.includes("currentPeg,")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Contract must carry current bridge fields to Writer and Main Review");
}
if (
  !sourceFiles.codexRunner.content.includes("function compactSearchResultsForPrompt")
  || !sourceFiles.codexRunner.content.includes("maxResults: 6")
  || !sourceFiles.codexRunner.content.includes("excerptChars: 420")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Research/Title search rerun prompt must use compact narrowed source candidates");
}
if (
  !sourceFiles.codexRunner.content.includes("function isMissingCodexResultFileError")
  || !sourceFiles.codexRunner.content.includes("추가 검색 후 Research/Title Agent가 결과 파일을 생성하지 못했습니다.")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: missing Research/Title rerun result files must fall back to the existing research verdict");
}
const mainReviewPrompt = extractFunctionBlock(sourceFiles.codexRunner, "function buildMainReviewPrompt", "Main Agent final review prompt");
if (mainReviewPrompt && !mainReviewPrompt.content.includes("not only title/article matching")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must cover the whole publishability judgment, not only title matching");
}
if (mainReviewPrompt && !mainReviewPrompt.content.includes("Writer contract used for review")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must evaluate the same writerContract used by Writer");
}
if (mainReviewPrompt && !mainReviewPrompt.content.includes("articleMission, selectedTitle, topicThesis, readerPromise, firstSectionFocus, mustAnswer, mustCover, and mustNotDo")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must check writerContract fulfillment");
}
for (const requiredReviewField of [
  "titleReviewPass",
  "articleAnswersTitle",
  "topicPreserved",
  "factualityPass",
  "currentBridgePass",
  "sourceUsePass",
  "bodyQualityPass",
  "riskExpressionPass",
  "writerContractPass",
  "readerFacingArticlePass",
  "noResearchProcessNarrationPass"
]) {
  if (mainReviewPrompt && !mainReviewPrompt.content.includes(requiredReviewField)) {
    failed = true;
    console.error(`src/lib/codexRunner.js: Main Agent final review must include ${requiredReviewField}`);
  }
}
if (!sourceFiles.codexRunner.content.includes("function mainReviewPassIssueReason")) {
  failed = true;
  console.error("src/lib/codexRunner.js: PASS review must be structurally verified before publishing");
}
if (codexGeneration && !codexGeneration.content.includes("mainReviewStatus === \"PASS\" && !mainReviewPassIssue")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent PASS must require all review booleans to pass");
}
if (mainReviewPrompt && !mainReviewPrompt.content.includes("[SECTION - ...] markers are intentional app markers")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must allow app section markers");
}
if (mainReviewPrompt && !mainReviewPrompt.content.includes("not how the agent verified sources")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must reject research-process style article leads");
}
if (
  mainReviewPrompt
  && (!mainReviewPrompt.content.includes("homepage-card title tied to the specific subject")
    || !mainReviewPrompt.content.includes("must not pass only because it has a generic hook phrase")
    || !mainReviewPrompt.content.includes("Date words in the title must be source-backed story material")
    || !mainReviewPrompt.content.includes("Explicit Preferred tone wins style conflicts"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent title review must reject generic hook templates while preserving Preferred tone priority");
}
if (
  mainReviewPrompt
  && (!mainReviewPrompt.content.includes("currentBridgeRequired")
    || !mainReviewPrompt.content.includes("currentBridgeSatisfied")
    || !mainReviewPrompt.content.includes("currentBridgePass")
    || !mainReviewPrompt.content.includes("older anchorEvent matters now"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent final review must reject stale anchor-event articles without a current bridge");
}
if (mainReviewPrompt && !mainReviewPrompt.content.includes("reads like a stiff report")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Main Agent body review must reject stiff report-like default posts");
}
const writerPrompt = extractFunctionBlock(sourceFiles.codexRunner, "function buildPrompt", "Writer Agent prompt");
if (writerPrompt && !writerPrompt.content.includes("This required 기준일 is not a date leak")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must allow required confirmation 기준일 without treating it as date leak");
}
if (writerPrompt && !writerPrompt.content.includes("writerRevisionFeedback")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must accept revision retry feedback");
}
if (writerPrompt && !writerPrompt.content.includes("The article body must never narrate the agent's research process")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must forbid research-process narration in article body");
}
if (writerPrompt && !writerPrompt.content.includes("Category publishing direction is internal guidance")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must prevent category-purpose leakage into the article body");
}
if (writerPrompt && !writerPrompt.content.includes("Never omit the closing bracket")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must require complete SECTION markers");
}
if (writerPrompt && !writerPrompt.content.includes("Writer contract (highest priority)")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must put writerContract before full handoff and sources");
}
if (writerPrompt && !writerPrompt.content.includes("The Writer Contract is the only writing brief")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must treat writerContract as the only writing brief");
}
if (writerPrompt && !writerPrompt.content.includes("Category publishing direction may include topic-selection notes")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must prevent publishPurpose role confusion");
}
if (writerPrompt && !writerPrompt.content.includes("explicit Preferred tone > Writer Contract tone > default human Naver Blog voice")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must prioritize explicit Preferred tone over default human-blog style");
}
if (writerPrompt && !writerPrompt.content.includes("Default human Naver Blog voice")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must define the default human Naver Blog voice");
}
if (!/context\.preferredTone,\r?\n\s+researchResult\?\.writerContract\?\.tone/.test(sourceFiles.codexRunner.content)) {
  failed = true;
  console.error("src/lib/codexRunner.js: buildWriterContract must prefer user preferredTone over Research/Title tone");
}
if (writerPrompt && !writerPrompt.content.includes("Do not prepare a separate title image")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must disable separate title-image generation");
}
if (
  mainReviewPrompt
  && (!mainReviewPrompt.content.includes("Article prompt mode override")
    || !mainReviewPrompt.content.includes("factualityPass and sourceUsePass must be true")
    || !mainReviewPrompt.content.includes("never return BLOCK or REVISION solely for absent candidates"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: article prompt mode must bypass missing-source factuality blocks");
}
if (
  !sourceFiles.codexRunner.content.includes("function applyArticlePromptMainReviewPolicy")
  || !sourceFiles.codexRunner.content.includes("applyArticlePromptMainReviewPolicy(mainReviewResult, articlePromptMode)")
) {
  failed = true;
  console.error("src/lib/codexRunner.js: article prompt mode review bypass must be enforced after Main Agent output");
}
if (writerPrompt && !writerPrompt.content.includes("category-specific image prompt is the primary visual standard")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer Agent prompt must prioritize the category image prompt");
}
if (
  writerPrompt
  && (!writerPrompt.content.includes("immediately below its matching [SECTION - 소제목] line")
    || !writerPrompt.content.includes("Return exactly 10 useful Korean SEO tags")
    || !writerPrompt.content.includes("End the article field with the same 10 tags"))
) {
  failed = true;
  console.error("src/lib/codexRunner.js: Writer output must place images below section headings and end with 10 hashtags");
}
assertCondition(
  sourceFiles.imageAssets.content.includes("function placeImageMarkersAfterSections")
    && sourceFiles.imageAssets.content.includes("function normalizeTenTags")
    && sourceFiles.imageAssets.content.includes("function appendHashtagLine"),
  "src/lib/imageAssets.js: normalized results must enforce section-first images and 10 ending hashtags"
);
const imageWorkerPrompt = extractFunctionBlock(sourceFiles.codexRunner, "function buildImageWorkerPrompt", "Image Worker prompt");
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("Image Worker must not copy image files into the app image directory")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker must not attempt app-side image copy operations");
}
if (imageWorkerPrompt && imageWorkerPrompt.content.includes("Save generated files inside the Image output directory")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker prompt must not encourage copying generated images into runtime/image");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("If image generation returns a concrete existing image file path")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker must return concrete image paths when available");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("generated image data is available in the Codex session")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker prompt must account for base64/data image results");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("Do not generate a separate title image")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker must disable separate title-image generation");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("Follow each Writer Agent prompt exactly")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker must follow category-driven image prompts");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("Treat bodyImages sequence 1 as the lead/main image")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker must treat sequence 1 as the optional prompt-driven lead image");
}
if (imageWorkerPrompt && !imageWorkerPrompt.content.includes("Requested image aspect ratio")) {
  failed = true;
  console.error("src/lib/codexRunner.js: Image Worker prompt must instruct generation with the selected aspect ratio");
}
if (sourceFiles.imageAssets.content.includes("function createFallbackTitleImage")) {
  failed = true;
  console.error("src/lib/imageAssets.js: local abstract title-image fallback must not be generated");
}
if (!sourceFiles.imageAssets.content.includes("function recoverCodexSessionImages") || !sourceFiles.imageAssets.content.includes("image_generation_end")) {
  failed = true;
  console.error("src/lib/imageAssets.js: must recover Codex image_generation base64 results from session JSONL");
}
if (!sourceFiles.imageAssets.content.includes("function decodeImageResultPayload")) {
  failed = true;
  console.error("src/lib/imageAssets.js: missing base64/data-url image result decoder");
}
const clickFirstVisible = extractFunctionBlock(sourceFiles.naverPublisher, "async function clickFirstVisible", "clickFirstVisible function");
if (clickFirstVisible && clickFirstVisible.content.includes(".first().waitFor")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: clickFirstVisible must not throw before fallback when no selector is attached");
}
const completeLogin = extractFunctionBlock(sourceFiles.naverPublisher, "async function completeLoginIfNeeded", "completeLoginIfNeeded function");
if (completeLogin && !completeLogin.content.includes("existingMatchesExpectedId")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: prefilled Naver login ID must be compared with the target account ID");
}
if (completeLogin && !completeLogin.content.includes("hasPrefilledCredentials = Boolean(existingId && existingPassword && existingMatchesExpectedId)")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: auto-clicking login must require prefilled ID/PW to match the target account");
}
if (completeLogin && !completeLogin.content.includes("!existingId || hasDifferentPrefilledId")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: mismatched prefilled login ID must be overwritten with the target account ID");
}
if (completeLogin && !completeLogin.content.includes("!existingPassword || hasDifferentPrefilledId")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: mismatched prefilled login ID must force re-entry of the target account password");
}
const titleSelectors = extractFunctionBlock(sourceFiles.naverPublisher, "function titleSelectors", "titleSelectors function");
if (titleSelectors && titleSelectors.content.includes("\"[contenteditable='true']\"")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: titleSelectors must not use generic contenteditable as a title detector");
}
const postWriteWait = extractFunctionBlock(sourceFiles.naverPublisher, "async function waitForPostWriteTitle", "waitForPostWriteTitle function");
if (postWriteWait && !postWriteWait.content.includes("matchesTargetPostWriteUrl(url, postWriteUrl)")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: waitForPostWriteTitle must verify the target postwrite URL before accepting title locator");
}
if (postWriteWait) {
  const postwriteGuardIndex = postWriteWait.content.indexOf("matchesTargetPostWriteUrl(url, postWriteUrl)");
  const draftDialogIndex = postWriteWait.content.indexOf("dismissExistingDraftDialog");
  const editorPopupIndex = postWriteWait.content.indexOf("hasVisibleEditorPopup");
  const titleLocatorIndex = postWriteWait.content.indexOf("findVisibleLocator(page, titleSelectors(selectors)");
  if (postwriteGuardIndex === -1 || titleLocatorIndex === -1 || postwriteGuardIndex > titleLocatorIndex) {
    failed = true;
    console.error("src/lib/naverPublisher.js: waitForPostWriteTitle must check postwrite URL before title locator detection");
  }
  if (
    postwriteGuardIndex === -1
    || draftDialogIndex === -1
    || editorPopupIndex === -1
    || postwriteGuardIndex > draftDialogIndex
    || postwriteGuardIndex > editorPopupIndex
  ) {
    failed = true;
    console.error("src/lib/naverPublisher.js: waitForPostWriteTitle must check postwrite URL before editor popup handling");
  }
}
const articleInsert = extractFunctionBlock(sourceFiles.naverPublisher, "async function insertArticleWithImages", "insertArticleWithImages function");
if (articleInsert && !articleInsert.content.includes("const bodyTypingLog = () => {};")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: sentence-level body typing logs must be suppressed during publishing");
}
if (articleInsert && (!articleInsert.content.includes("본문 글쓰기 시작") || !articleInsert.content.includes("본문 글쓰기 완료"))) {
  failed = true;
  console.error("src/lib/naverPublisher.js: body publishing should log one start and one completion message");
}
if (articleInsert && !articleInsert.content.includes("typeBodyParagraph(page, block.text, options, bodyTypingLog)")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: paragraph typing must use the quiet bodyTypingLog during publishing");
}
const postwriteUrlHelper = extractFunctionBlock(sourceFiles.naverPublisher, "function looksLikePostWriteUrl", "looksLikePostWriteUrl function");
if (postwriteUrlHelper && !postwriteUrlHelper.content.includes("new URL")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: looksLikePostWriteUrl must parse URL instead of using loose substring matching");
}
if (postwriteUrlHelper && !postwriteUrlHelper.content.includes("parsed.hostname === \"blog.naver.com\"")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: looksLikePostWriteUrl must require exact blog.naver.com host");
}
if (postwriteUrlHelper && !postwriteUrlHelper.content.includes("parsed.pathname")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: looksLikePostWriteUrl must validate pathname");
}
const postWriteUrlFor = extractFunctionBlock(sourceFiles.naverPublisher, "function postWriteUrlFor", "postWriteUrlFor function");
if (postWriteUrlFor && !postWriteUrlFor.content.includes("resolveBlogId(options)")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: postwrite URL must use blogId fallback helper");
}
const targetPostwriteHelper = extractFunctionBlock(sourceFiles.naverPublisher, "function matchesTargetPostWriteUrl", "target postwrite URL helper");
if (targetPostwriteHelper && !targetPostwriteHelper.content.includes("normalizePostWriteUrl(url) === normalizePostWriteUrl(targetUrl)")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: target postwrite URL helper must require exact target Blog ID URL");
}
const chromeLaunchOptions = extractFunctionBlock(sourceFiles.naverPublisher, "function chromeLaunchOptions", "Chrome launch options helper");
if (chromeLaunchOptions && !chromeLaunchOptions.content.includes("--hide-crash-restore-bubble")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: Chrome launch options must hide the crash restore bubble");
}
const chromeProfileClean = extractFunctionBlock(sourceFiles.naverPublisher, "function markChromeProfileClean", "Chrome profile clean helper");
if (chromeProfileClean && !chromeProfileClean.content.includes("exit_type = \"Normal\"")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: Chrome profile clean helper must mark profiles as normally exited");
}
if (!sourceFiles.accountStore.content.includes("blogId")) {
  failed = true;
  console.error("src/lib/accountStore.js: account store must preserve optional blogId");
}
if (!sourceFiles.rendererIndex.content.includes("id=\"startupNotice\"")) {
  failed = true;
  console.error("src/renderer/index.html: startup notice must be present for first-run guidance");
}
if (!sourceFiles.rendererApp.content.includes("STARTUP_NOTICE_KEY")) {
  failed = true;
  console.error("src/renderer/app.js: startup notice dismissal must be persisted");
}
if (!sourceFiles.main.content.includes("function detectChromeInstall")) {
  failed = true;
  console.error("src/main.js: app startup must detect whether local Chrome is installed");
}
if (!sourceFiles.main.content.includes("chrome: detectChromeInstall()")) {
  failed = true;
  console.error("src/main.js: initial data must include Chrome availability");
}
if (!sourceFiles.main.content.includes("chrome:installAndQuit")) {
  failed = true;
  console.error("src/main.js: missing Chrome flow must open Chrome install page and quit");
}
if (!sourceFiles.preload.content.includes("openChromeInstallAndQuit")) {
  failed = true;
  console.error("src/preload.js: renderer must be able to trigger Chrome install fallback");
}
if (!sourceFiles.rendererApp.content.includes("state.chrome.available === false")) {
  failed = true;
  console.error("src/renderer/app.js: startup notice confirm must branch when Chrome is missing");
}
if (!sourceFiles.rendererApp.content.includes("data-action=\"session\"")) {
  failed = true;
  console.error("src/renderer/app.js: account rows must expose per-account session check buttons");
}
if (!sourceFiles.rendererIndex.content.includes("<textarea id=\"categoryPublishPurpose\"")) {
  failed = true;
  console.error("src/renderer/index.html: category publish purpose must be a long textarea input");
}
if (!sourceFiles.rendererApp.content.includes("editingCategoryId")) {
  failed = true;
  console.error("src/renderer/app.js: category editing must track the category id being edited");
}
if (!sourceFiles.rendererApp.content.includes("data-action=\"edit\"")) {
  failed = true;
  console.error("src/renderer/app.js: category rows must expose an edit button");
}
if (!sourceFiles.rendererApp.content.includes("function clearCategoryForm")) {
  failed = true;
  console.error("src/renderer/app.js: category manager must be able to reset to new-category mode");
}
if (!sourceFiles.rendererApp.content.includes("const editingId = state.editingCategoryId")) {
  failed = true;
  console.error("src/renderer/app.js: category save must update by edit id instead of only by name");
}
const renderCategoriesBlock = extractFunctionBlock(sourceFiles.rendererApp, "function renderCategories", "renderCategories function");
if (renderCategoriesBlock && renderCategoriesBlock.content.includes("category.publishPurpose")) {
  failed = true;
  console.error("src/renderer/app.js: category publishPurpose must not be displayed in the category list summary");
}
if (sourceFiles.rendererIndex.content.includes("id=\"checkSessionButton\"")) {
  failed = true;
  console.error("src/renderer/index.html: session check should not be hidden inside the collapsed account manager");
}
if (!sourceFiles.rendererApp.content.includes("function wakeAutoDelay")) {
  failed = true;
  console.error("src/renderer/app.js: auto loop must be wakeable after session confirmation");
}
if (!sourceFiles.rendererApp.content.includes("wakeAutoDelay();")) {
  failed = true;
  console.error("src/renderer/app.js: successful session confirmation must wake the auto loop");
}
if (!sourceFiles.main.content.includes("blogId: account.blogId || account.naverId")) {
  failed = true;
  console.error("src/main.js: account session check must use blogId for postwrite URL when present");
}
if (!sourceFiles.main.content.includes("blogId = String(form.blogId || account.blogId || naverId).trim()")) {
  failed = true;
  console.error("src/main.js: job blogId must fall back to naverId when blogId is empty");
}
const insertQuoteBlock = extractFunctionBlock(sourceFiles.naverPublisher, "async function insertQuoteBlock", "insertQuoteBlock function");
if (insertQuoteBlock && /\bthrow\b/.test(insertQuoteBlock.content)) {
  failed = true;
  console.error("src/lib/naverPublisher.js: quote style failure must fall back instead of aborting publish");
}
if (insertQuoteBlock && !insertQuoteBlock.content.includes("일반 문단으로 입력합니다.")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: quote style fallback must continue with normal paragraph input");
}
const insertArticleWithImages = extractFunctionBlock(sourceFiles.naverPublisher, "async function insertArticleWithImages", "insertArticleWithImages function");
const insertSectionHeadingBlock = extractFunctionBlock(sourceFiles.naverPublisher, "async function insertSectionHeadingBlock", "insertSectionHeadingBlock function");
if (!sourceFiles.naverPublisher.content.includes("async function insertSectionHeadingBlock")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: section headings must be parsed from SECTION markers");
}
if (insertSectionHeadingBlock && !insertSectionHeadingBlock.content.includes("\"버티컬 라인\"")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: section headings must use Naver vertical-line quote blocks");
}
if (insertSectionHeadingBlock && !insertSectionHeadingBlock.content.includes("quiet: true")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: repeated section-heading quote logs must be suppressed during body writing");
}
if (insertArticleWithImages && !sourceFiles.naverPublisher.content.includes("\\]?$/i")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: SECTION marker parser must tolerate a missing closing bracket");
}
const clearAiMark = extractFunctionBlock(sourceFiles.naverPublisher, "async function clearAiMarkForLatestImage", "AI image mark helper");
if (clearAiMark && !clearAiMark.content.includes(".se-set-ai-mark-button.se-is-selected")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: AI image mark helper must target selected Naver AI mark toggles");
}
if (clearAiMark && /\bthrow\b/.test(clearAiMark.content)) {
  failed = true;
  console.error("src/lib/naverPublisher.js: AI image mark helper must log and continue instead of throwing");
}
const publishToNaver = extractFunctionBlock(sourceFiles.naverPublisher, "async function publishToNaver", "publishToNaver function");
if (publishToNaver && !publishToNaver.content.includes("발행 단계에서 블로그 글쓰기 URL로 다시 접근했습니다.")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: prepared publish sessions must navigate to postwrite before waiting for editor");
}
if (publishToNaver && !publishToNaver.content.includes("await completeLoginIfNeeded(page, selectors, options, log);")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: prepared publish sessions must re-check login state after navigating to postwrite");
}
if (publishToNaver) {
  const preparedBranchIndex = publishToNaver.content.indexOf("if (options.preparedContext)");
  const preparedGotoIndex = publishToNaver.content.indexOf("발행 단계에서 블로그 글쓰기 URL로 다시 접근했습니다.");
  const editorWaitIndex = publishToNaver.content.indexOf("waitForPostWriteTitle");
  const publishClickIndex = publishToNaver.content.indexOf("clickFirstVisible(page, selectors.publishButton");
  if (
    preparedBranchIndex === -1
    || preparedGotoIndex === -1
    || editorWaitIndex === -1
    || !(preparedBranchIndex < preparedGotoIndex && preparedGotoIndex < editorWaitIndex)
  ) {
    failed = true;
    console.error("src/lib/naverPublisher.js: prepared publish sessions must navigate to postwrite before waitForPostWriteTitle");
  }
  if (publishClickIndex === -1) {
    failed = true;
    console.error("src/lib/naverPublisher.js: publishToNaver must open publish settings via clickFirstVisible fallback helper");
  }
  if (!publishToNaver.content.includes("clearAiMarkForLatestImage(page, log")) {
    failed = true;
    console.error("src/lib/naverPublisher.js: title image insertion must attempt to clear Naver AI image mark");
  }
}
if (!sourceFiles.naverPublisher.content.includes("[role='button']:has-text('발행')")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: publishButton selector should include role=button fallback");
}

if (insertArticleWithImages && !insertArticleWithImages.content.includes("clearAiMarkForLatestImage(page, log")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: body image insertion must attempt to clear Naver AI image mark");
}
assertCondition(
  sourceFiles.imageAssets.content.includes("function deleteGeneratedImages")
    && sourceFiles.imageAssets.content.includes("path.relative(imageRoot, resolved)")
    && sourceFiles.main.content.includes("deleteGeneratedImages(runtimeRoot, agentResult)")
    && sourceFiles.main.content.includes("글 작성 완료 후 생성 이미지"),
  "generated images must be deleted safely after successful Naver writing"
);
assertCondition(
  sourceFiles.main.content.includes("[글 작성 중]")
    && sourceFiles.main.content.includes("[글 작성 완료]")
    && sourceFiles.main.content.includes("[네이버 입력 중]")
    && sourceFiles.main.content.includes("[발행 완료]")
    && sourceFiles.main.content.includes("[단순 저장 완료]"),
  "main job flow must log clear writing, publishing, and draft-only states"
);
assertCondition(
  sourceFiles.rendererApp.content.includes("function logNextArticleWait")
    && sourceFiles.rendererApp.content.includes("[다음 글 대기 중]"),
  "automatic publishing must log when it is waiting to write the next article"
);
const safeClickLocator = extractFunctionBlock(sourceFiles.naverPublisher, "async function safeClickLocator", "safe click helper");
const dismissBlockingEditorPopup = extractFunctionBlock(sourceFiles.naverPublisher, "async function dismissBlockingEditorPopup", "blocking editor popup helper");
const insertImageByButton = extractFunctionBlock(sourceFiles.naverPublisher, "async function insertImageByButton", "image insertion helper");
if (
  safeClickLocator
  && (!safeClickLocator.content.includes("dismissBlockingEditorPopup")
    || !safeClickLocator.content.includes("force: true"))
) {
  failed = true;
  console.error("src/lib/naverPublisher.js: blocked clicks must dismiss editor popups and retry with force");
}
if (
  dismissBlockingEditorPopup
  && (!dismissBlockingEditorPopup.content.includes("keyboard.press(\"Escape\")")
    || !dismissBlockingEditorPopup.content.includes(".se-popup-dim"))
) {
  failed = true;
  console.error("src/lib/naverPublisher.js: editor popup dismissal must use Escape and popup dim fallback");
}
if (insertImageByButton && !insertImageByButton.content.includes("clickLocatorResilient")) {
  failed = true;
  console.error("src/lib/naverPublisher.js: image insertion must use resilient image-button clicking");
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax check passed for ${targets.length} JavaScript files.`);
