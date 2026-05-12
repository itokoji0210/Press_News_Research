import { pathToFileURL } from "node:url";
import {
  TRENDS_PATH,
  SOCIAL_SIGNALS_PATH,
  normalizeText,
  readJson,
  stableId,
  writeJson
} from "./trend-utils.js";

const DEFAULT_SOURCES = [
  {
    name: "NHK News",
    type: "major",
    url: "https://www3.nhk.or.jp/rss/news/cat0.xml"
  },
  {
    name: "Yahoo!ニュース 地域",
    type: "local",
    url: "https://news.yahoo.co.jp/rss/categories/local.xml"
  },
  {
    name: "PR TIMES",
    type: "pr",
    url: "https://prtimes.jp/main/rss"
  },
  {
    name: "@Press",
    type: "pr",
    url: "https://www.atpress.ne.jp/rss"
  },
  {
    name: "みんなの経済新聞ネットワーク",
    type: "local-business",
    url: "https://minkei.net/rss.xml"
  },
  {
    name: "官公庁 新着",
    type: "government",
    url: "https://www.e-gov.go.jp/news/rss.xml"
  },
  {
    name: "Google News 災害",
    type: "news-search",
    url: "https://news.google.com/rss/search?q=%E7%81%BD%E5%AE%B3%20OR%20%E5%BE%A9%E6%97%A7%20OR%20%E6%B0%B4%E4%B8%8D%E8%B6%B3&hl=ja&gl=JP&ceid=JP:ja"
  },
  {
    name: "Google News 観光・地域",
    type: "news-search",
    url: "https://news.google.com/rss/search?q=%E8%A6%B3%E5%85%89%20OR%20%E8%8A%B1%20OR%20%E5%86%8D%E9%96%8B%E7%99%BA%20OR%20%E9%96%89%E5%BA%97&hl=ja&gl=JP&ceid=JP:ja"
  }
];

const STOP_WORDS = new Set([
  "こと",
  "これ",
  "ため",
  "よう",
  "さん",
  "する",
  "した",
  "して",
  "から",
  "まで",
  "など",
  "より",
  "ニュース",
  "発表",
  "開催",
  "開始",
  "公開",
  "今回",
  "日本",
  "東京",
  "一覧",
  "写真",
  "動画"
]);

const REGION_WORDS = [
  "北海道",
  "青森",
  "岩手",
  "宮城",
  "秋田",
  "山形",
  "福島",
  "茨城",
  "栃木",
  "群馬",
  "埼玉",
  "千葉",
  "東京",
  "神奈川",
  "新潟",
  "富山",
  "石川",
  "福井",
  "山梨",
  "長野",
  "岐阜",
  "静岡",
  "愛知",
  "三重",
  "滋賀",
  "京都",
  "大阪",
  "兵庫",
  "奈良",
  "和歌山",
  "鳥取",
  "島根",
  "岡山",
  "広島",
  "山口",
  "徳島",
  "香川",
  "愛媛",
  "高知",
  "福岡",
  "佐賀",
  "長崎",
  "熊本",
  "大分",
  "宮崎",
  "鹿児島",
  "沖縄"
];

const SEASON_WORDS = [
  "猛暑",
  "酷暑",
  "梅雨",
  "台風",
  "紅葉",
  "桜",
  "花見",
  "花の見頃",
  "田植え",
  "稲刈り",
  "雪",
  "初雪",
  "海開き",
  "祭り"
];

const DISASTER_WORDS = [
  "地震",
  "津波",
  "豪雨",
  "洪水",
  "浸水",
  "土砂災害",
  "山火事",
  "火災",
  "災害復旧",
  "復旧",
  "断水",
  "水不足",
  "渇水",
  "避難"
];

const SOCIAL_WORDS = [
  "物価高",
  "インバウンド",
  "観光公害",
  "閉店",
  "再開発",
  "空き家",
  "人手不足",
  "少子化",
  "高齢化",
  "文化財保存",
  "巨大行列",
  "クマ",
  "鳥獣被害"
];

const PHOTO_PRIORITY_WORDS = [
  ...SEASON_WORDS,
  ...DISASTER_WORDS,
  ...SOCIAL_WORDS,
  "ダム",
  "水田",
  "給水車",
  "商店街",
  "駅前",
  "観光地",
  "港",
  "河川",
  "棚田",
  "文化財",
  "行列",
  "跡地",
  "工事",
  "ドローン"
];

