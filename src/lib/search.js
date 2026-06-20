const http = require("node:http");
const https = require("node:https");

const MAX_RESPONSE_CHARS = 1_500_000;
const MAX_EXCERPT_CHARS = 1400;
const MAX_SELECTED_CONTENT_RESULTS = 20;
const CONTENT_FETCH_CONCURRENCY = 4;
const CANDIDATE_FETCH_TIMEOUT_MS = 20000;

const AD_WORDS = [
  "ad",
  "ads",
  "shopping",
  "mall",
  "sponsor",
  "sponsored",
  "파워링크",
  "광고",
  "쇼핑",
  "구매",
  "최저가"
];

const STOP_WORDS = new Set([
  "그리고",
  "그러나",
  "하지만",
  "정보",
  "관련",
  "최신",
  "현재",
  "오늘",
  "기준",
  "확인",
  "방법",
  "안내",
  "바로가기",
  "공식",
  "뉴스",
  "블로그",
  "또는",
  "이내",
  "가능한",
  "정보를",
  "중심으로",
  "있습니다",
  "합니다",
  "서비스",
  "홈페이지",
  "본문",
  "바로",
  "가기",
  "naver",
  "google",
  "www",
  "com",
  "html",
  "https",
  "http"
]);

const CURRENT_FACT_PATTERN = /(모집|채용|접수|신청\s*기간|신청기간|지원\s*대상|지원대상|대상\s*연령|대상연령|신청\s*조건|신청조건|참여\s*대상|참여대상|사업\s*기간|사업기간|운영\s*기간|운영기간|마감|공고|자격|선발|교육\s*기간|교육기간)/i;
const LOW_TRUST_DOMAIN_PATTERN = /(blogspot\.com|tistory\.com|wordpress\.com|blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|brunch\.co\.kr|post\.naver\.com)/i;
const OFFICIAL_DOMAIN_PATTERN = /(^|\.)go\.kr$/i;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = /^http:\/\//i.test(url) ? http : https;
    const request = client.get(url, {
      headers: {
        "user-agent": "Mozilla/5.0 NaverBlogAutomator/0.1",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7"
      },
      timeout: 12000
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchText(new URL(response.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_RESPONSE_CHARS) {
          request.destroy(new Error("본문이 너무 커서 일부 후보를 건너뜁니다."));
        }
      });
      response.on("end", () => resolve(body));
    });
    request.on("timeout", () => request.destroy(new Error("검색 요청 시간이 초과되었습니다.")));
    request.on("error", reject);
  });
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, num) => String.fromCharCode(parseInt(num, 10)));
}

