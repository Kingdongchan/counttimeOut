// =============================================
// frontend/js/leaderboard.js
// 역할: 실시간/어제 기록 리더보드 및 상단 통계 대시보드 관리
// 작성자: 김동찬 (career-transitioning software engineer)
// =============================================

// 시스템 시작을 알리는 콘솔 로그
console.log("🚀 [리더보드] 시스템이 가동되었습니다.");

/**
 * 1. 리더보드 탭 전환 및 데이터 요청 함수
 * @param {string} mode - 'live' (실시간) 또는 'alltime' (역대)
 */
async function switchLeaderboardTab(mode) {
  console.log(`📡 [리더보드] ${mode} 모드 데이터 요청 중...`);
  
  // 탭 버튼 엘리먼트 가져오기
  const tabLive = document.getElementById("tab-live");
  const tabAlltime = document.getElementById("tab-alltime");

  // 버튼이 없으면 함수 종료 (에러 방지)
  if (!tabLive || !tabAlltime) return;

  // UI 스타일 전환: 선택된 모드에 따라 주황색(primary) 배경 적용 및 스타일 변경
  if (mode === 'live') {
    tabLive.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabAlltime.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  } else {
    tabAlltime.className = "bg-primary text-white px-4 py-1.5 rounded-md text-xs font-bold";
    tabLive.className = "px-4 py-1.5 rounded-md text-xs font-bold text-slate-400 hover:text-white transition-colors";
  }

  try {
    // API 주소가 정의되어 있는지 확인 (전역 변수 체크)
    if (typeof API_BASE === 'undefined') {
        console.error("🚨 [리더보드] API_BASE가 정의되지 않았습니다.");
        return;
    }

    // 서버에 리더보드 데이터 요청 (mode 파라미터 포함)
    const res = await fetch(`${API_BASE}/api/leaderboard?mode=${mode}`);
    // 서버 응답이 실패하면 에러 발생
    if (!res.ok) throw new Error("리더보드 로드 실패");
    
    // JSON 데이터 파싱
    const data = await res.json();
    // 데이터 구조에 따라 목록 추출 (data.leaderboard가 있으면 사용, 없으면 전체 사용)
    const list = data.leaderboard || data || [];
    
    // 추출된 목록으로 화면 그리기(렌더링) 시작
    renderLeaderboard(list);
  } catch (err) {
    // 에러 발생 시 콘솔에 출력
    console.error("[리더보드] 데이터 로드 실패:", err);
  }
}

/**
 * 2. 리더보드 데이터를 HTML로 변환하여 화면에 출력하는 함수
 * @param {Array} data - 서버에서 받은 유저 기록 목록
 */