function getSources() {
  const configured = process.env.TREND_SOURCES_JSON;
  if (!configured) return DEFAULT_SOURCES;
  try {
    const parsed = JSON.parse(configured);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_SOURCES;
  } catch {
    return DEFAULT_SOURCES;
  }
}

function extractTagBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"))].map(
    (match) => match[0]
  );
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? normalizeText(match[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, "")) : "";
}

function parseFeed(xml, source) {
  const itemBlocks = extractTagBlocks(xml, "item");
  const entryBlocks = extractTagBlocks(xml, "entry");
  const blocks = itemBlocks.length ? itemBlocks : entryBlocks;

  return blocks
    .map((block) => {
      const rawLink = tagValue(block, "link");
      const href = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
      const url = href || rawLink;
      const title = tagValue(block, "title");
      const summary =
        tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content");
      const publishedAt = tagValue(block, "pubDate") || tagValue(block, "updated");
      return {
        source: source.name,
        sourceType: source.type,
        title,
        summary,
        url,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null
      };
    })
    .filter((item) => item.title && item.url);
}

async function fetchSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "press-sns-trend-analyzer/1.0"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const xml = await response.text();
    return { source, items: parseFeed(xml, source), error: null };
  } catch (error) {
    return { source, items: [], error: error.message };
  }
}

async function readSocialSignals() {
  const data = await readJson(SOCIAL_SIGNALS_PATH, { items: [] });
  return (data.items || [])
    .map((item) => ({
      source: item.source || "SNS",
      sourceType: "social",
      title: normalizeText(item.title || item.text || ""),
      summary: normalizeText(item.summary || ""),
      url: item.url,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null
    }))
    .filter((item) => item.title && item.url);
}

function tokenize(text) {
  const normalized = normalizeText(text);
  const explicit = [
    ...REGION_WORDS,
    ...SEASON_WORDS,
    ...DISASTER_WORDS,
    ...SOCIAL_WORDS,
    ...PHOTO_PRIORITY_WORDS
  ].filter((word) => normalized.includes(word));

  const chunks =
    normalized.match(/[一-龠ぁ-んァ-ヶー]{2,12}|[A-Za-z][A-Za-z0-9-]{2,}/g) || [];
  const tokens = chunks
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word) && !/^[0-9]+$/.test(word));
  return [...new Set([...explicit, ...tokens])];
}

function classifyWord(word) {
  const categories = [];
  if (REGION_WORDS.includes(word)) categories.push("地域名");
  if (SEASON_WORDS.includes(word)) categories.push("季節語");
  if (DISASTER_WORDS.includes(word)) categories.push("災害語");
  if (SOCIAL_WORDS.includes(word)) categories.push("社会問題語");
  if (PHOTO_PRIORITY_WORDS.some((keyword) => word.includes(keyword) || keyword.includes(word))) {
    categories.push("写真ネタ化");
  }
  return categories.length ? categories : ["一般"];
}

function photoScore(word, count, articles) {
  const categoryBoost = classifyWord(word).includes("写真ネタ化") ? 12 : 0;
  const sourceDiversity = new Set(articles.map((item) => item.source)).size;
  const hasLocal = articles.some((item) =>
    ["local", "local-business", "government"].includes(item.sourceType)
  );
  return count * 4 + sourceDiversity * 3 + categoryBoost + (hasLocal ? 4 : 0);
}

function buildPhotoAngles(word, article) {
  const text = `${article.title} ${article.summary}`;
  const angles = [];

  if (/水不足|渇水|断水|ダム|水田/.test(text)) {
    angles.push("水位・農地・給水対応など、記事で触れられた影響が見える現場");
  }
  if (/クマ|鳥獣被害/.test(text)) {
    angles.push("注意喚起の掲示、出没地点周辺、住民生活への影響");
  }
  if (/猛暑|酷暑|熱中症/.test(text)) {
    angles.push("暑さ対策、屋外作業、街なかの温度表示や避暑行動");
  }
  if (/田植え|稲|農/.test(text)) {
    angles.push("田植え、用水、農作業、天候影響が分かる風景");
  }
  if (/インバウンド|観光|行列|観光公害/.test(text)) {
    angles.push("観光地の混雑、行列、案内表示、地域側の対応");
  }
  if (/物価高|値上げ|価格/.test(text)) {
    angles.push("価格表示、商店街、生活者や事業者への影響");
  }
  if (/花|見頃|桜|紅葉/.test(text)) {
    angles.push("見頃の花、来訪者、管理する人、周辺交通や混雑");
  }
  if (/山火事|火災|災害|復旧|避難|土砂|洪水|浸水/.test(text)) {
    angles.push("被害箇所、復旧作業、避難情報、支援や交通影響");
  }
  if (/閉店|再開発|跡地|工事/.test(text)) {
    angles.push("店舗外観、駅前や商店街の変化、工事・解体・告知掲示");
  }
  if (/文化財|保存/.test(text)) {
    angles.push("文化財の外観、保存作業、地域の利用風景");
  }

  if (!angles.length) {
    angles.push(`「${word}」が記事中で示す現場、告知、関係者の動き`);
  }

  return [...new Set(angles)].slice(0, 3);
}

