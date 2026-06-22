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

const CATEGORY_SECTION_MAP = {
  "전체": null,
  "엔터 종합": "엔터 종합",
  "여행맛집 종합": "여행맛집 종합",
  "패션뷰티 종합": "패션뷰티 종합",
  "리빙푸드 종합": "리빙푸드 종합",
  "증권": "증권",
  "스포츠 종합": "스포츠 종합",
  "국내여행": "국내여행",
  "카테크 종합": "카테크 종합",
  "자동차": "카테크 종합",
  "영화": "영화",
  "드라마": "드라마",
  "맛집/카페": "맛집/카페",
  "부동산": "부동산",
  "해외축구": "해외축구",
  "푸드": "푸드",
  "야구": "야구",
  "세계여행": "세계여행",
  "패션트렌드": "패션트렌드",
  "농구": "농구",
  "경제 종합": "경제 종합",
  "해외야구": "해외야구",
  "축구": "축구",
  "게임": "게임",
  "뷰티": "뷰티",
  "뮤직": "뮤직",
  "배구": "배구",
  "지식 종합": "지식 종합",
  "생활경제": "생활경제"
};

const CATEGORY_QUERY_VARIANTS = {
  "전체": ["오늘 인기 키워드", "네이버 숏텐츠 인기"],
  "엔터 종합": ["엔터", "연예", "방송", "연예인"],
  "여행맛집 종합": ["여행맛집", "여행 맛집 추천", "국내여행 맛집", "카페 추천"],
  "패션뷰티 종합": ["패션뷰티", "패션", "뷰티", "여름 코디"],
  "리빙푸드 종합": ["리빙푸드", "요리 레시피", "집밥 레시피", "살림"],
  "증권": ["증권", "주식", "코스피", "반도체 주식", "환율"],
  "스포츠 종합": ["스포츠", "야구 축구", "프로야구", "축구", "농구"],
  "국내여행": ["국내여행", "주말여행", "국내 여행지", "여행 코스"],
  "카테크 종합": ["카테크", "자동차", "신차", "전기차", "IT 신제품"],
  "자동차": ["자동차", "신차", "전기차", "중고차", "자동차 추천"],
  "영화": ["영화", "개봉 영화", "영화 추천", "박스오피스"],
  "드라마": ["드라마", "한국 드라마", "OTT 드라마", "드라마 추천"],
  "맛집/카페": ["맛집", "카페", "서울 맛집", "디저트 카페", "지역 맛집"],
  "부동산": ["부동산", "아파트", "분양", "전세", "집값"],
  "해외축구": ["해외축구", "프리미어리그", "손흥민", "축구 이적"],
  "푸드": ["푸드", "요리 레시피", "집밥", "반찬 레시피", "디저트 만들기", "간단요리"],
  "야구": ["야구", "프로야구", "KBO", "메이저리그"],
  "세계여행": ["세계여행", "해외여행", "유럽여행", "일본여행"],
  "패션트렌드": ["패션트렌드", "여름 패션", "코디", "데일리룩"],
  "농구": ["농구", "프로농구", "NBA", "KBL"],
  "경제 종합": ["경제", "금리", "환율", "물가", "부동산 경제"],
  "해외야구": ["해외야구", "메이저리그", "MLB", "오타니"],
  "축구": ["축구", "K리그", "월드컵", "축구 경기"],
  "게임": ["게임", "신작 게임", "모바일 게임", "게임 업데이트"],
  "뷰티": ["뷰티", "화장품", "스킨케어", "메이크업"],
  "뮤직": ["뮤직", "음악", "아이돌", "콘서트", "신곡"],
  "배구": ["배구", "프로배구", "V리그", "여자배구"],
  "지식 종합": ["지식", "생활정보", "건강정보", "상식"],
  "생활경제": ["생활경제", "지원금", "절약", "물가", "재테크"]
};

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
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
          reject(new Error(`Naver short contents request failed with status ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Naver short contents request timed out"));
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

function uniqueTitles(titles) {
  const seen = new Set();
  return titles
    .map(cleanTitle)
    .filter((title) => title.length >= 4 && title.length <= 80)
    .filter((title) => !/^(Keep|VIEW|이미지|동영상|뉴스|블로그)$/.test(title))
    .filter((title) => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function categoryQuery(categoryName) {
  const category = String(categoryName || "").trim();
  const variants = CATEGORY_QUERY_VARIANTS[category];
  return variants?.[0] || category || "네이버 숏텐츠";
}

function categoryQueries(categoryName) {
  const category = String(categoryName || "").trim();
  const baseQueries = CATEGORY_QUERY_VARIANTS[category] || [categoryQuery(category)];
  return [...new Set(baseQueries.map((query) => query.trim()).filter(Boolean))];
}

function shortContentsUrl(query, categoryName) {
  const params = new URLSearchParams({
    query,
    sm: categoryName && categoryName !== "전체" ? "mtb_sht.ctg" : "mtb_jum",
    ssc: "tab.m_shortents.all"
  });
  if (categoryName && categoryName !== "전체") {
    params.set("category", categoryName);
  }
  return `https://m.search.naver.com/search.naver?${params.toString()}`;
}

function extractSections(html) {
  const sections = [];
  let current = null;
  const sectionOrTitlePattern = /<span[^>]*class="[^"]*sds-comps-text-type-(body2|headline2)[^"]*sds-comps-text-weight-xl[^"]*"[^>]*>([\s\S]*?)<\/span>/g;

  for (const match of String(html || "").matchAll(sectionOrTitlePattern)) {
    const type = match[1];
    const text = cleanTitle(match[2]);
    if (!text) continue;

    if (type === "body2") {
      current = { name: text, titles: [] };
      sections.push(current);
      continue;
    }

    if (current) {
      current.titles.push(text);
    }
  }

  return sections.map((section) => ({
    name: section.name,
    titles: uniqueTitles(section.titles)
  }));
}

