const els = {
  generatedAt: document.querySelector("#generatedAt"),
  sourceStatus: document.querySelector("#sourceStatus"),
  newsTrends: document.querySelector("#newsTrends"),
  risingWords: document.querySelector("#risingWords"),
  topics: document.querySelector("#topics"),
  learnedTopics: document.querySelector("#learnedTopics"),
  watchLater: document.querySelector("#watchLater"),
  hiddenOrCovered: document.querySelector("#hiddenOrCovered"),
  analyzeButton: document.querySelector("#analyzeButton"),
  template: document.querySelector("#topicTemplate")
};

function formatDate(value) {
  if (!value) return "未更新";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function empty(target, message) {
  target.innerHTML = `<p class="empty">${message}</p>`;
}

function renderNews(items = []) {
  els.newsTrends.innerHTML = "";
  const grounded = items.filter((item) => item.url).slice(0, 12);
  if (!grounded.length) {
    empty(els.newsTrends, "まだニュースがありません。更新すると表示されます。");
    return;
  }

  for (const item of grounded) {
    const article = document.createElement("article");
    article.className = "newsItem";
    article.innerHTML = `
      <h3>${escapeHtml(item.title)}</h3>
      <p class="muted">${escapeHtml(item.source || "")}</p>
      <a class="evidence" href="${item.url}" target="_blank" rel="noreferrer">根拠URL</a>
    `;
    els.newsTrends.append(article);
  }
}

function renderRising(words = []) {
  els.risingWords.innerHTML = "";
  const grounded = words.filter((word) => word.evidenceUrls?.length).slice(0, 24);
  if (!grounded.length) {
    empty(els.risingWords, "急上昇ワードはまだありません。");
    return;
  }
  for (const word of grounded) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${word.word} ${word.count}`;
    els.risingWords.append(chip);
  }
}

function renderTopicList(target, topics = [], compact = false) {
  target.innerHTML = "";
  const grounded = topics.filter((topic) => topic.evidenceUrl);
  if (!grounded.length) {
    empty(target, "表示できる根拠URL付き候補はありません。");
    return;
  }

  for (const topic of grounded) {
    target.append(compact ? renderMiniTopic(topic) : renderTopic(topic));
  }
}

function renderMiniTopic(topic) {
  const article = document.createElement("article");
  article.className = "miniItem";
  article.innerHTML = `
    <h3>${escapeHtml(topic.title)}</h3>
    <p class="muted">${escapeHtml(topic.trendWord)} / ${escapeHtml(topic.source || "")}</p>
    <a class="evidence" href="${topic.evidenceUrl}" target="_blank" rel="noreferrer">根拠URL</a>
  `;
  return article;
}

function renderTopic(topic) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.dataset.topicId = topic.id;
  node.querySelector(".word").textContent = topic.trendWord;
  node.querySelector(".source").textContent = topic.source || "source";
  node.querySelector("h3").textContent = topic.title;

  const list = node.querySelector(".candidateList");
  list.innerHTML = "";
  for (const candidate of topic.photoCandidates || []) {
    const li = document.createElement("li");
    li.textContent = candidate;
    list.append(li);
  }

  const evidence = node.querySelector(".evidence");
  evidence.href = topic.evidenceUrl;
  evidence.textContent = topic.evidenceTitle || topic.evidenceUrl;

  const badges = node.querySelector(".badges");
  badges.innerHTML = "";
  for (const label of [
    ...(topic.categories || []),
    ...(topic.regions || []),
    topic.droneSuitable ? "ドローン向き" : "",
    topic.flowerTopic ? "花ネタ" : "",
    topic.requiresVerification ? "確認待ち" : ""
  ].filter(Boolean)) {
    const badge = document.createElement("span");
    badge.className = `badge${label === "確認待ち" ? " verify" : ""}`;
    badge.textContent = label;
    badges.append(badge);
  }

  node.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => submitFeedback(topic.id, button.dataset.action));
  });

  return node;
}

function renderLearned(scored) {
  const learned = (scored.topics || []).filter((topic) => topic.userStatus === "usable").slice(0, 8);
  renderTopicList(els.learnedTopics, learned, true);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function submitFeedback(topicId, action) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicId, action })
  });
  if (!response.ok) {
    alert("評価を保存できませんでした。");
    return;
  }
  await load();
}

async function runAnalyze() {
  els.analyzeButton.disabled = true;
  els.analyzeButton.textContent = "更新中";
  try {
    const response = await fetch("/api/analyze", { method: "POST" });
    if (!response.ok) throw new Error("analyze failed");
    await load();
  } catch {
    alert("トレンド更新に失敗しました。通信設定やRSSの状態を確認してください。");
  } finally {
    els.analyzeButton.disabled = false;
    els.analyzeButton.textContent = "今日のトレンドを更新";
  }
}

async function load() {
  const response = await fetch("/api/data");
  const { trends = {}, scored = {} } = await response.json();
  els.generatedAt.textContent = `更新: ${formatDate(scored.generatedAt || trends.generatedAt)}`;
  const sourceCount = (trends.sources || []).filter((source) => !source.error).length;
  els.sourceStatus.textContent = `${sourceCount}/${(trends.sources || []).length} ソース取得`;

  renderNews(trends.newsTrends || []);
  renderRising(trends.risingWords || []);
  renderTopicList(els.topics, scored.topics || trends.topics || []);
  renderLearned(scored);
  renderTopicList(els.watchLater, scored.watchLater || [], true);
  renderTopicList(els.hiddenOrCovered, scored.hiddenOrCovered || [], true);
}

els.analyzeButton.addEventListener("click", runAnalyze);
load();
