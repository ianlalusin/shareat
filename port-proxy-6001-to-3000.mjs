import http from "http";

const LISTEN_PORT = 6200;
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 3000;

const server = http.createServer((req, res) => {
  const opts = {
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Proxy error: " + err.message);
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on ${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
});
