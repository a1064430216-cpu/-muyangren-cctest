// 牧羊人测评站 - 后端服务（零依赖版）
// ==============================================
// 仅使用 Node.js 内置模块，运行命令：node server.js
// 启动后：
//   - 浏览器访问 http://localhost:3000 看前端页面
//   - 前端调用 POST /api/check 进行真实检测
// ==============================================

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;  // 部署平台会注入 PORT 环境变量
const ROOT = __dirname;

// ============ MIME 类型映射 ============
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

// ============ 主服务器 ============
const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

    // ---- API 路由 ----
    if (pathname === "/api/check" && req.method === "POST") {
        return handleCheck(req, res);
    }

    // ---- 静态文件 ----
    return serveStatic(pathname, res);
});

server.listen(PORT, () => {
    console.log(`\n🐑 牧羊人测评站启动成功！监听端口 ${PORT}`);
    console.log(`   本地预览：http://localhost:${PORT}`);
    console.log(`   按 Ctrl+C 停止\n`);
});

// ============ 静态文件服务 ============
function serveStatic(pathname, res) {
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(ROOT, pathname);

    // 防止目录穿越
    if (!filePath.startsWith(ROOT)) {
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

// ============ 检测处理 ============
async function handleCheck(req, res) {
    const body = await readBody(req);
    let payload;
    try {
        payload = JSON.parse(body);
    } catch {
        return sendJSON(res, 400, { error: "Invalid JSON" });
    }

    const { baseUrl, apiKey, model } = payload;
    if (!baseUrl || !apiKey || !model) {
        return sendJSON(res, 400, { error: "Missing baseUrl / apiKey / model" });
    }

    // 依次跑各项检测
    const results = {};

    results.fingerprint = await checkFingerprint(baseUrl, apiKey, model);
    results.nonStream   = await checkNonStream(baseUrl, apiKey, model);
    results.stream      = await checkStream(baseUrl, apiKey, model);
    results.tokens      = await checkTokens(baseUrl, apiKey, model);
    results.sig         = await checkSignature(baseUrl, apiKey, model);
    results.sigReal     = await checkSignatureReal(baseUrl, apiKey, model);
    results.multimodal  = await checkMultimodal(baseUrl, apiKey, model);

    sendJSON(res, 200, { ok: true, results });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function sendJSON(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
}

// ============ 检测逻辑：以下都是 OpenAI 兼容格式 ============

// 1) 指纹验证：发送一个标准请求，看能否拿到合法响应
async function checkFingerprint(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "Say only the word: PONG" }],
            max_tokens: 10,
        });
        const text = (data?.choices?.[0]?.message?.content || "").trim().toUpperCase();
        if (text.includes("PONG")) {
            return { status: "pass", message: "模型响应正常" };
        }
        return { status: "warn", message: "响应不合预期：" + text.slice(0, 30) };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 2) 非流结构完整性：检查必须字段是否齐全
async function checkNonStream(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 5,
        });
        const required = ["id", "object", "created", "model", "choices", "usage"];
        const missing = required.filter(k => !(k in data));
        if (missing.length === 0) {
            return { status: "pass", message: "字段完整" };
        }
        return { status: "fail", message: "缺失字段：" + missing.join(",") };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 3) 流结构完整性：检查 SSE 流式响应
async function checkStream(baseUrl, apiKey, model) {
    try {
        const events = await callOpenAIStream(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "count: 1 2 3" }],
            max_tokens: 20,
            stream: true,
        });
        if (events.length < 2) {
            return { status: "fail", message: "事件数过少（" + events.length + "）" };
        }
        const hasDone = events.some(e => e.includes("[DONE]"));
        if (!hasDone) {
            return { status: "warn", message: "未收到 [DONE] 终止符" };
        }
        return { status: "pass", message: events.length + " 个事件" };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 4) Token 用量审计：检查 usage 字段是否合理
async function checkTokens(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 5,
        });
        const usage = data?.usage;
        if (!usage) return { status: "fail", message: "无 usage 字段" };
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        if (prompt_tokens == null || completion_tokens == null) {
            return { status: "fail", message: "usage 字段不完整" };
        }
        if (total_tokens !== prompt_tokens + completion_tokens) {
            return { status: "warn", message: "total ≠ prompt + completion" };
        }
        if (prompt_tokens < 1 || prompt_tokens > 50) {
            return { status: "warn", message: "prompt_tokens 异常：" + prompt_tokens };
        }
        return { status: "pass", message: `${prompt_tokens}+${completion_tokens}` };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 5) 签名校验：检查响应中应有的"身份"字段（id / object / model）格式是否合理
