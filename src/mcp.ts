import type { FederatedSearchResponse } from "./federation/service";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type SearchHandler = (query: string) => Promise<FederatedSearchResponse>;

function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null
    ? value
    : null;
}

function response(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function error(id: JsonRpcId, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: code === -32600 ? 400 : 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function handleMcpRequest(
  request: Request,
  search: SearchHandler,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("The Allodium MCP endpoint accepts JSON-RPC POST requests.", {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "text/plain; charset=UTF-8" },
    });
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return error(null, -32700, "Parse error");
  }
  const id = jsonRpcId(body.id);
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return error(id, -32600, "Invalid Request");
  }

  switch (body.method) {
    case "initialize":
      return response(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "the-allodium-open-index", version: "1.0.0" },
        instructions:
          "Search the public scholarly record. Results include source provenance and transparent metadata credibility signals; they are not endorsements.",
      });
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "ping":
      return response(id, {});
    case "tools/list":
      return response(id, {
        tools: [
          {
            name: "search_research",
            title: "Search research",
            description:
              "Federated search across public scholarly indexes. Returns merged metadata, source status, and credibility signals.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  minLength: 2,
                  maxLength: 500,
                  description: "Research query",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
        ],
      });
    case "tools/call": {
      const params =
        typeof body.params === "object" && body.params !== null
          ? (body.params as Record<string, unknown>)
          : {};
      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (params.name !== "search_research") {
        return error(id, -32602, "Unknown tool");
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (query.length < 2 || query.length > 500) {
        return response(id, {
          isError: true,
          content: [{ type: "text", text: "query must contain 2–500 characters" }],
        });
      }
      const result = await search(query);
      return response(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      });
    }
    default:
      return error(id, -32601, "Method not found");
  }
}
