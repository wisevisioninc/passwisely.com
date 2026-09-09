import { statfs } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { handleQwenTransport, QWEN_TRANSPORT_PATH } from "./qwen-transport.mjs";

function percentage(used, total) {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

export async function hostSnapshot() {
  const disk = await statfs("/", { bigint: true });
  const diskTotal = Number(disk.blocks * disk.bsize);
  const diskAvailable = Number(disk.bavail * disk.bsize);
  const memoryTotal = os.totalmem();
  const memoryAvailable = os.freemem();

  return {
    uptimeSeconds: Math.floor(os.uptime()),
    processUptimeSeconds: Math.floor(process.uptime()),
    loadAverage1m: Math.round(os.loadavg()[0] * 100) / 100,
    cpuCount: os.cpus().length,
    memoryUsedPercent: percentage(memoryTotal - memoryAvailable, memoryTotal),
    diskUsedPercent: percentage(diskTotal - diskAvailable, diskTotal),
    processRssBytes: process.memoryUsage().rss,
  };
}

export function startHostHealthServer(address = "127.0.0.1:3013") {
  const separator = address.lastIndexOf(":");
  const host = separator > 0 ? address.slice(0, separator) : "127.0.0.1";
  const requestedPort = Number(address.slice(separator + 1));
  const port = Number.isInteger(requestedPort) && requestedPort >= 0
    ? requestedPort
    : 3013;
  const server = createServer(async (request, response) => {
    if (request.url === QWEN_TRANSPORT_PATH) {
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
        response.writeHead(403).end();
        return;
      }
      await handleQwenTransport(request, response);
      return;
    }
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"Not found"}');
      return;
    }

    try {
      const payload = JSON.stringify(await hostSnapshot());
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      response.end(payload);
    } catch (error) {
      const payload = JSON.stringify({
        error: error instanceof Error ? error.message : "Health snapshot failed",
      });
      response.writeHead(500, { "content-type": "application/json" });
      response.end(payload);
    }
  });
  server.listen(port, host);
  return server;
}
