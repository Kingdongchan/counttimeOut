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
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-slate-500 text-xs">기록이 아직 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((entry, index) => {
    // [수정 핵심] 데이터 이름이 ms, count, today_accumulated_ms 중 무엇이든 숫자로 변환
    const rawMs = entry.ms || entry.count || entry.today_accumulated_ms || 0;
    const msValue = parseInt(rawMs);
    
    // transTime 호출 (숫자가 아닐 경우를 대비해 0으로 방어)
    const { h, m, s } = (typeof transTime === 'function' && !isNaN(msValue)) 
                        ? transTime(msValue) 
                        : { h: "00", m: "00", s: "00" };
    
    let rankBadge = index + 1;
    if (index === 0) rankBadge = "01 <span class='text-[10px]'>🥇</span>";
    else if (index === 1) rankBadge = "02 <span class='text-[10px]'>🥈</span>";
    else if (index === 2) rankBadge = "03 <span class='text-[10px]'>🥉</span>";
    else rankBadge = String(index + 1).padStart(2, '0');

    // 스크린샷의 디자인을 살리기 위해 상태 배지(접속 중 등)를 넣으려면 아래 구조 유지
    return `
      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors items-center">
        <td class="py-4 px-4 text-sm font-mono italic text-orange-500">${rankBadge}</td>
        <td class="py-4 px-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-slate-800 border border-orange-500/50"></div>
            <span class="text-sm font-bold text-slate-200">${escapeHtml(entry.nickname || '익명')}</span>
          </div>
        </td>
        <td class="py-4 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400 border border-green-500/30">접속 중</span>
        </td>
        <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
          ${h} : ${m} : ${s}
        </td>
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