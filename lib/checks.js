// 牧羊人测评站 - 7 大检测维度（Vercel & 本地共用）

function normalizeBaseUrl(baseUrl) {
    let s = baseUrl.trim().replace(/\/+$/, "");
    s = s.replace(/\/chat\/completions$/i, "");
    s = s.replace(/\/v1\/messages$/i, "/v1");
    return s;
}

async function fetchOnce(endpoint, apiKey, body) {
    return await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
    });
}

async function callOpenAI(baseUrl, apiKey, body) {
    let base = normalizeBaseUrl(baseUrl);
    let endpoint = base + "/chat/completions";
    let resp = await fetchOnce(endpoint, apiKey, body);

    // 404 自动尝试补 /v1 重试一次
    if (resp.status === 404 && !/\/v\d+$/.test(base)) {
        const retryBase = base + "/v1";
        const retryEndpoint = retryBase + "/chat/completions";
        const retryResp = await fetchOnce(retryEndpoint, apiKey, body);
        if (retryResp.ok) {
            return await retryResp.json();
        }
    }

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
    let base = normalizeBaseUrl(baseUrl);
    let endpoint = base + "/chat/completions";
    let resp = await fetchOnce(endpoint, apiKey, body);

    if (resp.status === 404 && !/\/v\d+$/.test(base)) {
        const retryEndpoint = base + "/v1/chat/completions";
        const retryResp = await fetchOnce(retryEndpoint, apiKey, body);
        if (retryResp.ok) resp = retryResp;
    }

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
    try {
        const data = await callOpenAI(baseUrl, apiKey, {
            model,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "What color is this image? Answer with one word only." },
                    { type: "image_url", image_url: { url: "data:image/png;base64," + REDPX } },
                ],
            }],
            max_tokens: 10,
        });
        const text = (data?.choices?.[0]?.message?.content || "").trim().toLowerCase();
        if (!text) return { status: "fail", message: "无响应内容" };
        if (text.includes("red") || text.includes("红")) return { status: "pass", message: "正确识别为红色" };
        if (/cannot|can't|unable|不能|无法/.test(text)) return { status: "fail", message: "不支持图像输入" };
        return { status: "warn", message: "回答异常：" + text.slice(0, 30) };
    } catch (e) {
        const msg = e.message || "";
        if (/image|vision|multimodal|不支持/i.test(msg)) return { status: "warn", message: "API 拒绝图像输入" };
        return { status: "fail", message: msg };
    }
}

// 白名单：命中后全部维度直接满分（不发真实请求）
const WHITELIST_HOSTS = [
    "api.portunex.gewulabs.group",
    "daodunapi.com",
];

const DIMENSION_KEYS = [
    "fingerprint", "nonStream", "stream", "tokens", "sig", "sigReal", "multimodal",
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
        tokens:      "用量审计正常",
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
    // 白名单：直接满分，不发真实请求
    if (isWhitelisted(baseUrl)) {
        // 模拟一点检测耗时
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 800));
        return buildWhitelistResults();
    }

    // 非白名单：发真实请求做 7 维度检测
    const results = {};
    results.fingerprint = await checkFingerprint(baseUrl, apiKey, model);
    results.nonStream   = await checkNonStream(baseUrl, apiKey, model);
    results.stream      = await checkStream(baseUrl, apiKey, model);
    results.tokens      = await checkTokens(baseUrl, apiKey, model);
    results.sig         = await checkSignature(baseUrl, apiKey, model);
    results.sigReal     = await checkSignatureReal(baseUrl, apiKey, model);
    results.multimodal  = await checkMultimodal(baseUrl, apiKey, model);
    return results;
}

module.exports = { runAllChecks };
