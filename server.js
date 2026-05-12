import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { analyzeTrends } from "./scripts/analyze-trends.js";
import { scoreTopics } from "./scripts/score-topics.js";
import {
  FEEDBACK_PATH,
  SCORED_TOPICS_PATH,
  TRENDS_PATH,
  readJson,
  writeJson
} from "./scripts/trend-utils.js";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = resolve("public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function findTopic(topicId) {
  const scored = await readJson(SCORED_TOPICS_PATH, { topics: [], watchLater: [], hiddenOrCovered: [] });
  const trends = await readJson(TRENDS_PATH, { topics: [] });
  return (
    [...(scored.topics || []), ...(scored.watchLater || []), ...(scored.hiddenOrCovered || [])].find(
      (topic) => topic.id === topicId
    ) || (trends.topics || []).find((topic) => topic.id === topicId)
  );
}

async function handleFeedback(request, response) {
  const body = await readBody(request);
  const allowed = new Set(["usable", "weak", "covered", "verify", "hidden", "later"]);
  if (!body.topicId || !allowed.has(body.action)) {
    sendJson(response, 400, { error: "topicId and a valid action are required" });
    return;
  }

  const topic = await findTopic(body.topicId);
  if (!topic?.evidenceUrl) {
    sendJson(response, 404, { error: "Grounded topic was not found" });
    return;
  }

  const feedback = await readJson(FEEDBACK_PATH, { items: [], learning: {}, watchLater: [] });
  const item = {
    id: `${body.topicId}-${Date.now()}`,
    topicId: body.topicId,
    action: body.action,
    createdAt: new Date().toISOString(),
    topic: {
      id: topic.id,
      trendWord: topic.trendWord,
      categories: topic.categories || [],
      regions: topic.regions || [],
      source: topic.source,
      keywords: topic.keywords || [topic.trendWord],
      droneSuitable: Boolean(topic.droneSuitable),
      flowerTopic: Boolean(topic.flowerTopic),
      evidenceUrl: topic.evidenceUrl
    }
  };

  await writeJson(FEEDBACK_PATH, {
    ...feedback,
    items: [...(feedback.items || []), item]
  });
  const scored = await scoreTopics();
  sendJson(response, 200, { ok: true, feedback: item, scored });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/data") {
      const trends = await readJson(TRENDS_PATH, {});
      const scored = await readJson(SCORED_TOPICS_PATH, {});
      sendJson(response, 200, { trends, scored });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/feedback") {
      await handleFeedback(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const trends = await analyzeTrends();
      const scored = await scoreTopics();
      sendJson(response, 200, { trends, scored });
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(join(PUBLIC_DIR, requested));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    await mkdir(PUBLIC_DIR, { recursive: true });
    await readFile(filePath);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendJson(response, 500, { error: error.message });
  }
}

createServer(route).listen(PORT, () => {
  console.log(`Trend topic app is running at http://localhost:${PORT}`);
});
