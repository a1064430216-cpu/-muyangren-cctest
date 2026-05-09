// 牧羊人测评站 - Vercel Serverless Function
// 路由：POST /api/check
const { runAllChecks } = require("../lib/checks.js");

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        // Vercel 自动解析 JSON body
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const { baseUrl, apiKey, model } = body;

        if (!baseUrl || !apiKey || !model) {
            return res.status(400).json({ error: "Missing baseUrl / apiKey / model" });
        }

        const results = await runAllChecks(baseUrl, apiKey, model);
        return res.status(200).json({ ok: true, results });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

// Vercel Serverless 默认超时 10s（Hobby），最长可改 60s
module.exports.config = { maxDuration: 60 };