//    OpenAI 官方：id 形如 "chatcmpl-xxxxxxxxxxxxxxxxxxxxxxxx"，object="chat.completion"
//    Anthropic 官方：id 形如 "msg_xxxxxxxxxxxxxxxxx"
async function checkSignature(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 5,
        });

        const id     = data?.id || "";
        const object = data?.object || "";
        const respModel = data?.model || "";

        const issues = [];

        // id 至少要有合理长度且包含字母数字
        if (!id || id.length < 10) {
            issues.push("id 异常");
        } else if (!/^(chatcmpl-|msg_|gen-)[A-Za-z0-9_-]{8,}$/.test(id)) {
            issues.push("id 格式不符合常见规范");
        }

        // object 字段必须是 chat.completion
        if (object && object !== "chat.completion") {
            issues.push("object=" + object);
        }

        // model 字段必须存在
        if (!respModel) {
            issues.push("无 model 字段");
        }

        if (issues.length === 0) {
            return { status: "pass", message: id.slice(0, 20) + "…" };
        }
        return { status: "warn", message: issues.join("；") };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 6) 签名真实性：连续发 2 次请求，检查 id 是否真的不重复，model 字段是否一致
//    套壳站常常 id 不变（粗暴 hard-code），或每次返回不同模型名（瞎拼）
async function checkSignatureReal(baseUrl, apiKey, model) {
    try {
        const [a, b] = await Promise.all([
            callOpenAI(baseUrl, apiKey, {
                model, messages: [{ role: "user", content: "ping a" }], max_tokens: 3,
            }),
            callOpenAI(baseUrl, apiKey, {
                model, messages: [{ role: "user", content: "ping b" }], max_tokens: 3,
            }),
        ]);

        const idA = a?.id || "";
        const idB = b?.id || "";
        const modelA = a?.model || "";
        const modelB = b?.model || "";
        const fpA = a?.system_fingerprint || "";
        const fpB = b?.system_fingerprint || "";

        const issues = [];

        if (!idA || !idB) {
            issues.push("id 缺失");
        } else if (idA === idB) {
            issues.push("两次 id 完全相同（重大可疑）");
        }

        if (modelA && modelB && modelA !== modelB) {
            issues.push(`model 字段漂移：${modelA} vs ${modelB}`);
        }

        // system_fingerprint 在同一模型短时间内应保持一致（OpenAI 官方行为）
        if (fpA && fpB && fpA !== fpB) {
            issues.push("system_fingerprint 不稳定");
        }

        if (issues.length === 0) {
            return { status: "pass", message: "id 唯一、model 一致" };
        }
        return { status: issues[0].includes("完全相同") ? "fail" : "warn",
                 message: issues.join("；") };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

// 7) 多模态能力：发一张 base64 编码的极简图片，问模型颜色，看能否识别
//    用一张 1x1 红色 PNG（base64），让真模型回答 "red"
async function checkMultimodal(baseUrl, apiKey, model) {
    // 1x1 红色 PNG (base64)
    const REDPX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "What color is this image? Answer with one word only." },
                    { type: "image_url", image_url: { url: "data:image/png;base64," + REDPX } }
                ],
            }],
            max_tokens: 10,
        });

        const text = (data?.choices?.[0]?.message?.content || "").trim().toLowerCase();
        if (!text) {
            return { status: "fail", message: "无响应内容" };
        }
        if (text.includes("red") || text.includes("红")) {
            return { status: "pass", message: "正确识别为红色" };
        }
        if (text.includes("cannot") || text.includes("can't") || text.includes("unable")
            || text.includes("不能") || text.includes("无法")) {
            return { status: "fail", message: "不支持图像输入" };
        }
        return { status: "warn", message: "回答异常：" + text.slice(0, 30) };
    } catch (e) {
        // 多模态失败不一定意味着假站，可能是模型本身不支持视觉
        const msg = e.message || "";
        if (/image|vision|multimodal|不支持/i.test(msg)) {
            return { status: "warn", message: "API 拒绝图像输入" };
        }
        return { status: "fail", message: msg };
    }
}

// ============ 通用 API 调用 ============
// 规范化 baseUrl：去掉末尾斜杠和误填的 /chat/completions
function normalizeBaseUrl(baseUrl) {
    let s = baseUrl.trim().replace(/\/+$/, "");
    s = s.replace(/\/chat\/completions$/i, "");
    s = s.replace(/\/v1\/messages$/i, "/v1");
    return s;
}

async function callOpenAI(baseUrl, apiKey, body) {
    const endpoint = normalizeBaseUrl(baseUrl) + "/chat/completions";
    console.log(`[${new Date().toISOString()}] POST ${endpoint}`);
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text();
        const hint = resp.status === 404
            ? `（请确认 Base URL 是否包含 /v1，URL: ${endpoint}）`
            : "";
        throw new Error(`HTTP ${resp.status} ${hint}: ${text.slice(0, 200)}`);
    }
    return await resp.json();
}

async function callOpenAIStream(baseUrl, apiKey, body) {
    const endpoint = normalizeBaseUrl(baseUrl) + "/chat/completions";
    console.log(`[${new Date().toISOString()}] POST ${endpoint} (stream)`);
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith("data:")) {
                events.push(line.slice(5).trim());
            }
        }
    }
    return events;
}
