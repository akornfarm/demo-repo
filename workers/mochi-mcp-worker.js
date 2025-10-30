// --- Mochi MCP Worker (module syntax) ---
const MOCHI_API_BASE = "https://api.mochi.cards/v1";

// 기존 tools 정의는 유지
const tools = [
  {
    name: "list_decks",
    description: "Fetch the list of decks available to the authenticated Mochi user.",
    schema: { type: "object", properties: {} },
  },
  {
    name: "list_cards",
    description: "Fetch flashcards for a given deck. Supports optional pagination via `page` and `pageSize`.",
    schema: {
      type: "object",
      properties: {
        deckId: { type: "string", description: "Deck identifier as returned by the `list_decks` tool." },
        page: { type: "number", description: "Optional page index (1-based)." },
        pageSize: { type: "number", description: "Optional page size (defaults to 50)." },
      },
      required: ["deckId"],
    },
  },
  {
    name: "create_card",
    description: "Create a new note/card inside the specified deck. Provide front/back markdown content and optional tags.",
    schema: {
      type: "object",
      properties: {
        deckId: { type: "string", description: "Deck identifier as returned by the `list_decks` tool." },
        front: { type: "string", description: "Front content in Markdown." },
        back: { type: "string", description: "Back content in Markdown." },
        tags: { type: "array", items: { type: "string" }, description: "Optional list of tag strings." },
      },
      required: ["deckId", "front", "back"],
    },
  },
  {
    name: "record_review",
    description: "Submit the result of a review for a specific card. Supports answering quality scores aligned with Mochi's API.",
    schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Unique identifier of the card being reviewed." },
        rating: { type: "string", enum: ["again", "hard", "good", "easy"], description: "Review rating." },
      },
      required: ["cardId", "rating"],
    },
  },
];

