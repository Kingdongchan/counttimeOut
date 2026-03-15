// =============================================
// frontend/js/leaderboard.js
// 역할: 실시간/어제 기록 리더보드 및 상단 통계 대시보드 관리
// =============================================

console.log("🚀 [리더보드] 시스템이 가동되었습니다.");

/**
 * 1. 리더보드 탭 전환 및 데이터 요청
 */
async function switchLeaderboardTab(mode) {
  console.log(`📡 [리더보드] ${mode} 모드 데이터 요청 중...`);
  const tabLive = document.getElementById("tab-live");
  const tabAlltime = document.getElementById("tab-alltime");

  if (!tabLive || !tabAlltime) return;

  // UI 스타일 전환
  if (mode === 'live') {
    tabLive.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabAlltime.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  } else {
    tabAlltime.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabLive.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  }

  try {
    if (typeof API_BASE === 'undefined') {
        console.error("🚨 [리더보드] API_BASE가 정의되지 않았습니다.");
        return;
    }

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
 * 2. 리더보드 렌더링 및 대시보드 업데이트 호출
 */
function renderLeaderboard(data) {
    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-slate-500 text-xs italic">기록이 아직 존재하지 않습니다.</td></tr>';
        updateDashboardStats([]);
        return;
    }

    // 테이블 본문 생성 (상태와 시간 위치 교정 완료)
    tbody.innerHTML = data.map((entry, index) => {
        const rawMs = entry.ms || entry.today_accumulated_ms || entry.count || 0;
        const cleanMs = String(rawMs).replace(/n/g, ''); 
        const msValue = parseInt(cleanMs, 10);
        
        const { h, m, s } = (typeof transTime === 'function' && !isNaN(msValue)) 
            ? transTime(msValue) 
            : { h: "00", m: "00", s: "00" };

        let rankBadge = String(index + 1).padStart(2, '0');
        if (index === 0) rankBadge += " 🥇";
        else if (index === 1) rankBadge += " 🥈";
        else if (index === 2) rankBadge += " 🥉";

        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="py-4 px-4 text-sm font-mono italic text-orange-500">${rankBadge}</td>
            <td class="py-4 px-4">
              <div class="flex items-center gap-3">
                <img src="${entry.picture || 'https://via.placeholder.com/32'}" class="w-8 h-8 rounded-full border border-orange-500/50" onerror="this.src='https://via.placeholder.com/32'">
                <span class="text-sm font-bold text-slate-200">${escapeHtml(entry.nickname || '익명')}</span>
              </div>
            </td>
            <td class="py-4 px-4 text-center">
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">LIVE</span>
            </td>
            <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
              ${h} : ${m} : ${s}
            </td>
          </tr>
        `;
    }).join('');
    
    // 대시보드 수치 업데이트
    updateDashboardStats(data);
}

/**
 * 3. 상단 대시보드 (경쟁자, 순위, 평균) 업데이트
 */
function updateDashboardStats(data) {
    const liveCountEl = document.getElementById("live-count");
    const currentRankEl = document.getElementById("current-rank");
    const rankPercentEl = document.getElementById("rank-percentage");
    const sessionAvgEl = document.getElementById("session-average");

    // 1) 금일 경쟁자 수
    if (liveCountEl) {
        liveCountEl.textContent = data.length > 0 ? data.length : "0";
    }

    // 2) 내 순위 및 상위 %
    if (currentRankEl) {
        const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
        const myNickname = userInfo.nickname;
        const myIndex = data.findIndex(entry => entry.nickname === myNickname);
        
        if (myIndex !== -1) {
            const rank = myIndex + 1;
            currentRankEl.textContent = rank;
            if (rankPercentEl) {
                const percentage = ((rank / data.length) * 100).toFixed(1);
                rankPercentEl.textContent = `TOP ${percentage}%`;
            }
        } else {
            currentRankEl.textContent = "--";
            if (rankPercentEl) rankPercentEl.textContent = "";
        }
    }

    // 3) 세션 평균 계산
    if (sessionAvgEl && data.length > 0) {
        const totalMs = data.reduce((acc, cur) => {
            const val = cur.ms || cur.today_accumulated_ms || cur.count || 0;
            return acc + parseInt(String(val).replace(/n/g, ''), 10);
        }, 0);
        
        const avgMs = Math.floor(totalMs / data.length);
        const { h, m, s } = (typeof transTime === 'function') ? transTime(avgMs) : { h: "00", m: "00", s: "00" };
        sessionAvgEl.textContent = `${h}:${m}:${s}`;
    } else if (sessionAvgEl) {
        sessionAvgEl.textContent = "--:--:--";
    }
}

/**
 * 유틸리티: HTML 이스케이프
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 초기 실행
 */
window.addEventListener('load', () => {
    setTimeout(() => {
        switchLeaderboardTab('live');
    }, 500);
});