function renderLeaderboard(data) {
    // 데이터를 넣을 테이블 본문(tbody) 엘리먼트 찾기
    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;

    // 데이터가 없을 경우 안내 문구 표시
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-slate-500 text-xs italic">기록이 아직 존재하지 않습니다.</td></tr>';
        updateDashboardStats([]); // 대시보드 수치도 0으로 초기화
        return;
    }

    // 데이터를 순회하며 테이블 행(tr) 생성
    tbody.innerHTML = data.map((entry, index) => {
        // 🛡️ [NaN 방어] ms 값이 들어있는 속성을 찾고, 숫자가 아니면 0으로 처리
        const rawValue = entry.ms || entry.today_accumulated_ms || entry.count || 0;
        
        // 🛡️ [데이터 정제] 숫자와 소수점 외의 모든 문자(n, undefined 등) 제거
        const cleanVal = String(rawValue).replace(/[^0-9.-]/g, ''); 
        
        // 🛡️ [정수 변환] 정제된 문자를 정수로 변환, 실패 시 0 고정
        const msValue = parseInt(cleanVal, 10) || 0;
        
        // 시간 변환 함수(transTime)가 존재하는지 확인 후 호출 (결과값 기본값 설정)
        let timeResult = { h: "00", m: "00", s: "00" };
        if (typeof transTime === 'function') {
            timeResult = transTime(msValue);
        }

        // 순위에 따른 뱃지 추가 (1, 2, 3위는 이모지 포함)
        let rankBadge = String(index + 1).padStart(2, '0');
        if (index === 0) rankBadge += " 🥇";
        else if (index === 1) rankBadge += " 🥈";
        else if (index === 2) rankBadge += " 🥉";

        // HTML 템플릿 반환
        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="py-4 px-4 text-sm font-mono italic text-orange-500">${rankBadge}</td>
            <td class="py-4 px-4">
              <div class="flex items-center gap-3">
                <img src="${entry.picture || 'assets/img/guest-avatar.png'}" class="w-8 h-8 rounded-full border border-orange-500/50" onerror="this.src='assets/img/guest-avatar.png'">
                <span class="text-sm font-bold text-slate-200">${escapeHtml(entry.nickname || '익명')}</span>
              </div>
            </td>
            <td class="py-4 px-4 text-center">
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">LIVE</span>
            </td>
            <td class="py-4 px-4 text-right font-mono text-white font-bold text-lg">
              ${timeResult.h} : ${timeResult.m} : ${timeResult.s}
            </td>
          </tr>
        `;
    }).join(''); // 배열을 하나의 문자열로 합침
    
    // 리더보드 로드 후 상단 대시보드 통계도 갱신
    updateDashboardStats(data);
}

/**
 * 3. 상단 대시보드 (경쟁자 수, 내 순위, 전체 평균) 업데이트 함수
 * @param {Array} data - 리더보드 데이터 배열
 */
function updateDashboardStats(data) {
    const liveCountEl = document.getElementById("live-count");
    const currentRankEl = document.getElementById("current-rank");
    const rankPercentEl = document.getElementById("rank-percentage");
    const sessionAvgEl = document.getElementById("session-average");

    // 1) 금일 경쟁자 수: 데이터 배열의 길이를 표시
    if (liveCountEl) {
        liveCountEl.textContent = data.length > 0 ? data.length.toLocaleString() : "0";
    }

    // 2) 내 순위 및 상위 % 계산
    if (currentRankEl) {
        // 내 로컬 정보와 비교하여 순위 찾기
        const userInfo = JSON.parse(localStorage.getItem("userInfo") || "{}");
        const myNickname = userInfo.nickname;
        const myIndex = data.findIndex(entry => entry.nickname === myNickname);
        
        if (myIndex !== -1) {
            const rank = myIndex + 1;
            currentRankEl.textContent = `#${rank}`; // 내 순위 표시
            if (rankPercentEl) {
                const percentage = ((rank / data.length) * 100).toFixed(1);
                rankPercentEl.textContent = `TOP ${percentage}%`; // 상위 퍼센트 표시
            }
        } else {
            currentRankEl.textContent = "--"; // 순위에 없으면 대시 처리
            if (rankPercentEl) rankPercentEl.textContent = "";
        }
    }

    // 3) 세션 평균 계산 🛡️ [NaN 방어 로직 적용]
    if (sessionAvgEl && data.length > 0) {
        // 모든 유저의 기록을 합산
        const totalMs = data.reduce((acc, cur) => {
            const val = cur.ms || cur.today_accumulated_ms || cur.count || 0;
            const parsed = parseInt(String(val).replace(/[^0-9.-]/g, ''), 10) || 0;
            return acc + parsed;
        }, 0);
        
        // 합산 결과를 참여 인원수로 나누어 평균 계산
        const avgMs = Math.floor(totalMs / data.length);
        const timeResult = (typeof transTime === 'function') ? transTime(avgMs) : { h: "00", m: "00", s: "00" };
        sessionAvgEl.textContent = `${timeResult.h}:${timeResult.m}:${timeResult.s}`;
    } else if (sessionAvgEl) {
        sessionAvgEl.textContent = "00:00:00"; // 데이터가 없으면 초기값 표시
    }
}

/**
 * 유틸리티: HTML 특수문자를 이스케이프하여 보안 강화 (XSS 방지)
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 페이지 로드 시 초기 실행 설정
 */
window.addEventListener('load', () => {
    // 0.5초 대기 후 리더보드 데이터 요청 (다른 스크립트 로드 대기)
    setTimeout(() => {
        switchLeaderboardTab('live');
    }, 500);
});