function extractNaverTitles(html) {
  const directTitles = [...String(html || "").matchAll(
    /<span[^>]*class="[^"]*sds-comps-text-type-headline2[^"]*sds-comps-text-weight-xl[^"]*"[^>]*>([\s\S]*?)<\/span>/g
  )].map((match) => match[1]);

  if (directTitles.length > 0) {
    return uniqueTitles(directTitles).slice(0, 20);
  }

  return uniqueTitles(extractSections(html).flatMap((section) => section.titles)).slice(0, 20);
}

function sectionNameForCategory(categoryName) {
  const category = String(categoryName || "").trim();
  return CATEGORY_SECTION_MAP[category] ?? category;
}

function pickTitlesForCategory(html, categoryName) {
  const targetSectionName = sectionNameForCategory(categoryName);
  const sections = extractSections(html);

  if (!targetSectionName) {
    return uniqueTitles(sections.flatMap((section) => section.titles));
  }

  const exactSection = sections.find((section) => section.name === targetSectionName);
  if (exactSection) return exactSection.titles;

  const partialSection = sections.find((section) => {
    return section.name.includes(targetSectionName) || targetSectionName.includes(section.name);
  });
  return partialSection ? partialSection.titles : [];
}

function listShortContentCategories() {
  return {
    source: "naver-shortcontents",
    categories: SHORT_CONTENT_CATEGORIES.map((name, index) => ({
      id: `short_${index + 1}`,
      name
    }))
  };
}

async function listShortContentTitles(categoryName) {
  const category = String(categoryName || "").trim();
  const titles = [];

  for (const query of categoryQueries(category)) {
    if (titles.length >= 20) break;
    const html = await requestText(shortContentsUrl(query, category));
    titles.push(...extractNaverTitles(html));
    titles.splice(0, titles.length, ...uniqueTitles(titles).slice(0, 20));
  }

  return {
    source: "naver-shortcontents",
    category,
    query: categoryQuery(category),
    titles: uniqueTitles(titles).slice(0, 20).map((title, index) => ({
      id: `short_title_${index + 1}`,
      title
    }))
  };
}

module.exports = {
  SHORT_CONTENT_CATEGORIES,
  categoryQuery,
  extractNaverTitles,
  extractSections,
  listShortContentCategories,
  listShortContentTitles
};