function makeTopics(words, articleMatches) {
  const topics = [];
  for (const word of words) {
    const articles = articleMatches.get(word.word) || [];
    for (const article of articles.slice(0, 4)) {
      const title = `「${word.word}」を写真で追う: ${article.title}`;
      topics.push({
        id: stableId(`${word.word}|${article.url}`),
        trendWord: word.word,
        title,
        photoCandidates: buildPhotoAngles(word.word, article),
        evidenceUrl: article.url,
        evidenceTitle: article.title,
        source: article.source,
        sourceType: article.sourceType,
        publishedAt: article.publishedAt,
        categories: word.categories,
        regions: REGION_WORDS.filter((region) =>
          `${article.title} ${article.summary}`.includes(region)
        ),
        keywords: [word.word],
        trust: article.sourceType === "news-search" ? 0.72 : 0.86,
        droneSuitable: /ドローン|山火事|災害|復旧|再開発|ダム|田植え|水田|観光地/.test(
          `${word.word} ${article.title} ${article.summary}`
        ),
        flowerTopic: /花|見頃|桜|紅葉/.test(`${word.word} ${article.title} ${article.summary}`),
        createdAt: new Date().toISOString()
      });
    }
  }
  return topics;
}

async function readPreviousWords() {
  const previous = await readJson(TRENDS_PATH, { words: [] });
  return new Map((previous.words || []).map((item) => [item.word, item.count || 0]));
}

export async function analyzeTrends() {
  const sources = getSources();
  const results = await Promise.all(sources.map(fetchSource));
  const socialSignals = await readSocialSignals();
  const articles = [...results.flatMap((result) => result.items), ...socialSignals].slice(0, 600);
  const previousCounts = await readPreviousWords();
  const counts = new Map();
  const articleMatches = new Map();

  for (const article of articles) {
    const text = `${article.title} ${article.summary}`;
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) || 0) + 1);
      if (!articleMatches.has(token)) articleMatches.set(token, []);
      articleMatches.get(token).push(article);
    }
  }

  const words = [...counts.entries()]
    .map(([word, count]) => {
      const articlesForWord = articleMatches.get(word) || [];
      const previous = previousCounts.get(word) || 0;
      return {
        word,
        count,
        previousCount: previous,
        rise: previous ? (count - previous) / previous : count,
        categories: classifyWord(word),
        score: photoScore(word, count, articlesForWord),
        evidenceUrls: articlesForWord.slice(0, 5).map((item) => item.url)
      };
    })
    .filter((item) => item.count >= 1 && item.evidenceUrls.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  const risingWords = [...words]
    .filter((item) => item.rise > 0)
    .sort((a, b) => b.rise - a.rise || b.score - a.score)
    .slice(0, 20);

  const priorityWords = words
    .filter((item) => item.categories.includes("写真ネタ化"))
    .slice(0, 30);

  const output = {
    generatedAt: new Date().toISOString(),
    sources: results.map((result) => ({
      name: result.source.name,
      type: result.source.type,
      url: result.source.url,
      itemCount: result.items.length,
      error: result.error
    })).concat({
      name: "SNS signals",
      type: "social",
      url: SOCIAL_SIGNALS_PATH,
      itemCount: socialSignals.length,
      error: null
    }),
    newsTrends: articles.slice(0, 40),
    words,
    risingWords,
    topics: makeTopics(priorityWords, articleMatches)
  };

  await writeJson(TRENDS_PATH, output);
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  analyzeTrends()
    .then((result) => {
      console.log(
        `Saved ${result.words.length} trend words and ${result.topics.length} grounded topics to ${TRENDS_PATH}`
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
