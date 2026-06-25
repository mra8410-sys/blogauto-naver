function decodeHtml(value) {
  return String(value || "")
    .replace(/<mark>/gi, "")
    .replace(/<\/mark>/gi, "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function cleanNewsTitle(value) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNewsTitles(items = [], limit = 15) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      title: cleanNewsTitle(item?.title || item),
      source: String(item?.source || "").trim(),
      url: String(item?.url || "").trim()
    }))
    .filter((item) => item.title)
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((item, index) => ({
      id: `news_title_${index + 1}`,
      ...item
    }));
}

module.exports = {
  cleanNewsTitle,
  decodeHtml,
  normalizeNewsTitles
};