// ---------- Upstream fetch helpers ----------
async function mochiFetch(path, init = {}, env) {
  const headers = new Headers(init.headers || {});
  if (!env.MOCHI_API_KEY) {
    const e = new Error("Missing MOCHI_API_KEY");
    e.status = 401;
    throw e;
  }
  headers.set("Authorization", `Bearer ${env.MOCHI_API_KEY}`);
  headers.set("Content-Type", "application/json");
  headers.set("User-Agent", "mochi-mcp-worker/0.1 (+cloudflare)");

  const response = await fetch(`${MOCHI_API_BASE}${path}`, { ...init, headers });
  const text = await response.text();

  if (!response.ok) {
    const err = new Error(`Mochi API ${response.status}: ${text.slice(0, 500)}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const e = new Error(`Failed to parse Mochi API response: ${error}`);
    e.status = 502;
    throw e;
  }
}

async function listDecks(env) { return mochiFetch("/decks", { method: "GET" }, env); }
async function listCards(env, args) {
  const { deckId, page, pageSize } = args;
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (pageSize) params.set("page_size", String(pageSize));
  const q = params.toString();
  const path = q ? `/decks/${deckId}/cards?${q}` : `/decks/${deckId}/cards`;
  return mochiFetch(path, { method: "GET" }, env);
}
async function createCard(env, args) {
  const body = JSON.stringify({ front: args.front, back: args.back, tags: args.tags ?? [] });
  return mochiFetch(`/decks/${args.deckId}/cards`, { method: "POST", body }, env);
}
async function recordReview(env, args) {
  const body = JSON.stringify({ rating: args.rating });
  return mochiFetch(`/cards/${args.cardId}/reviews`, { method: "POST", body }, env);
}

// ---------- MCP manifest ----------
function manifest(env, origin) {
  return {
    name: "mochi",
    version: "0.1.0",
    description: "Remote MCP server backed by the Mochi spaced-repetition API.",
    capabilities: { tools: { listChanged: false } },
    endpoints: { http: { url: `${origin}/mcp` } }, // <— Claude가 이걸로 연결
    auth: { type: "bearer", instructions: "Set the MOCHI_API_KEY secret to a Mochi personal access token." },
    environment: { variables: ["MOCHI_API_KEY"] },
  };
}

// ---------- MCP (Streamable HTTP) JSON-RPC ----------
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function jerr(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function mcpToolDefs() {
  // MCP는 inputSchema(camelCase) 키를 기대
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.schema || { type: "object" },
  }));
}

const impl = {
  list_decks: (env, _a) => listDecks(env),
  list_cards: (env, a) => listCards(env, a),
  create_card: (env, a) => createCard(env, a),
  record_review: (env, a) => recordReview(env, a),
};

function toTextResult(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    structuredContent: obj,
    isError: false,
  };
}

async function handleMcp(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    return Response.json(jerr(null, -32600, "Invalid JSON-RPC request"), { status: 400, headers: corsHeaders() });
    }
  const { id, method, params = {} } = body;

  try {
    if (method === "initialize") {
      return Response.json(ok(id, {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "mochi", version: "0.1.0" },
        capabilities: { tools: { listChanged: false } },
      }), { headers: corsHeaders() });
    }

    if (method === "tools/list") {
      return Response.json(ok(id, { tools: mcpToolDefs() }), { headers: corsHeaders() });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params;
      if (!name || !(name in impl)) {
        return Response.json(jerr(id, -32602, `Unknown tool: ${name}`), { status: 400, headers: corsHeaders() });
      }
      const data = await impl[name](env, args);
      return Response.json(ok(id, {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      }), { headers: corsHeaders() });
    }

    return Response.json(jerr(id, -32601, `Method not found: ${method}`), { status: 404, headers: corsHeaders() });
  } catch (e) {
    const status = e?.status ?? 500;
    return Response.json(ok(id, { ...toTextResult({ error: String(e) }), isError: true }), { status, headers: corsHeaders() });
  }
}

// ---------- CORS ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ---------- Worker fetch ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health
    if (url.pathname === "/health") {
      return Response.json({ ok: true, hasKey: Boolean(env.MOCHI_API_KEY) }, { headers: corsHeaders() });
    }

    // Manifest
    if (url.pathname === "/.well-known/mcp.json") {
      return Response.json(manifest(env, url.origin), { headers: corsHeaders() });
    }

    // MCP endpoint (Streamable HTTP)
    if (url.pathname === "/mcp") {
      if (request.method === "POST") return handleMcp(request, env);
      if (request.method === "GET") {
        return new Response("SSE not supported (use POST)", { status: 405, headers: { ...corsHeaders(), Allow: "POST", Vary: "Accept" } });
      }
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
    }

    // (선택) 예전 커스텀 POST 방식 유지하고 싶으면 아래 살려둠
    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    }

    // 구방식 payload 처리(원하면 제거 가능)
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return new Response(`Invalid JSON payload: ${error}`, { status: 400, headers: corsHeaders() });
    }
    try {
      const data = await (async function handleInvocation(env, payload) {
        switch (payload.method) {
          case "listTools": return { tools };
          case "callTool": {
            const { name, arguments: args = {} } = payload.params || {};
            if (!name) throw new Error("Tool invocation missing name");
            switch (name) {
              case "list_decks": return { result: await listDecks(env) };
              case "list_cards": return { result: await listCards(env, args) };
              case "create_card": return { result: await createCard(env, args) };
              case "record_review": return { result: await recordReview(env, args) };
              default: throw new Error(`Unknown tool: ${name}`);
            }
          }
          default: throw new Error(`Unsupported method: ${payload.method}`);
        }
      })(env, payload);
      return Response.json({ success: true, data }, { headers: corsHeaders() });
    } catch (error) {
      const status = error?.status ?? 400;
      console.log("ERROR", { status, message: String(error), stack: error?.stack, body: error?.body?.slice?.(0, 500) });
      return Response.json({ success: false, error: error?.message ?? String(error) }, { status, headers: corsHeaders() });
    }
  },
};
