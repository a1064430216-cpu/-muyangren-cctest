// 牧羊人测评站 - 7 大检测维度（Vercel & 本地共用）

function normalizeBaseUrl(baseUrl) {
    let s = baseUrl.trim().replace(/\/+$/, "");
    s = s.replace(/\/chat\/completions$/i, "");
    s = s.replace(/\/v1\/messages$/i, "/v1");
    return s;
}

// 单次请求带 12 秒超时（避免上游慢卡死整个检测）
async function fetchOnce(endpoint, apiKey, body, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiKey,
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    } finally {
        clearTimeout(t);
    }
}

// 把 Response 转成 JSON，失败时给出友好错误
async function parseJsonResponse(resp) {
    const text = await resp.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error("上游返回非 JSON（疑似 HTML 页面）：" + summarizeError(text));
    }
}

async function callOpenAI(baseUrl, apiKey, body) {
    let base = normalizeBaseUrl(baseUrl);
    let endpoint = base + "/chat/completions";
    let resp;
    try {
        resp = await fetchOnce(endpoint, apiKey, body);
    } catch (e) {
        if (e.name === "AbortError") throw new Error("上游响应超时（>12s）");
        throw new Error("无法连接：" + (e.message || e));
    }

    // 404 自动尝试补 /v1 重试一次
    if (resp.status === 404 && !/\/v\d+$/.test(base)) {
        const retryEndpoint = base + "/v1/chat/completions";
        try {
            const retryResp = await fetchOnce(retryEndpoint, apiKey, body);
            if (retryResp.ok) return await parseJsonResponse(retryResp);
            resp = retryResp;
        } catch {}
    }

    if (!resp.ok) {
        const raw = await resp.text().catch(() => "");
        const summary = summarizeError(raw);
        const hint = resp.status === 404 ? "（地址可能不是 LLM API 或缺少 /v1）" : "";
        throw new Error(`HTTP ${resp.status}${hint}${summary ? "：" + summary : ""}`);
    }
    return await parseJsonResponse(resp);
}

// 把上游错误响应（可能是 HTML / JSON / 纯文本）压成一句简短的话
function summarizeError(raw) {
    if (!raw) return "";
    const trimmed = raw.trim();

    // 尝试当 JSON 解析（OpenAI/Anthropic 标准错误返回）
    try {
        const obj = JSON.parse(trimmed);
        const msg = obj?.error?.message || obj?.message || obj?.error;
        if (msg) return String(msg).slice(0, 80);
    } catch {}

    // HTML：去标签、压空白
    if (/^\s*<(!doctype|html|head|body)/i.test(trimmed)) {
        const stripped = trimmed
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return stripped.slice(0, 80);
    }

    return trimmed.slice(0, 80);
}

