// 牧羊人测评站 - 前端交互脚本

const CHECKS = [
    { id: "fingerprint", name: "LLM 指纹验证",      icon: "🔍" },
    { id: "stream",      name: "流结构完整性",       icon: "🌊" },
    { id: "nonStream",   name: "非流结构完整性",     icon: "📦" },
    { id: "sig",         name: "签名校验",           icon: "🖋️" },
    { id: "sigReal",     name: "签名真实性",         icon: "✅" },
    { id: "multimodal",  name: "多模态能力",         icon: "🖼️" },
    { id: "tokens",      name: "Token 用量审计",    icon: "💰" },
];

// 评分权重：每个维度 100/7 ≈ 14.29 分；pass=满分，warn=半分，fail=0 分
const STATUS_SCORE = { pass: 1.0, warn: 0.5, fail: 0.0 };

// 圆环周长 = 2 × π × 52 ≈ 326.73
const RING_LENGTH = 326.73;

const detectBtn  = document.getElementById("detectBtn");
const resultArea = document.getElementById("resultArea");
const resultList = document.getElementById("resultList");
const baseUrlInp = document.getElementById("baseUrl");
const apiKeyInp  = document.getElementById("apiKey");
const modelInp   = document.getElementById("model");

const scorePanel    = document.getElementById("scorePanel");
const scoreNum      = document.getElementById("scoreNum");
const scoreGrade    = document.getElementById("scoreGrade");
const scoreDesc     = document.getElementById("scoreDesc");
const scoreStats    = document.getElementById("scoreStats");
const scoreProgress = document.getElementById("scoreProgress");

detectBtn.addEventListener("click", onDetect);

async function onDetect() {
    const baseUrl = baseUrlInp.value.trim();
    const apiKey  = apiKeyInp.value.trim();
    const model   = modelInp.value;

    if (!baseUrl || !apiKey) {
        alert("请填写 API 中转地址和 API Key");
        return;
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
        alert("Base URL 必须以 http:// 或 https:// 开头");
        return;
    }

    detectBtn.disabled = true;
    detectBtn.textContent = "检测中…";
    renderInitial();
    resetScorePanel();
    resultArea.classList.remove("hidden");
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });

    CHECKS.forEach(c => setStatus(c.id, "running"));

    let collected = {};
    try {
        const resp = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseUrl, apiKey, model }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || "后端检测失败");

        for (const check of CHECKS) {
            const r = data.results[check.id];
            if (r) {
                setStatus(check.id, r.status, r.message);
                collected[check.id] = r;
            } else {
                setStatus(check.id, "warn", "未实现");
                collected[check.id] = { status: "warn", message: "未实现" };
            }
        }
    } catch (e) {
        console.warn("后端不可用，使用模拟检测：", e);
        for (const check of CHECKS) {
            const result = await mockRunCheck();
            setStatus(check.id, result.status, result.message);
            collected[check.id] = result;
        }
        showOfflineHint();
    }

    updateScorePanel(collected);

    detectBtn.disabled = false;
    detectBtn.textContent = "重新检测";
}

function renderInitial() {
    resultList.innerHTML = "";
    for (const check of CHECKS) {
        const div = document.createElement("div");
        div.className = "result-item";
        div.id = `r-${check.id}`;
        div.innerHTML = `
            <div class="item-name">
                <span>${check.icon}</span>
                <span>${check.name}</span>
            </div>
            <div class="item-status">
                <span class="badge pending">等待中</span>
            </div>
        `;
        resultList.appendChild(div);
    }
}

function setStatus(id, status, message = "") {
    const row = document.getElementById(`r-${id}`);
    if (!row) return;
    const statusEl = row.querySelector(".item-status");
    if (status === "running") {
        statusEl.innerHTML = `<span class="spinner"></span>`;
    } else if (status === "pass") {
        statusEl.innerHTML = `<span class="badge pass">通过${message ? " · " + escapeHtml(message) : ""}</span>`;
    } else if (status === "warn") {
        statusEl.innerHTML = `<span class="badge warn">可疑${message ? " · " + escapeHtml(message) : ""}</span>`;
    } else if (status === "fail") {
        statusEl.innerHTML = `<span class="badge fail">异常${message ? " · " + escapeHtml(message) : ""}</span>`;
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

// ============ 评分面板 ============

function resetScorePanel() {
    scorePanel.className = "score-panel is-loading";
    scoreNum.textContent = "0";
    scoreGrade.textContent = "检测中…";
    scoreDesc.textContent = "正在跑 7 大维度的黑盒检测";
    scoreStats.innerHTML = "";
    scoreProgress.style.strokeDashoffset = RING_LENGTH;
}

function updateScorePanel(results) {
    // 计算总分
    let sum = 0;
    let counts = { pass: 0, warn: 0, fail: 0 };
    for (const check of CHECKS) {
        const r = results[check.id];
        const status = (r && r.status) || "fail";
        sum += STATUS_SCORE[status] ?? 0;
        if (counts[status] != null) counts[status]++;
    }
    const score = Math.round((sum / CHECKS.length) * 100);

    // 等级判定
    const grade = gradeOf(score);

    // 更新面板 class
    scorePanel.className = "score-panel grade-" + grade.key;

    // 数字动画
    animateNumber(scoreNum, 0, score, 1100);

    // 圆环动画
    const offset = RING_LENGTH * (1 - score / 100);
    requestAnimationFrame(() => {
        scoreProgress.style.strokeDashoffset = offset;
    });

    // 文案
    scoreGrade.textContent = grade.label;
    scoreDesc.textContent  = grade.desc;

    // 分项统计
    scoreStats.innerHTML = `
        <span class="dot-pass">通过 ${counts.pass}</span>
        <span class="dot-warn">可疑 ${counts.warn}</span>
        <span class="dot-fail">异常 ${counts.fail}</span>
    `;
}

function gradeOf(score) {
    if (score >= 90) return { key: "excellent", label: "优秀 · 推荐使用",  desc: "各项指标接近官方表现，未发现明显异常，可放心使用。" };
    if (score >= 70) return { key: "good",      label: "良好 · 基本可用",  desc: "整体表现尚可，存在少量可疑项，建议关注后续稳定性。" };
    if (score >= 50) return { key: "fair",      label: "一般 · 谨慎使用",  desc: "存在多项异常或可疑响应，建议小额试用并持续监控。" };
    return                  { key: "bad",       label: "较差 · 不推荐",    desc: "大量维度未通过，疑似套壳、降智或虚假计费，不建议长期使用。" };
}

function animateNumber(el, from, to, duration) {
    const start = performance.now();
    function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ============ 离线兜底 ============

function showOfflineHint() {
    if (document.getElementById("offlineHint")) return;
    const hint = document.createElement("p");
    hint.id = "offlineHint";
    hint.className = "form-hint";
    hint.style.color = "#fbbf24";
    hint.textContent = "⚠ 当前为离线模拟模式。运行 node server.js 启动后端后即可真实检测。";
    resultArea.appendChild(hint);
}

function mockRunCheck() {
    return new Promise((resolve) => {
        setTimeout(() => {
            const r = Math.random();
            if (r < 0.7)      resolve({ status: "pass", message: "OK" });
            else if (r < 0.9) resolve({ status: "warn", message: "需要进一步确认" });
            else              resolve({ status: "fail", message: "未通过" });
        }, 600 + Math.random() * 800);
    });
}
