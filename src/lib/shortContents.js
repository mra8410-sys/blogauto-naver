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

function listShortContentCategories() {
  return {
    source: "reference-shortcontents",
    categories: SHORT_CONTENT_CATEGORIES.map((name, index) => ({
      id: `short_${index + 1}`,
      name
    }))
  };
}

module.exports = {
  SHORT_CONTENT_CATEGORIES,
  listShortContentCategories
};
