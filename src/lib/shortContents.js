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

const CATEGORY_TITLE_SEEDS = {
  "증권": [
    "SK하이닉스 주가 110~270만원 전망",
    "코스피 9070선 회복, 개미 1조 매수",
    "원화 환율 1530.9원 개장 상승",
    "LG전자 엔비디아 협력 기대감",
    "국제유가 30% 하락, 국내 기름값 2000원대",
    "코스닥 소부장 반도체 20위권 진입",
    "삼성전자 외국인 매수세 재개",
    "2차전지주 반등, 수급 개선 기대",
    "미국 금리 인하 전망에 성장주 강세",
    "조선주 수주 기대감에 동반 상승"
  ],
  "스포츠 종합": [
    "주말 프로야구 순위 경쟁 본격화",
    "축구 대표팀 새 전술 실험 관심",
    "프로농구 FA 시장 주요 선수 이동",
    "배구 리그 외국인 선수 교체 변수",
    "손흥민 다음 시즌 거취 관심 집중",
    "국내 골프 신예 선수 우승 경쟁",
    "올림픽 종목 대표 선발전 열기",
    "프로야구 신인 투수 돌풍",
    "K리그 여름 이적시장 전망",
    "스포츠 스타 브랜드 협업 확대"
  ],
  "경제 종합": [
    "물가 안정 흐름 속 금리 전망 주목",
    "자영업 경기 체감지수 회복 기대",
    "환율 변동에 수입 물가 부담 확대",
    "부동산 대출 규제 변화 관심",
    "전기요금 인상 가능성 다시 부각",
    "청년 지원 정책 신청 일정 확인",
    "소비 쿠폰 효과 지역상권 기대",
    "반도체 수출 회복세 경제 지표 개선",
    "유가 하락이 물가에 미치는 영향",
    "하반기 경제정책 방향 핵심 정리"
  ],
  "방송": [
    "새 예능 프로그램 첫 방송 반응",
    "드라마 시청률 경쟁 구도 변화",
    "OTT 오리지널 콘텐츠 흥행 전망",
    "방송가 파일럿 프로그램 편성 확대",
    "인기 MC 새 프로그램 합류 소식",
    "주말 예능 화제성 순위 변화",
    "리얼리티 예능 출연진 관심 집중",
    "드라마 결말 해석과 시즌2 가능성",
    "음악 방송 컴백 무대 반응",
    "방송 플랫폼별 시청 패턴 변화"
  ],
  "자동차": [
    "전기차 보조금 개편 영향",
    "하이브리드 SUV 판매 증가",
    "중고차 시세 변동 체크포인트",
    "신형 세단 출시 일정 관심",
    "자율주행 기술 경쟁 본격화",
    "수입차 할인 프로모션 확대",
    "패밀리카 추천 기준 변화",
    "전기차 충전 인프라 개선 전망",
    "국산 픽업트럭 시장 관심",
    "자동차 보험료 절약 방법"
  ]
};

function normalizeCategoryName(categoryName) {
  return String(categoryName || "").trim();
}

function fallbackSeedsForCategory(categoryName) {
  const category = normalizeCategoryName(categoryName) || "전체";
  return [
    `${category} 인기 이슈 핵심 정리`,
    `${category} 오늘 많이 본 콘텐츠 흐름`,
    `${category} 최신 키워드 변화 분석`,
    `${category} 관심이 높아진 이유`,
    `${category} 관련 소식 한눈에 보기`,
    `${category} 지금 확인할 만한 포인트`,
    `${category} 사람들이 주목하는 주제`,
    `${category} 이번 주 화제 키워드`,
    `${category} 새롭게 떠오른 이야기`,
    `${category} 주요 변화와 체크포인트`
  ];
}

function expandToTwentyTitles(categoryName, seeds) {
  const base = seeds.length ? seeds : fallbackSeedsForCategory(categoryName);
  const result = [];
  let round = 0;
  while (result.length < 20) {
    for (const title of base) {
      if (result.length >= 20) break;
      result.push(round === 0 ? title : `${title} ${round + 1}`);
    }
    round += 1;
  }
  return result;
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

function listShortContentTitles(categoryName) {
  const category = normalizeCategoryName(categoryName);
  const seeds = CATEGORY_TITLE_SEEDS[category] || [];
  return {
    source: seeds.length ? "reference-shortcontents-category" : "fallback-shortcontents-category",
    category,
    titles: expandToTwentyTitles(category, seeds).map((title, index) => ({
      id: `short_title_${index + 1}`,
      title
    }))
  };
}

module.exports = {
  SHORT_CONTENT_CATEGORIES,
  listShortContentCategories,
  listShortContentTitles
};
