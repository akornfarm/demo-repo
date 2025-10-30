const MOCHI_API_BASE = "https://app.mochi.cards/api";

const tools = [
  {
    name: "list_decks",
    description: "Fetch the list of decks available to the authenticated Mochi user.",
    schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_cards",
    description:
      "Fetch flashcards for a given deck. Supports optional pagination via `page` and `pageSize`.",
    schema: {
      type: "object",
      properties: {
        deckId: {
          type: "string",
          description: "Deck identifier as returned by the `list_decks` tool.",
        },
        page: {
          type: "number",
          description: "Optional page index (1-based).",
        },
        pageSize: {
          type: "number",
          description: "Optional page size (defaults to 50).",
        },
      },
      required: ["deckId"],
    },
  },
  {
    name: "create_card",
    description:
      "Create a new note/card inside the specified deck. Provide front/back markdown content and optional tags.",
    schema: {
      type: "object",
      properties: {
        deckId: {
          type: "string",
          description: "Deck identifier as returned by the `list_decks` tool.",
        },
        front: {
          type: "string",
          description: "Front content in Markdown.",
        },
        back: {
          type: "string",
          description: "Back content in Markdown.",
        },
        tags: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional list of tag strings to apply to the new card.",
        },
      },
      required: ["deckId", "front", "back"],
    },
  },
  {
    name: "record_review",
    description:
      "Submit the result of a review for a specific card. Supports answering quality scores aligned with Mochi's API.",
    schema: {
      type: "object",
      properties: {
        cardId: {
          type: "string",
          description: "Unique identifier of the card being reviewed.",
        },
        rating: {
          type: "string",
          enum: ["again", "hard", "good", "easy"],
          description: "Review rating aligned with Mochi's scheduler.",
        },
      },
      required: ["cardId", "rating"],
    },
  },
];

async function mochiFetch(path, init = {}, env) {
  const headers = new Headers(init.headers || {});
  // HTTP Basic Auth: username=API_KEY, password=empty
  const credentials = btoa(`${env.MOCHI_API_KEY}:`);
  headers.set("Authorization", `Basic ${credentials}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${MOCHI_API_BASE}${path}`, {
    ...init,
    headers,
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

async function listDecks(env) {
  return mochiFetch("/decks", { method: "GET" }, env);
}

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
    // Mochi uses bookmark for pagination, not page numbers
    // For now, we'll ignore page parameter
    // TODO: Implement bookmark-based pagination
  }

  const query = params.toString();
  const path = query ? `/cards?${query}` : `/cards`;
  return mochiFetch(path, { method: "GET" }, env);
}

async function createCard(env, args) {
  // Mochi API uses a single "content" field, not separate front/back
  // Combine front and back with a separator
  const content = `${args.front}\n\n---\n\n${args.back}`;

  const body = JSON.stringify({
    "content": content,
    "deck-id": args.deckId,
    "manual-tags": args.tags ?? [],
  });
  return mochiFetch(`/cards`, { method: "POST", body }, env);
}

async function recordReview(env, args) {
  // Note: The Mochi API documentation doesn't include a reviews endpoint
  // This functionality may not be available via the public API
  throw new Error("Review recording is not available in the Mochi API. This feature may require app-level interaction.");
}

function manifest(env) {
  return {
    name: "mochi",
    version: "0.1.0",
    description: "Remote MCP server backed by the Mochi spaced-repetition API.",
    capabilities: {
      tools,
    },
    auth: {
      type: "bearer",
      instructions: "Set the MOCHI_API_KEY secret to a Mochi personal access token.",
    },
    environment: {
      variables: ["MOCHI_API_KEY"],
    },
  };
}

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (url.pathname === "/.well-known/mcp.json") {
      return Response.json(manifest(env), {
        headers: corsHeaders(),
      });
    }

    if (request.method !== "POST") {
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders(),
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return new Response(`Invalid JSON payload: ${error}`, {
        status: 400,
        headers: corsHeaders(),
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
          error: error.message ?? String(error),
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }
  },
};
