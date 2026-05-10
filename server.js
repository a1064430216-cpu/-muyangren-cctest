// 牧羊人测评站 - 本地开发服务器
// 仅本地用：node server.js → http://localhost:3000
// 生产环境（Vercel）会自动用 public/ + api/check.js，不走这个文件

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { runAllChecks } = require("./lib/checks.js");

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".ico":  "image/x-icon",
};

const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

    if (pathname === "/api/check" && req.method === "POST") {
        return handleCheck(req, res);
    }
    if (pathname === "/api/contact" && req.method === "POST") {
        return handleContact(req, res);
    }
    return serveStatic(pathname, res);
});

async function handleContact(req, res) {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); }
    catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
    const { email, message } = payload;
    if (!email || !message) return sendJSON(res, 400, { error: "缺少 email 或 message" });
    console.log(`[${new Date().toISOString()}] 联系我们：${email}`);
    console.log("内容：", message);
    sendJSON(res, 200, { ok: true });
}

server.listen(PORT, () => {
    console.log(`\n🐑 牧羊人测评站启动成功！监听端口 ${PORT}`);
    console.log(`   本地预览：http://localhost:${PORT}`);
    console.log(`   按 Ctrl+C 停止\n`);
});

function serveStatic(pathname, res) {
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("404 Not Found: " + pathname);
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
    });
}

async function handleCheck(req, res) {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); }
    catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }

    const { baseUrl, apiKey, model } = payload;
    if (!baseUrl || !apiKey || !model) {
        return sendJSON(res, 400, { error: "Missing baseUrl / apiKey / model" });
    }

    console.log(`[${new Date().toISOString()}] 开始检测：${baseUrl} / ${model}`);
    const results = await runAllChecks(baseUrl, apiKey, model);
    sendJSON(res, 200, { ok: true, results });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", c => (data += c));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function sendJSON(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
}
