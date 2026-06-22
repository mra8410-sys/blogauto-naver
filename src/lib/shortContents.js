const https = require("node:https");

const SHORT_CONTENT_CATEGORIES = [
  "전체",
  "엔터 종합",
  "여행맛집 종합",
  "패션뷰티 종합",
  "리빙푸드 종합",
  "증권",
  "스포츠 종합",
  "국내여행",
  "카테크 종합",
  "자동차",
  "영화",
  "드라마",
  "맛집/카페",
  "부동산",
  "해외축구",
  "푸드",
  "야구",
  "세계여행",
  "패션트렌드",
  "농구",
  "경제 종합",
  "해외야구",
  "축구",
  "게임",
  "뷰티",
  "뮤직",
  "배구",
  "지식 종합",
  "생활경제"
];

const CATEGORY_QUERY_MAP = {
  "전체": "오늘 주요 뉴스",
  "엔터 종합": "연예 방송 뉴스",
  "여행맛집 종합": "여행 맛집 뉴스",
  "패션뷰티 종합": "패션 뷰티 트렌드",
  "리빙푸드 종합": "리빙 푸드 뉴스",
  "스포츠 종합": "스포츠 뉴스",
  "국내여행": "국내여행 뉴스",
  "카테크 종합": "자동차 테크 뉴스",
  "맛집/카페": "맛집 카페 뉴스",
  "세계여행": "세계여행 뉴스",
  "패션트렌드": "패션 트렌드 뉴스",
  "경제 종합": "경제 뉴스",
  "지식 종합": "생활 지식 뉴스",
  "생활경제": "생활경제 뉴스"
};

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
      },
      timeout: 12000
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Naver request failed with status ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Naver request timed out"));
    });
    request.on("error", reject);
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<mark>/gi, "")
    .replace(/<\/mark>/gi, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanTitle(value) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryQuery(categoryName) {
  const category = String(categoryName || "").trim();
  return CATEGORY_QUERY_MAP[category] || `${category.replace(/\s*종합\s*$/u, "").trim()} 뉴스`;
}

function categoryQueryVariants(categoryName) {
  const category = String(categoryName || "").trim();
  const base = category.replace(/\s*종합\s*$/u, "").trim();
  const seen = new Set();
  return [
    categoryQuery(category),
    `${base} 주요 뉴스`,
    `${base} 인기 뉴스`,
    `${base} 이슈`
  ]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((query) => {
      const key = query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function uniqueTitles(titles) {
  const seen = new Set();
  return titles
    .map(cleanTitle)
    .filter((title) => title.length >= 8 && title.length <= 90)
    .filter((title) => !/^(검색옵션|옵션|Keep|관련문서|뉴스검색|직접입력)/.test(title))
    .filter((title) => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractNewsTitles(html) {
  const titleSpans = [...String(html || "").matchAll(
    /<span[^>]*class="[^"]*sds-comps-text-type-headline1[^"]*"[^>]*>([\s\S]*?)<\/span>/g
  )].map((match) => match[1]);

  const linkTitles = [...String(html || "").matchAll(
    /<a[^>]*data-heatmap-target="\.tit"[^>]*>([\s\S]*?)<\/a>/g
  )].map((match) => match[1]);

  return uniqueTitles([...titleSpans, ...linkTitles]).slice(0, 20);
}

function listShortContentCategories() {
  return {
    source: "reference-shortcontents",
    categories: SHORT_CONTENT_CATEGORIES.map((name, index) => ({
      id: `short_${index + 1}`,
      name
    }))
  };
}

async function listShortContentTitles(categoryName) {
  const category = String(categoryName || "").trim();
  const query = categoryQuery(category);
  const titles = [];
  for (const queryVariant of categoryQueryVariants(category)) {
    if (titles.length >= 20) break;
    for (const start of [1, 11, 21]) {
      if (titles.length >= 20) break;
      const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(queryVariant)}&start=${start}`;
      const html = await requestText(url);
      titles.push(...extractNewsTitles(html));
      titles.splice(0, titles.length, ...uniqueTitles(titles).slice(0, 20));
    }
  }
  const unique = uniqueTitles(titles).slice(0, 20);
  return {
    source: "naver-news-search",
    category,
    query,
    titles: unique.map((title, index) => ({
      id: `short_title_${index + 1}`,
      title
    }))
  };
}

module.exports = {
  SHORT_CONTENT_CATEGORIES,
  categoryQuery,
  extractNewsTitles,
  listShortContentCategories,
  listShortContentTitles
};
