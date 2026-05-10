// 牧羊人测评站 - 联系我们 Serverless Function
// 路由：POST /api/contact
// 提交内容会输出到 Vercel 函数日志（Vercel Dashboard → Logs 可查看）
// 后续可以接入数据库 / 第三方邮件服务（Resend、SendGrid）做更完善的处理

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const email   = String(body.email || "").trim();
        const message = String(body.message || "").trim();

        // 基本校验
        if (!email || !message) {
            return res.status(400).json({ error: "缺少 email 或 message" });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "邮箱格式无效" });
        }
        if (email.length > 200 || message.length > 4000) {
            return res.status(400).json({ error: "内容过长" });
        }

        // 极简反垃圾：明显 URL/广告关键词检测
        const ua = req.headers["user-agent"] || "unknown";
        const ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown";

        // 输出到 Vercel 函数日志
        console.log("=== 联系我们 ===");
        console.log("时间:", new Date().toISOString());
        console.log("邮箱:", email);
        console.log("内容:", message);
        console.log("IP:", ip);
        console.log("UA:", ua);
        console.log("================");

        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error("contact error:", e);
        return res.status(500).json({ error: e.message });
    }
};
