const MOCHI_API_BASE = "https://api.mochi.cards/v1";

type ToolSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

type ToolDefinition = {
  name: string;
  description: string;
  schema: ToolSchema;
};

type ToolInvocation = {
  name?: string;
  arguments?: Record<string, unknown>;
};

type McpRequest =
  | { method: "listTools" }
  | { method: "callTool"; params: ToolInvocation };

type MochiDeck = Record<string, unknown>;
type MochiCard = Record<string, unknown>;

type Env = {
  MOCHI_API_KEY: string;
};

const tools: ToolDefinition[] = [
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

async function mochiFetch<T>(path: string, init: RequestInit, env: Env): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${env.MOCHI_API_KEY}`);
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
    return null as unknown as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse Mochi API response: ${error}`);
  }
}

async function listDecks(env: Env): Promise<MochiDeck[]> {
  return mochiFetch<MochiDeck[]>("/decks", { method: "GET" }, env);
}

async function listCards(env: Env, args: Record<string, unknown>): Promise<MochiCard[]> {
  const { deckId, page, pageSize } = args;
  if (typeof deckId !== "string") {
    throw new Error("list_cards requires a string deckId");
  }

  const params = new URLSearchParams();
  if (typeof page === "number") {
    params.set("page", String(page));
  }
  if (typeof pageSize === "number") {
    params.set("page_size", String(pageSize));
  }

  const query = params.toString();
  const path = query ? `/decks/${deckId}/cards?${query}` : `/decks/${deckId}/cards`;
  return mochiFetch<MochiCard[]>(path, { method: "GET" }, env);
}

async function createCard(env: Env, args: Record<string, unknown>): Promise<MochiCard> {
  const { deckId, front, back, tags } = args;
  if (typeof deckId !== "string" || typeof front !== "string" || typeof back !== "string") {
    throw new Error("create_card requires deckId, front, and back strings");
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    throw new Error("create_card tags must be an array of strings if provided");
  }

  const body = JSON.stringify({
    front,
    back,
    tags: Array.isArray(tags) ? tags : [],
  });

  return mochiFetch<MochiCard>(`/decks/${deckId}/cards`, { method: "POST", body }, env);
}

async function recordReview(env: Env, args: Record<string, unknown>): Promise<MochiCard> {
  const { cardId, rating } = args;
  if (typeof cardId !== "string" || typeof rating !== "string") {
    throw new Error("record_review requires cardId and rating strings");
  }

  const body = JSON.stringify({ rating });
  return mochiFetch<MochiCard>(`/cards/${cardId}/reviews`, { method: "POST", body }, env);
}

function manifest(env: Env) {
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

async function handleInvocation(env: Env, payload: McpRequest) {
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

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/mcp.json") {
      return Response.json(manifest(env));
    }

    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    let payload: McpRequest;
    try {
      payload = (await request.json()) as McpRequest;
    } catch (error) {
      return new Response(`Invalid JSON payload: ${error}`, { status: 400 });
    }

    try {
      const data = await handleInvocation(env, payload);
      return Response.json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json(
        {
          success: false,
          error: message,
        },
        { status: 400 }
      );
    }
  },
};