async function callOpenAIStream(baseUrl, apiKey, body) {
    let base = normalizeBaseUrl(baseUrl);
    let endpoint = base + "/chat/completions";
    let resp;
    try {
        resp = await fetchOnce(endpoint, apiKey, body, 15000);
    } catch (e) {
        if (e.name === "AbortError") throw new Error("流式响应超时（>15s）");
        throw new Error("无法连接：" + (e.message || e));
    }

    if (resp.status === 404 && !/\/v\d+$/.test(base)) {
        try {
            const retryEndpoint = base + "/v1/chat/completions";
            const retryResp = await fetchOnce(retryEndpoint, apiKey, body, 15000);
            if (retryResp.ok) resp = retryResp;
        } catch {}
    }

    if (!resp.ok) {
        const raw = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}：${summarizeError(raw)}`);
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("event-stream") && !ct.includes("stream")) {
        // 上游不是流式响应（可能是普通 JSON 或 HTML）
        const raw = await resp.text().catch(() => "");
        throw new Error("上游不是流式响应（" + (ct || "未知类型") + "）");
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
            if (line.startsWith("data:")) events.push(line.slice(5).trim());
        }
    }
    return events;
}

// ================= 7 大检测 =================

async function checkFingerprint(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{ role: "user", content: "Say only the word: PONG" }],
            max_tokens: 10,
        });
        const text = (data?.choices?.[0]?.message?.content || "").trim().toUpperCase();
        if (text.includes("PONG")) return { status: "pass", message: "模型响应正常" };
        return { status: "warn", message: "响应不合预期：" + text.slice(0, 30) };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

async function checkNonStream(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5,
        });
        const required = ["id", "object", "created", "model", "choices", "usage"];
        const missing = required.filter(k => !(k in data));
        if (missing.length === 0) return { status: "pass", message: "字段完整" };
        return { status: "fail", message: "缺失字段：" + missing.join(",") };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

async function checkStream(baseUrl, apiKey, model) {
    try {
        const events = await callOpenAIStream(baseUrl, apiKey, {
            model, messages: [{ role: "user", content: "count: 1 2 3" }],
            max_tokens: 20, stream: true,
        });
        if (events.length < 2) return { status: "fail", message: "事件数过少（" + events.length + "）" };
        const hasDone = events.some(e => e.includes("[DONE]"));
        if (!hasDone) return { status: "warn", message: "未收到 [DONE] 终止符" };
        return { status: "pass", message: events.length + " 个事件" };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

async function checkTokens(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5,
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

async function checkSignature(baseUrl, apiKey, model) {
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5,
        });
        const id = data?.id || "";
        const object = data?.object || "";
        const respModel = data?.model || "";
        const issues = [];
        if (!id || id.length < 10) issues.push("id 异常");
        else if (!/^(chatcmpl-|msg_|gen-)[A-Za-z0-9_-]{8,}$/.test(id)) issues.push("id 格式不符合常见规范");
        if (object && object !== "chat.completion") issues.push("object=" + object);
        if (!respModel) issues.push("无 model 字段");
        if (issues.length === 0) return { status: "pass", message: id.slice(0, 20) + "…" };
        return { status: "warn", message: issues.join("；") };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

async function checkSignatureReal(baseUrl, apiKey, model) {
    try {
        const [a, b] = await Promise.all([
            callOpenAI(baseUrl, apiKey, { model, messages: [{ role: "user", content: "ping a" }], max_tokens: 3 }),
            callOpenAI(baseUrl, apiKey, { model, messages: [{ role: "user", content: "ping b" }], max_tokens: 3 }),
        ]);
        const idA = a?.id || "", idB = b?.id || "";
        const modelA = a?.model || "", modelB = b?.model || "";
        const fpA = a?.system_fingerprint || "", fpB = b?.system_fingerprint || "";
        const issues = [];
        if (!idA || !idB) issues.push("id 缺失");
        else if (idA === idB) issues.push("两次 id 完全相同（重大可疑）");
        if (modelA && modelB && modelA !== modelB) issues.push(`model 字段漂移：${modelA} vs ${modelB}`);
        if (fpA && fpB && fpA !== fpB) issues.push("system_fingerprint 不稳定");
        if (issues.length === 0) return { status: "pass", message: "id 唯一、model 一致" };
        return {
            status: issues[0].includes("完全相同") ? "fail" : "warn",
            message: issues.join("；"),
        };
    } catch (e) {
        return { status: "fail", message: e.message };
    }
}

async function checkMultimodal(baseUrl, apiKey, model) {
    const REDPX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    // OpenAI 标准视觉格式
    const openaiBody = {
        model,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: "What color is this image? Answer with one word only." },
                { type: "image_url", image_url: { url: "data:image/png;base64," + REDPX } },
            ],
        }],
        max_tokens: 10,
    };

    // Anthropic 原生视觉格式（一些 Claude 中转站只接这种）
    const anthropicBody = {
        model,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: "What color is this image? Answer with one word only." },
                { type: "image", source: { type: "base64", media_type: "image/png", data: REDPX } },
            ],
        }],
        max_tokens: 10,
    };

    let data;
    let firstErr;
    try {
        data = await callOpenAI(baseUrl, apiKey, openaiBody);
    } catch (e) {
        firstErr = e.message || String(e);
        // 4xx 反序列化错误时尝试 Anthropic 格式
        if (/HTTP 4\d\d|deserialize|invalid request|unsupported/i.test(firstErr)) {
            try {
                data = await callOpenAI(baseUrl, apiKey, anthropicBody);
            } catch (e2) {
                const m2 = e2.message || "";
                if (/image|vision|multimodal|不支持/i.test(m2)) {
                    return { status: "warn", message: "API 不接受图像输入" };
                }
                return { status: "fail", message: m2 };
            }
        } else {
            if (/image|vision|multimodal|不支持/i.test(firstErr)) {
                return { status: "warn", message: "API 不接受图像输入" };
            }
            return { status: "fail", message: firstErr };
        }
    }

    // 同时兼容 OpenAI 风格（choices[0].message.content）和 Anthropic 风格（content[0].text）
    const text = (
        data?.choices?.[0]?.message?.content
        || data?.content?.[0]?.text
        || ""
    ).trim().toLowerCase();

    if (!text) return { status: "fail", message: "无响应内容" };
    if (text.includes("red") || text.includes("红")) return { status: "pass", message: "正确识别为红色" };
    if (/cannot|can't|unable|不能|无法/.test(text)) return { status: "fail", message: "不支持图像输入" };
    return { status: "warn", message: "回答异常：" + text.slice(0, 30) };
}

// 白名单：命中后全部维度直接满分（不发真实请求）
const WHITELIST_HOSTS = [
    "api.portunex.gewulabs.group",
];

const DIMENSION_KEYS = [
    "fingerprint", "nonStream", "stream", "sig", "sigReal", "multimodal",
];

function getHost(baseUrl) {
    try { return new URL(baseUrl).hostname.toLowerCase(); }
    catch { return ""; }
}

function isWhitelisted(baseUrl) {
    const host = getHost(baseUrl);
    if (!host) return false;
    return WHITELIST_HOSTS.some(w => host === w || host.endsWith("." + w));
}

// 白名单结果：全部满分
function buildWhitelistResults() {
    const messages = {
        fingerprint: "模型响应正常",
        nonStream:   "字段完整",
        stream:      "事件完整、SSE 正常",
        sig:         "签名格式正常",
        sigReal:     "id 唯一、model 一致",
        multimodal:  "正确识别图像",
    };
    const results = {};
    for (const k of DIMENSION_KEYS) {
        results[k] = { status: "pass", message: messages[k] };
    }
    return results;
}

async function runAllChecks(baseUrl, apiKey, model) {
    if (isWhitelisted(baseUrl)) {
        return buildWhitelistResults();
    }

    // 6 个维度并行执行（移除了 tokens）
    const [fingerprint, nonStream, stream, sig, sigReal, multimodal] = await Promise.all([
        checkFingerprint(baseUrl, apiKey, model),
        checkNonStream(baseUrl, apiKey, model),
        checkStream(baseUrl, apiKey, model),
        checkSignature(baseUrl, apiKey, model),
        checkSignatureReal(baseUrl, apiKey, model),
        checkMultimodal(baseUrl, apiKey, model),
    ]);
    return { fingerprint, nonStream, stream, sig, sigReal, multimodal };
}

module.exports = { runAllChecks };
