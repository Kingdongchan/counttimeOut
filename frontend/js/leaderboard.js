console.log("[leaderboard] script loaded");

let leaderboardInterval = null;
let currentLeaderboardMode = "live";

const LEADERBOARD_MODE_STORAGE_KEY = "leaderboard:selectedMode";
const ACTIVE_TAB_CLASS = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
const INACTIVE_TAB_CLASS = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";

function getSavedLeaderboardMode() {
  const savedMode = localStorage.getItem(LEADERBOARD_MODE_STORAGE_KEY);
  return savedMode === "alltime" ? "alltime" : "live";
}

function setCurrentLeaderboardMode(mode) {
  currentLeaderboardMode = mode === "alltime" ? "alltime" : "live";
  localStorage.setItem(LEADERBOARD_MODE_STORAGE_KEY, currentLeaderboardMode);
}

function applyLeaderboardTabUI(mode) {
  const tabLive = document.getElementById("tab-live");
  const tabAlltime = document.getElementById("tab-alltime");

  if (!tabLive || !tabAlltime) return;

  if (mode === "live") {
    tabLive.className = ACTIVE_TAB_CLASS;
    tabAlltime.className = INACTIVE_TAB_CLASS;
    return;
  }

  tabAlltime.className = ACTIVE_TAB_CLASS;
  tabLive.className = INACTIVE_TAB_CLASS;
}

async function requestLeaderboardData(mode) {
  if (typeof API_BASE === "undefined") return [];

  const response = await fetch(`${API_BASE}/api/leaderboard?mode=${mode}`);
  if (!response.ok) throw new Error("Failed to load leaderboard");

  const payload = await response.json();
  return payload.leaderboard || payload || [];
}

async function fetchLeaderboardData(mode) {
  try {
    const list = await requestLeaderboardData(mode);
    renderLeaderboard(list);
    return list;
  } catch (err) {
    console.error("[leaderboard] failed to fetch leaderboard data:", err);
    renderLeaderboard([]);
    return [];
  }
}

async function fetchLiveDashboardStats() {
  try {
    const liveList = await requestLeaderboardData("live");
    updateDashboardStats(liveList);
    return liveList;
  } catch (err) {
    console.error("[leaderboard] failed to fetch live dashboard stats:", err);
    updateDashboardStats([]);
    return [];
  }
}

async function refreshLeaderboardView() {
  const currentList = await fetchLeaderboardData(currentLeaderboardMode);

  if (currentLeaderboardMode === "live") {
    updateDashboardStats(currentList);
    return;
  }

  await fetchLiveDashboardStats();
}

async function switchLeaderboardTab(mode) {
  setCurrentLeaderboardMode(mode);
  applyLeaderboardTabUI(currentLeaderboardMode);
  startLeaderboardAutoRefresh();
  await refreshLeaderboardView();
}

function renderLeaderboard(data) {
  const tbody = document.getElementById("leaderboard-body");
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-slate-500 text-xs italic">기록이 아직 존재하지 않습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((entry, index) => {
    const rawValue = entry.ms || entry.today_accumulated_ms || 0;
    const msValue = parseInt(String(rawValue).replace(/[^0-9.-]/g, ""), 10) || 0;

    let timeResult = { h: "00", m: "00", s: "00" };
    if (typeof transTime === "function") {
      timeResult = transTime(msValue);
    }

    let rankBadge = String(index + 1).padStart(2, "0");
    if (index === 0) rankBadge += " 🥇";
    else if (index === 1) rankBadge += " 🥈";
    else if (index === 2) rankBadge += " 🥉";

    const isOnline = entry.is_online == true || entry.is_online === 1;
    const statusBadge = isOnline
      ? `<span class="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-bold">
           <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> LIVE
         </span>`
      : `<span class="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 border border-slate-500/20 font-bold opacity-60">
           <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> OFF-LINE
         </span>`;

    return `
      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
        <td class="py-4 px-4 text-sm font-mono italic text-orange-500">${rankBadge}</td>
        <td class="py-4 px-4">
          <div class="flex items-center gap-3">
            <img src="${entry.picture || 'assets/img/guest-avatar.png'}"
                 class="w-8 h-8 rounded-full border border-orange-500/50"
                 onerror="this.src='assets/img/guest-avatar.png'">
            <span class="text-sm font-bold text-slate-200">${escapeHtml(entry.nickname || "익명")}</span>
          </div>
        </td>
        <td class="py-4 px-4 text-center">${statusBadge}</td>
        <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
          ${timeResult.h} : ${timeResult.m} : ${timeResult.s}
        </td>
      </tr>
    `;
  }).join("");
}

function startLeaderboardAutoRefresh() {
  if (leaderboardInterval) return;

  leaderboardInterval = setInterval(() => {
    console.log("[leaderboard] auto refresh");
    refreshLeaderboardView();
  }, 60000);
}

function stopLeaderboardAutoRefresh() {
  if (!leaderboardInterval) return;

  clearInterval(leaderboardInterval);
  leaderboardInterval = null;
}

function updateDashboardStats(data) {
  const liveCountEl = document.getElementById("live-count");
  const currentRankEl = document.getElementById("current-rank");
  const rankPercentEl = document.getElementById("rank-percentage");
  const sessionAvgEl = document.getElementById("session-average");

  if (liveCountEl) {
    liveCountEl.textContent = data.length > 0 ? data.length.toLocaleString() : "0";
  }

  if (currentRankEl) {
    const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
    const myNickname = userInfo.nickname;
    const myIndex = data.findIndex((entry) => entry.nickname === myNickname);

    if (myIndex !== -1) {
      const rank = myIndex + 1;
      currentRankEl.textContent = `#${rank}`;

      if (rankPercentEl) {
        const percentage = ((rank / data.length) * 100).toFixed(1);
        rankPercentEl.textContent = `TOP ${percentage}%`;
      }
    } else {
      currentRankEl.textContent = "--";
      if (rankPercentEl) rankPercentEl.textContent = "";
    }
  }

  if (sessionAvgEl && data.length > 0) {
    const totalMs = data.reduce((acc, cur) => {
      const value = cur.ms || cur.today_accumulated_ms || 0;
      return acc + (parseInt(String(value).replace(/[^0-9.-]/g, ""), 10) || 0);
    }, 0);

    const avgMs = Math.floor(totalMs / data.length);
    const timeResult = typeof transTime === "function"
      ? transTime(avgMs)
      : { h: "00", m: "00", s: "00" };

    sessionAvgEl.textContent = `${timeResult.h}:${timeResult.m}:${timeResult.s}`;
  } else if (sessionAvgEl) {
    sessionAvgEl.textContent = "00:00:00";
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function initializeLeaderboard() {
  const initialMode = getSavedLeaderboardMode();
  applyLeaderboardTabUI(initialMode);
  setCurrentLeaderboardMode(initialMode);
  startLeaderboardAutoRefresh();
  refreshLeaderboardView();
}

window.switchLeaderboardTab = switchLeaderboardTab;
window.initializeLeaderboard = initializeLeaderboard;
window.refreshLeaderboardView = refreshLeaderboardView;
window.stopLeaderboardAutoRefresh = stopLeaderboardAutoRefresh;
