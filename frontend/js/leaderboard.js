// =============================================
// frontend/js/leaderboard.js
// 역할: 실시간/역대 리더보드 관리 및 1분 주기 자동 갱신 로직 포함
// 작성자: 김동찬 (career-transitioning software engineer)
// =============================================

console.log("🚀 [리더보드] 시스템이 가동되었습니다.");

// 자동 갱신을 위한 타이머 변수
let leaderboardInterval = null;

/**
 * 1. 리더보드 탭 전환 및 데이터 요청 함수
 */
async function switchLeaderboardTab(mode) {
  // 새로고침 시 기존 자동 갱신 타이머가 있다면 초기화 (중복 방지)
  stopLeaderboardAutoRefresh();

  console.log(`📡 [리더보드] ${mode} 모드 데이터 요청 중...`);
  
  const tabLive = document.getElementById("tab-live");
  const tabAlltime = document.getElementById("tab-alltime");

  if (!tabLive || !tabAlltime) return;

  // UI 스타일 전환
  if (mode === 'live') {
    tabLive.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabAlltime.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
    
    // [해결 3] 실시간 모드일 때만 1분마다 자동 갱신 시작
    startLeaderboardAutoRefresh();
  } else {
    tabAlltime.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabLive.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  }

  await fetchLeaderboardData(mode);
}

/**
 * 실제 데이터를 가져오는 핵심 함수 (중복 호출 대응)
 */
async function fetchLeaderboardData(mode) {
  try {
    if (typeof API_BASE === 'undefined') return;

    const res = await fetch(`${API_BASE}/api/leaderboard?mode=${mode}`);
    if (!res.ok) throw new Error("리더보드 로드 실패");
    
    const data = await res.json();
    const list = data.leaderboard || data || [];
    
    renderLeaderboard(list);
  } catch (err) {
    console.error("[리더보드] 데이터 로드 실패:", err);
  }
}

/**
 * 2. 리더보드 데이터를 HTML로 렌더링
 */
function renderLeaderboard(data) {
    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;

    // [해결 1] 새로고침 시 기록이 사라지는 현상 방지: 데이터가 들어올 때까지 기존 내용을 유지하거나, 명확한 안내 표시
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-slate-500 text-xs italic">기록이 아직 존재하지 않습니다.</td></tr>';
        updateDashboardStats([]);
        return;
    }

    tbody.innerHTML = data.map((entry, index) => {
        // [해결 1] 데이터 정제 강화: 숫자가 아닌 값이 들어와도 0으로 처리하여 렌더링 오류 방지
        const rawValue = entry.ms || entry.today_accumulated_ms || 0;
        const msValue = parseInt(String(rawValue).replace(/[^0-9.-]/g, ''), 10) || 0;
        
        let timeResult = { h: "00", m: "00", s: "00" };
        if (typeof transTime === 'function') {
            timeResult = transTime(msValue);
        }

        let rankBadge = String(index + 1).padStart(2, '0');
        if (index === 0) rankBadge += " 🥇";
        else if (index === 1) rankBadge += " 🥈";
        else if (index === 2) rankBadge += " 🥉";

        // [해결 2] Online 상태 판별 (숫자 1 또는 boolean true 대응)
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
                <span class="text-sm font-bold text-slate-200">${escapeHtml(entry.nickname || '익명')}</span>
              </div>
            </td>
            <td class="py-4 px-4 text-center">${statusBadge}</td>
            <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
              ${timeResult.h} : ${timeResult.m} : ${timeResult.s}
            </td>
          </tr>
        `;
    }).join('');
    
    updateDashboardStats(data);
}

/**
 * [해결 3] 1분 자동 갱신 로직 관련 함수들
 */
function startLeaderboardAutoRefresh() {
    if (leaderboardInterval) return;
    leaderboardInterval = setInterval(() => {
        console.log("🔄 [리더보드] 1분 주기 자동 갱신 실행");
        fetchLeaderboardData('live');
    }, 60000); // 1분
}

function stopLeaderboardAutoRefresh() {
    if (leaderboardInterval) {
        clearInterval(leaderboardInterval);
        leaderboardInterval = null;
    }
}

// ... updateDashboardStats, escapeHtml 함수는 기존과 동일 ...

function updateDashboardStats(data) {
    const liveCountEl = document.getElementById("live-count");
    const currentRankEl = document.getElementById("current-rank");
    const rankPercentEl = document.getElementById("rank-percentage");
    const sessionAvgEl = document.getElementById("session-average");

    if (liveCountEl) liveCountEl.textContent = data.length > 0 ? data.length.toLocaleString() : "0";

    if (currentRankEl) {
        const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
        const myNickname = userInfo.nickname;
        const myIndex = data.findIndex(entry => entry.nickname === myNickname);
        
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
            const val = cur.ms || cur.today_accumulated_ms || 0;
            return acc + (parseInt(String(val).replace(/[^0-9.-]/g, ''), 10) || 0);
        }, 0);
        const avgMs = Math.floor(totalMs / data.length);
        const timeResult = (typeof transTime === 'function') ? transTime(avgMs) : { h: "00", m: "00", s: "00" };
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

window.addEventListener('load', () => {
    setTimeout(() => { switchLeaderboardTab('live'); }, 500);
});