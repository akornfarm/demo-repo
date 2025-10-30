var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workers/mochi-mcp-worker.js
var MOCHI_API_BASE = "https://app.mochi.cards/api";
var tools = [
  {
    name: "list_decks",
    description: "Fetch the list of decks available to the authenticated Mochi user.",
    schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_cards",
    description: "Fetch flashcards for a given deck. Supports optional pagination via `page` and `pageSize`.",
    schema: {
      type: "object",
      properties: {
        deckId: {
          type: "string",
          description: "Deck identifier as returned by the `list_decks` tool."
        },
        page: {
          type: "number",
          description: "Optional page index (1-based)."
        },
        pageSize: {
          type: "number",
          description: "Optional page size (defaults to 50)."
        }
      },
      required: ["deckId"]
    }
  },
  {
    name: "create_card",
    description: "Create a new note/card inside the specified deck. Provide front/back markdown content and optional tags.",
    schema: {
      type: "object",
      properties: {
        deckId: {
          type: "string",
          description: "Deck identifier as returned by the `list_decks` tool."
        },
        front: {
          type: "string",
          description: "Front content in Markdown."
        },
        back: {
          type: "string",
          description: "Back content in Markdown."
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Optional list of tag strings to apply to the new card."
        }
      },
      required: ["deckId", "front", "back"]
    }
  },
  {
    name: "record_review",
    description: "Submit the result of a review for a specific card. Supports answering quality scores aligned with Mochi's API.",
    schema: {
      type: "object",
      properties: {
        cardId: {
          type: "string",
          description: "Unique identifier of the card being reviewed."
        },
        rating: {
          type: "string",
          enum: ["again", "hard", "good", "easy"],
          description: "Review rating aligned with Mochi's scheduler."
        }
      },
      required: ["cardId", "rating"]
    }
  }
];
async function mochiFetch(path, init = {}, env) {
  const headers = new Headers(init.headers || {});
  const credentials = btoa(`${env.MOCHI_API_KEY}:`);
  headers.set("Authorization", `Basic ${credentials}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${MOCHI_API_BASE}${path}`, {
    ...init,
    headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Mochi API ${response.status}: ${text}`);
  }
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse Mochi API response: ${error}`);
  }
}
__name(mochiFetch, "mochiFetch");
async function listDecks(env) {
  return mochiFetch("/decks", { method: "GET" }, env);
}
__name(listDecks, "listDecks");
async function listCards(env, args) {
  const { deckId, page, pageSize } = args;
  const params = new URLSearchParams();
  if (deckId) {
    params.set("deck-id", String(deckId));
  }
  if (pageSize) {
    params.set("limit", String(pageSize));
  }
  if (page) {
  }
  const query = params.toString();
  const path = query ? `/cards?${query}` : `/cards`;
  return mochiFetch(path, { method: "GET" }, env);
}
__name(listCards, "listCards");
async function createCard(env, args) {
  const content = `${args.front}

---

${args.back}`;
  const body = JSON.stringify({
    "content": content,
    "deck-id": args.deckId,
    "manual-tags": args.tags ?? []
  });
  return mochiFetch(`/cards`, { method: "POST", body }, env);
}
__name(createCard, "createCard");
async function recordReview(env, args) {
  throw new Error("Review recording is not available in the Mochi API. This feature may require app-level interaction.");
}
__name(recordReview, "recordReview");
function manifest(env) {
  return {
    name: "mochi",
    version: "0.1.0",
    description: "Remote MCP server backed by the Mochi spaced-repetition API.",
    capabilities: {
      tools
    },
    auth: {
      type: "bearer",
      instructions: "Set the MOCHI_API_KEY secret to a Mochi personal access token."
    },
    environment: {
      variables: ["MOCHI_API_KEY"]
    }
  };
}
__name(manifest, "manifest");
async function handleInvocation(env, payload) {
  switch (payload.method) {
    case "listTools":
      return { tools };
    case "callTool": {
      const { name, arguments: args = {} } = payload.params;
      if (!name) {
        throw new Error("Tool invocation missing name");
      }
      switch (name) {
        case "list_decks":
          return { result: await listDecks(env) };
        case "list_cards":
          return { result: await listCards(env, args) };
        case "create_card":
          return { result: await createCard(env, args) };
        case "record_review":
          return { result: await recordReview(env, args) };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    }
    default:
      throw new Error(`Unsupported method: ${payload.method}`);
  }
}
__name(handleInvocation, "handleInvocation");
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
var mochi_mcp_worker_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders()
        });
      }
      if (url.pathname === "/.well-known/mcp.json") {
        return Response.json(manifest(env), {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json"
          }
        });
      }
      if (url.pathname === "/" && request.method === "GET") {
        return Response.json(manifest(env), {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json"
          }
        });
      }
      if (request.method !== "POST") {
        return new Response("Not Found", {
          status: 404,
          headers: corsHeaders()
        });
      }
      let payload;
      try {
        payload = await request.json();
      } catch (error) {
        return new Response(`Invalid JSON payload: ${error}`, {
          status: 400,
          headers: corsHeaders()
        });
      }
      try {
        const data = await handleInvocation(env, payload);
        return Response.json(
          { success: true, data },
          { headers: corsHeaders() }
        );
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error.message ?? String(error)
          },
          {
            status: 400,
            headers: corsHeaders()
          }
        );
      }
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(`Internal Server Error: ${error.message ?? String(error)}`, {
        status: 500,
        headers: corsHeaders()
      });
    }
  }
};

// ../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Sh9Zlk/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = mochi_mcp_worker_default;

// ../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Sh9Zlk/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=mochi-mcp-worker.js.map
