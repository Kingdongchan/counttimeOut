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
    console.log("🎨 [리더보드] 화면 렌더링 시작");
    const tbody = document.getElementById("leaderboard-body");
    
    if (!tbody) {
        console.error("🚫 [리더보드] 에러: HTML에서 'leaderboard-body' 요소를 찾을 수 없습니다!");
        return;
    }

    if (!data || data.length === 0) {
        console.log("⚠️ [리더보드] 표시할 데이터가 없습니다.");
        tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-slate-500 text-xs italic">기록이 아직 존재하지 않습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map((entry, index) => {
        // [핵심] BigInt의 'n' 처리 및 숫자 변환
        const rawMs = entry.ms || entry.today_accumulated_ms || entry.count || 0;
        const cleanMs = String(rawMs).replace(/n/g, '');
        const msValue = parseInt(cleanMs, 10);
        
        // transTime 존재 여부 확인 로그 (최초 1회만)
        if (index === 0) {
            console.log(`🔧 [리더보드] 첫 번째 항목 변환 시도: 원본(${rawMs}) -> 정제(${cleanMs}) -> 숫자(${msValue})`);
            if (typeof transTime !== 'function') {
                console.error("🚨 [리더보드] 에러: timer.js의 transTime 함수를 찾을 수 없습니다!");
            }
        }

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
            <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
              ${h} : ${m} : ${s}
            </td>
          </tr>
        `;
    }).join('');
    
    console.log("✅ [리더보드] 화면 업데이트 완료");
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