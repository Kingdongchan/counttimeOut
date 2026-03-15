// =============================================
// frontend/js/leaderboard.js
// 역할: 실시간/어제 기록 리더보드 데이터 로딩 및 렌더링
// =============================================

async function switchLeaderboardTab(mode) {
  const tabLive = document.getElementById("tab-live");
  const tabAlltime = document.getElementById("tab-alltime");

  if (!tabLive || !tabAlltime) return;

  // 1. 버튼 UI 활성화 스타일 전환
  if (mode === 'live') {
    tabLive.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabAlltime.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  } else {
    tabAlltime.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabLive.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  }

  // 2. 서버에서 리더보드 데이터 가져오기
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?mode=${mode}`);
    if (!res.ok) throw new Error("리더보드 로드 실패");
    
    const { leaderboard } = await res.json();
    renderLeaderboard(leaderboard);
  } catch (err) {
    console.error("[리더보드] 데이터 로드 실패:", err);
  }
}

function renderLeaderboard(data) {
  const tbody = document.getElementById("leaderboard-body");
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-10 text-slate-500 text-xs">기록이 아직 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((entry, index) => {
    // timer.js에 정의된 transTime 함수가 전역에 있어야 합니다.
    const { h, m, s } = typeof transTime === 'function' ? transTime(entry.ms) : { h: "00", m: "00", s: "00" };
    
    let rankBadge = index + 1;
    if (index === 0) rankBadge = "🥇";
    else if (index === 1) rankBadge = "🥈";
    else if (index === 2) rankBadge = "🥉";

    return `
      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
        <td class="py-3 px-4 text-[10px] font-mono text-slate-500">${rankBadge}</td>
        <td class="py-3 px-4 text-xs font-bold text-slate-300">${escapeHtml(entry.nickname || '익명')}</td>
        <td class="py-3 px-4 text-xs font-mono text-primary text-right">${h}:${m}:${s}</td>
      </tr>
    `;
  }).join('');
}

// HTML 특수문자 치환 (보안용)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// 페이지 로드 시 기본으로 '실시간' 리더보드 표시
document.addEventListener("DOMContentLoaded", () => {
  // API_BASE가 정의될 시간을 벌기 위해 약간의 지연 후 실행하거나, 정의 확인 후 실행
  setTimeout(() => {
    switchLeaderboardTab('live');
  }, 100);
});