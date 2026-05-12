import {
  FEEDBACK_PATH,
  SCORED_TOPICS_PATH,
  TRENDS_PATH,
  daysBetween,
  readJson,
  writeJson
} from "./trend-utils.js";
import { pathToFileURL } from "node:url";

const ACTION_WEIGHTS = {
  usable: 12,
  weak: -9,
  covered: -1000,
  verify: -4,
  hidden: -10000,
  later: 3
};

const COVERED_HIDE_DAYS = 21;

function blankLearning() {
  return {
    categories: {},
    regions: {},
    sources: {},
    keywords: {},
    droneTopics: {},
    flowerTopics: {},
    rejectedTopics: {}
  };
}

function addScore(bucket, key, amount) {
  if (!key) return;
  bucket[key] = (bucket[key] || 0) + amount;
}

function latestActions(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item.topicId) continue;
    const previous = map.get(item.topicId);
    if (!previous || new Date(item.createdAt) > new Date(previous.createdAt)) {
      map.set(item.topicId, item);
    }
  }
  return map;
}

function buildLearning(feedbackItems) {
  const learning = blankLearning();

  for (const item of feedbackItems || []) {
    const topic = item.topic || {};
    const positive = item.action === "usable";
    const negative = item.action === "weak" || item.action === "hidden";
    const amount = positive ? 1 : negative ? -1 : 0;

    for (const category of topic.categories || []) addScore(learning.categories, category, amount);
    for (const region of topic.regions || []) addScore(learning.regions, region, amount);
    addScore(learning.sources, topic.source, amount);
    for (const keyword of topic.keywords || [topic.trendWord]) {
      addScore(learning.keywords, keyword, amount);
    }

    if (topic.droneSuitable && positive) addScore(learning.droneTopics, topic.trendWord, 1);
    if (topic.flowerTopic && positive) addScore(learning.flowerTopics, topic.trendWord, 1);
    if (negative) addScore(learning.rejectedTopics, topic.trendWord, 1);
  }

  return learning;
}

function learnedBoost(topic, learning) {
  let score = 0;
  for (const category of topic.categories || []) score += learning.categories[category] || 0;
  for (const region of topic.regions || []) score += learning.regions[region] || 0;
  score += learning.sources[topic.source] || 0;
  for (const keyword of topic.keywords || [topic.trendWord]) score += learning.keywords[keyword] || 0;
  if (topic.droneSuitable) score += (learning.droneTopics[topic.trendWord] || 0) * 2;
  if (topic.flowerTopic) score += (learning.flowerTopics[topic.trendWord] || 0) * 2;
  score -= (learning.rejectedTopics[topic.trendWord] || 0) * 3;
  return score;
}

function scoreTopic(topic, latest, learning) {
  const latestAction = latest.get(topic.id);
  const action = latestAction?.action;
  const actionScore = action ? ACTION_WEIGHTS[action] || 0 : 0;
  const baseScore = 20 + (topic.droneSuitable ? 4 : 0) + (topic.flowerTopic ? 4 : 0);
  const trustScore = Math.round((topic.trust ?? 0.7) * 10);
  const sourceScore =
    topic.sourceType === "government" ? 6 : topic.sourceType === "local" ? 5 : topic.sourceType === "pr" ? 2 : 3;

  return baseScore + trustScore + sourceScore + learnedBoost(topic, learning) + actionScore;
}

function isCoveredRecently(action) {
  return action?.action === "covered" && daysBetween(action.createdAt) < COVERED_HIDE_DAYS;
}

export async function scoreTopics() {
  const trends = await readJson(TRENDS_PATH, { topics: [] });
  const feedback = await readJson(FEEDBACK_PATH, { items: [], watchLater: [] });
  const feedbackItems = feedback.items || [];
  const learning = buildLearning(feedbackItems);
  const latest = latestActions(feedbackItems);

  const hiddenOrCovered = [];
  const watchLater = [];
  const topics = [];

  for (const topic of trends.topics || []) {
    if (!topic.evidenceUrl) continue;
    const action = latest.get(topic.id);
    const hidden = action?.action === "hidden";
    const covered = isCoveredRecently(action);

    const enriched = {
      ...topic,
      score: scoreTopic(topic, latest, learning),
      userStatus: action?.action || null,
      requiresVerification: action?.action === "verify",
      trust: action?.action === "verify" ? Math.max((topic.trust ?? 0.7) - 0.25, 0.1) : topic.trust
    };

    if (action?.action === "later") watchLater.push(enriched);
    if (hidden || covered) {
      hiddenOrCovered.push(enriched);
      continue;
    }
    topics.push(enriched);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    topics: topics.sort((a, b) => b.score - a.score),
    watchLater: watchLater.sort((a, b) => b.score - a.score),
    hiddenOrCovered,
    learning
  };

  await writeJson(SCORED_TOPICS_PATH, output);
  await writeJson(FEEDBACK_PATH, {
    ...feedback,
    learning,
    watchLater: watchLater.map((topic) => topic.id)
  });
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  scoreTopics()
    .then((result) => {
      console.log(`Saved ${result.topics.length} scored topics to ${SCORED_TOPICS_PATH}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
