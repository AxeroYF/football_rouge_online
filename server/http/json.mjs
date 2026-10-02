export function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export async function readJsonBody(request, { maximumBytes = 1_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求格式无效"), { statusCode: 400 });
  }
}

export function bearerToken(request) {
  const header = String(request.headers.authorization ?? "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