function stripTags(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyAd(text, url) {
  const joined = `${text} ${url}`.toLowerCase();
  return AD_WORDS.some((word) => joined.includes(word.toLowerCase()));
}

function isLowValueResult(text, url) {
  const joined = `${text} ${url}`.toLowerCase();
  if (/검색옵션|검색\s*고객센터|개인정보처리방침|©|naver corp|도움말|고객센터/i.test(text)) {
    return true;
  }
  if (/policy\.naver\.com|help\.naver\.com|www\.navercorp\.com/i.test(url)) {
    return true;
  }
  if (/\b(friend1004|jupiter\d+|apollon\d+|dionysus\d+)\.com\b/i.test(url)) {
    return true;
  }
  return /\/privacy|\/policy|\/help/i.test(joined);
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isOfficialDomain(url) {
  const host = hostFromUrl(url);
  return OFFICIAL_DOMAIN_PATTERN.test(host);
}

function isLowTrustDomain(url) {
  return LOW_TRUST_DOMAIN_PATTERN.test(hostFromUrl(url));
}

function splitKeywordPhrases(keyword) {
  return String(keyword || "")
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !STOP_WORDS.has(item.toLowerCase()))
    .slice(0, 12);
}

function evidenceText(options) {
  return [
    options.topic,
    options.keyword,
    options.category,
    options.publishPurpose,
    options.researchGuidance
  ].filter(Boolean).join(" ");
}

function requiresStrictSourceEvidence(options) {
  const searchNeed = String(options.searchNeed || "").toLowerCase();
  if (!["strict", "normal"].includes(searchNeed)) return false;
  const text = evidenceText(options);
  return /(모집|채용|접수|신청|공고|지원금|고용지원|취업지원|정책|교육|훈련|대상|자격|마감|기간|공식|현재\s*유효|운영\s*중|신뢰\s*가능)/i.test(text);
}

function buildSearchProfile(options) {
  return {
    strictEvidence: requiresStrictSourceEvidence(options),
    keywordPhrases: splitKeywordPhrases(options.keyword)
  };
}

function candidateSignals(candidate, profile) {
  const text = `${candidate.title || ""} ${candidate.excerpt || ""}`;
  const lower = text.toLowerCase();
  const phraseMatches = profile.keywordPhrases
    .filter((phrase) => lower.includes(phrase.toLowerCase()))
    .slice(0, 10);
  return {
    officialSource: profile.strictEvidence && isOfficialDomain(candidate.url),
    lowTrustSource: profile.strictEvidence && isLowTrustDomain(candidate.url),
    currentFactSignal: profile.strictEvidence && CURRENT_FACT_PATTERN.test(text),
    phraseMatches
  };
}

function parseLinks(html, provider) {
  const results = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) && results.length < 40) {
    let url = match[1];
    const title = stripTags(match[2]);
    if (!title || title.length < 6) continue;
    if (provider === "google" && url.startsWith("/url?")) {
      const parsed = new URL(url, "https://www.google.com");
      url = parsed.searchParams.get("q") || "";
    }
    if (provider === "naver" && url.startsWith("/")) {
      url = new URL(url, "https://search.naver.com").toString();
    }
    if (!/^https?:\/\//i.test(url)) continue;
    if (isLikelyAd(title, url)) continue;
    if (isLowValueResult(title, url)) continue;
    const key = url.replace(/[#?].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ provider, title, url });
  }
  return results;
}

function findNaverBlogFrame(html, url) {
  if (!/blog\.naver\.com/i.test(url)) return "";
  const match = String(html || "").match(/<iframe[^>]+(?:id|name)=["']?mainFrame["']?[^>]+src=["']([^"']+)["']/i)
    || String(html || "").match(/<iframe[^>]+src=["']([^"']*PostView[^"']+)["']/i);
  if (!match) return "";
  return new URL(decodeEntities(match[1]), "https://blog.naver.com").toString();
}

function mobileNaverBlogUrl(url) {
  const match = String(url || "").match(/^https?:\/\/blog\.naver\.com\/([^/?#]+)\/(\d+)/i);
  if (!match) return "";
  return `https://m.blog.naver.com/${match[1]}/${match[2]}`;
}

function extractMetaDescription(html) {
  const match = String(html || "").match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)
    || String(html || "").match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  return match ? stripTags(match[1]) : "";
}

function extractReadableText(html) {
  const withoutNoise = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi, " ");

  const preferredBlocks = [];
  const preferredRegex = /<(article|main|section|div|p)\b[^>]*(?:se-main-container|se_component_wrap|post_ct|post-view|article|content|entry|본문|view|post)[^>]*>([\s\S]*?)<\/\1>/gi;
  let block;
  while ((block = preferredRegex.exec(withoutNoise)) && preferredBlocks.length < 8) {
    const text = stripTags(block[2]);
    if (text.length > 120) preferredBlocks.push(text);
  }

  const text = preferredBlocks.length
    ? preferredBlocks.join("\n")
    : stripTags(withoutNoise);
  return text
    .replace(/\s*(공감|댓글|스크랩|공유하기|이 블로그|카테고리 글)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const text = String(value || "").toLowerCase();
  const tokens = text.match(/[가-힣a-z0-9]{2,}/g) || [];
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .slice(0, 80);
}

function tokenCounts(items) {
  const counts = new Map();
  for (const item of items) {
    for (const token of new Set(tokenize(item))) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return counts;
}

function selectCommonTokens(candidates, options) {
  const counts = tokenCounts(candidates.map((item) => `${item.title} ${item.excerpt || ""}`));
  const topicTokens = new Set(tokenize(options.topic || ""));
  const keywordTokens = new Set(tokenize(options.keyword || ""));
  return [...counts.entries()]
    .map(([token, count]) => ({
      token,
      score: count + (topicTokens.has(token) ? 4 : 0) + (keywordTokens.has(token) ? 1 : 0)
    }))
    .filter((item) => item.score >= 2 || topicTokens.has(item.token) || keywordTokens.has(item.token))
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((item) => item.token);
}

function scoreCandidate(candidate, commonTokens, options, profile = buildSearchProfile(options)) {
  const textTokens = new Set(tokenize(`${candidate.title} ${candidate.excerpt || ""}`));
  const topicTokens = new Set(tokenize(options.topic || ""));
  const keywordTokens = new Set(tokenize(options.keyword || ""));
  const signals = candidateSignals(candidate, profile);
  let score = 0;
  const matchedTerms = [];
  const topicMatchedTerms = [];
  const keywordMatchedTerms = [];

  for (const token of commonTokens) {
    if (textTokens.has(token)) {
      score += 1;
      matchedTerms.push(token);
    }
  }
  for (const token of topicTokens) {
    if (textTokens.has(token)) {
      score += 6;
      if (!matchedTerms.includes(token)) matchedTerms.push(token);
      topicMatchedTerms.push(token);
    }
  }
  for (const token of keywordTokens) {
    if (textTokens.has(token)) {
      score += 1;
      if (!matchedTerms.includes(token)) matchedTerms.push(token);
      keywordMatchedTerms.push(token);
    }
  }
  for (const phrase of signals.phraseMatches) {
    score += 4;
    if (!matchedTerms.includes(phrase)) matchedTerms.push(phrase);
    if (!keywordMatchedTerms.includes(phrase)) keywordMatchedTerms.push(phrase);
  }
  if (signals.officialSource) score += 5;
  if (signals.currentFactSignal) score += 4;
  if (signals.lowTrustSource) score -= 4;
  if ((candidate.excerpt || "").length > 180) score += 2;
  return {
    score,
    matchedTerms: matchedTerms.slice(0, 10),
    topicMatchedTerms: topicMatchedTerms.slice(0, 10),
    keywordMatchedTerms: keywordMatchedTerms.slice(0, 10),
    officialSource: signals.officialSource,
    lowTrustSource: signals.lowTrustSource,
    currentFactSignal: signals.currentFactSignal,
    strictEvidence: profile.strictEvidence
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchCandidateContent(candidate) {
  const attempts = [candidate.url];
  const mobileUrl = mobileNaverBlogUrl(candidate.url);
  if (mobileUrl) attempts.push(mobileUrl);

  for (const attemptUrl of attempts) {
    try {
      let html = await withTimeout(
        fetchText(attemptUrl),
        CANDIDATE_FETCH_TIMEOUT_MS,
        "본문 추출 후보 요청 시간이 초과되었습니다."
      );
      const frameUrl = findNaverBlogFrame(html, attemptUrl);
      if (frameUrl) {
        html = await withTimeout(
          fetchText(frameUrl),
          CANDIDATE_FETCH_TIMEOUT_MS,
          "네이버 블로그 본문 프레임 요청 시간이 초과되었습니다."
        );
      }
      const description = extractMetaDescription(html);
      const readable = extractReadableText(html);
      const text = readable.length >= 160 ? readable : description;
      if (text && text.length >= 80) {
        return {
          ...candidate,
          fetchedUrl: attemptUrl,
          contentLength: text.length,
          excerpt: text.slice(0, MAX_EXCERPT_CHARS)
        };
      }
    } catch {
      // Try the next URL form.
    }
  }

  return {
    ...candidate,
    fetchedUrl: "",
    contentLength: 0,
    excerpt: ""
  };
}

function buildSearchUrl(provider, template, topic, keyword, topicMode, querySuffix = "") {
  const hasManualTopic = String(topicMode || "manual") !== "auto" && String(topic || "").trim();
  const queryText = [
    hasManualTopic ? String(topic || "").trim() : [topic, keyword].filter(Boolean).join(" "),
    querySuffix
  ].filter(Boolean).join(" ");
  const query = encodeURIComponent(queryText);
  if (template && template.includes("{query}")) {
    return template.replace("{query}", query);
  }
  if (provider === "naver") {
    return `https://search.naver.com/search.naver?where=web&query=${query}`;
  }
  return `https://www.google.com/search?q=${query}&num=20&hl=ko`;
}

async function providerSearch(provider, options, querySuffix = "") {
  const template = provider === "naver" ? options.naverSearchUrl : options.googleSearchUrl;
  const url = buildSearchUrl(provider, template, options.topic, options.keyword, options.topicMode, querySuffix);
  const html = await fetchText(url);
  return parseLinks(html, provider);
}

function isStrongCandidate(item, profile) {
  if (!profile.strictEvidence) return Number(item?.relevance?.score || 0) >= 3;
  const relevance = item.relevance || {};
  const hasDirectKeyword = Array.isArray(relevance.keywordMatchedTerms) && relevance.keywordMatchedTerms.length > 0;
  return relevance.officialSource === true
    && relevance.currentFactSignal === true
    && hasDirectKeyword
    && Number(relevance.score || 0) >= 8;
}

function focusedOfficialSearchSuffix(options, profile) {
  if (!profile.strictEvidence) return "";
  const phrases = profile.keywordPhrases.slice(0, 4).join(" ");
  const topic = String(options.topic || "").replace(/\s+/g, " ").trim().slice(0, 90);
  return [topic, phrases, "모집 신청기간 대상 자격 공고 site:go.kr"]
    .filter(Boolean)
    .join(" ")
    .slice(0, 220);
}

async function collectProviderCandidates(providers, options, log, querySuffix = "") {
  const all = [];
  for (const provider of providers) {
    if (!["naver", "google"].includes(provider)) continue;
    try {
      log(`${provider.toUpperCase()} 검색을 시도합니다.`);
      const results = await providerSearch(provider, options, querySuffix);
      all.push(...results);
    } catch (error) {
      log(`${provider.toUpperCase()} 검색 실패: ${error.message}`);
    }
    if (all.length >= 20) break;
  }
  return all;
}

async function collectSearchResults(options, log = () => {}) {
  const primary = String(options.primaryProvider || "naver").toLowerCase();
  const fallback = String(options.fallbackProvider || "google").toLowerCase();
  const providers = [primary, fallback];
  const profile = buildSearchProfile(options);
  let all = await collectProviderCandidates(providers, options, log);

  const seen = new Set();
  let candidates = all
    .filter((item) => {
      const key = item.url.replace(/[#?].*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  if (!candidates.length) return [];

  const enrichAndScore = async (items) => {
    log(`검색 후보 ${items.length}개 본문 추출을 시도합니다.`);
    let completed = 0;
    const enriched = await mapLimit(
      items,
      CONTENT_FETCH_CONCURRENCY,
      async (candidate) => {
        const result = await fetchCandidateContent(candidate);
        completed += 1;
        if (completed === 1 || completed % 2 === 0 || completed === items.length) {
          log(`본문 추출 진행: ${completed}/${items.length}`);
        }
        return result;
      }
    );
    const validEnriched = enriched.filter(Boolean);
    const withContent = validEnriched.filter((item) => String(item.excerpt || "").trim().length >= 80);
    if (!withContent.length) return { selected: [], withContent: [] };
    const commonTokens = selectCommonTokens(withContent, options);
    const scored = withContent
    .map((item) => {
      const relevance = scoreCandidate(item, commonTokens, options, profile);
      return { ...item, relevance };
    })
    .filter((item) => {
      const hasTopicTokens = tokenize(options.topic || "").length > 0;
      return item.relevance.score >= 3 && (!hasTopicTokens || item.relevance.topicMatchedTerms.length > 0);
    })
    .sort((a, b) => b.relevance.score - a.relevance.score)
    .slice(0, MAX_SELECTED_CONTENT_RESULTS);

    const hasManualTopic = String(options.topicMode || "manual") !== "auto" && tokenize(options.topic || "").length > 0;
    const selected = scored.length
      ? scored
      : hasManualTopic
        ? []
        : withContent.slice(0, MAX_SELECTED_CONTENT_RESULTS);
    return { selected, withContent };
  };

  let { selected, withContent } = await enrichAndScore(candidates);
  if (profile.strictEvidence && !selected.some((item) => isStrongCandidate(item, profile))) {
    const suffix = focusedOfficialSearchSuffix(options, profile);
    if (suffix) {
      log("현재성/공식 근거가 필요한 검색으로 판단되어 공식 후보 중심으로 보강 검색합니다.", "info");
      const refined = await collectProviderCandidates(providers, options, log, suffix);
      for (const item of refined) {
        const key = item.url.replace(/[#?].*$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(item);
      }
      candidates = candidates.slice(0, 20);
      ({ selected, withContent } = await enrichAndScore(candidates));
    }
  }

  if (!withContent.length) {
    log("본문 추출에 성공한 후보가 없어 제목/URL 후보만 사용합니다.", "warn");
    return candidates;
  }
  log(`본문 추출 ${withContent.length}개, 공통 주제 후보 ${selected.length}개를 사용합니다.`);
  return selected.map((item, index) => ({
    sourceId: `${item.provider || "source"}-${index + 1}`,
    provider: item.provider,
    title: item.title,
    url: item.url,
    fetchedUrl: item.fetchedUrl,
    contentLength: item.contentLength,
    excerpt: item.excerpt,
    relevance: item.relevance || { score: 0, matchedTerms: [] }
  }));
}

module.exports = {
  collectSearchResults
};
