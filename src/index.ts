#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

// Med PORT satt kjøres serveren som Streamable HTTP på /mcp (for hosting), ellers stdio.
const port = process.env.PORT;

if (!port) {
  await createServer().connect(new StdioServerTransport());
} else {
  createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") return void res.writeHead(200).end("ok");
    if (path !== "/mcp") return void res.writeHead(404).end();
    if (req.method !== "POST") {
      return void res.writeHead(405, { allow: "POST" }).end();
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return void res.writeHead(400).end("Ugyldig JSON");
    }

    // Stateless: ny server og transport per forespørsel.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }).listen(Number(port), () => console.error(`politiloggen-mcp lytter på :${port}/mcp`));
}
