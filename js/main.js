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

const detectBtn  = document.getElementById("detectBtn");
const resultArea = document.getElementById("resultArea");
const resultList = document.getElementById("resultList");
const baseUrlInp = document.getElementById("baseUrl");
const apiKeyInp  = document.getElementById("apiKey");
const modelInp   = document.getElementById("model");

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
    resultArea.classList.remove("hidden");
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });

    // 把所有项目都标为 running
    CHECKS.forEach(c => setStatus(c.id, "running"));

    try {
        // 真实模式：调用本地后端
        const resp = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseUrl, apiKey, model }),
        });
        const data = await resp.json();

        if (!resp.ok || !data.ok) {
            throw new Error(data.error || "后端检测失败");
        }

        // 把后端结果渲染到对应项
        for (const check of CHECKS) {
            const r = data.results[check.id];
            if (r) {
                setStatus(check.id, r.status, r.message);
            } else {
                setStatus(check.id, "warn", "未实现");
            }
        }
    } catch (e) {
        // 后端没启动 → 退化为模拟检测
        console.warn("后端不可用，使用模拟检测：", e);
        for (const check of CHECKS) {
            const result = await mockRunCheck();
            setStatus(check.id, result.status, result.message);
        }
        showOfflineHint();
    }

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
        statusEl.innerHTML = `<span class="badge pass">通过${message ? " · " + message : ""}</span>`;
    } else if (status === "warn") {
        statusEl.innerHTML = `<span class="badge warn">可疑${message ? " · " + message : ""}</span>`;
    } else if (status === "fail") {
        statusEl.innerHTML = `<span class="badge fail">异常${message ? " · " + message : ""}</span>`;
    }
}

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
