# Demo

This repository contains a Cloudflare Worker implementation of a remote Model Context Protocol (MCP) server for the [Mochi](https://mochi.cards) spaced-repetition platform.

## Cloudflare Worker MCP Server

The worker exposes a JSON-based MCP interface tailored for Mochi. It supports the following tools:

- `list_decks`: Retrieve decks available to the authenticated user.
- `list_cards`: Retrieve cards for a given deck, with optional pagination.
- `create_card`: Create a new card within a deck.
- `record_review`: Submit review feedback for a card.

### Deployment

1. Create a new Cloudflare Worker (for example, using [`wrangler`](https://developers.cloudflare.com/workers/wrangler/)).
2. Upload `workers/mochi-mcp-worker.js` as the worker entry point.
3. Configure the `MOCHI_API_KEY` secret in your Worker environment with a valid Mochi API token (generated from Mochi's developer settings).
4. Optionally configure routes or invoke the worker via `wrangler dev`.

### Runtime Contract

- `GET /.well-known/mcp.json`: Returns the MCP manifest describing the server, tools, and required environment configuration.
- `POST /`: Accepts MCP JSON-RPC style payloads:
  - `{"method":"listTools"}` returns the server's tool list.
  - `{"method":"callTool", "params": { "name": "list_decks" }}` executes a specific tool. Tool-specific arguments should be provided in the `arguments` object inside `params`.

The worker forwards requests to the Mochi REST API, ensuring the `Authorization: Bearer <MOCHI_API_KEY>` header is applied.

### Error Handling

Responses are wrapped in a standard envelope: `{ "success": true|false, ... }`. Any non-2xx response or JSON parsing failure from the Mochi API results in a `success: false` response with an `error` message.
