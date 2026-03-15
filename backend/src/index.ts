// =============================================
// backend/src/index.ts
// Cloudflare Workers 메인 서버 (무료 플랜 최적화 버전)
// =============================================

// --- 타입 정의 (Durable Object 관련 제거) ---
interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ADMIN_EMAIL: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS 헤더 설정
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. [시간 동기화]
      if (path === "/api/time" && method === "GET") {
        return jsonResponse({ serverTime: Date.now() }, corsHeaders);
      }

      // 2. [구글 로그인]
      if (path === "/api/auth/google" && method === "POST") {
        return await handleGoogleAuth(request, env, corsHeaders);
      }

      // 3. [세션 확인]
      if (path === "/api/auth/check" && method === "GET") {
        return await handleAuthCheck(request, env, corsHeaders);
      }

      // 4. [로그아웃]
      if (path === "/api/auth/logout" && method === "POST") {
        return await handleLogout(request, env, corsHeaders);
      }

      // 5. [닉네임 설정/변경/체크]
      if (path === "/api/nickname/set" && method === "POST") return await handleNicknameSet(request, env, corsHeaders);
      if (path === "/api/nickname/change" && method === "POST") return await handleNicknameChange(request, env, corsHeaders);
      if (path === "/api/nickname/check" && method === "GET") return await handleNicknameCheck(request, env, corsHeaders);

      // 6. [타이머 API]
      if (path === "/api/timer/get" && method === "GET") return await handleGetTimer(request, env, corsHeaders);
      if (path === "/api/timer/update" && method === "POST") return await handleUpdateTimer(request, env, corsHeaders);

      // 7. [리더보드]
      if (path === "/api/leaderboard" && method === "GET") return await handleLeaderboard(request, env, corsHeaders);

      // 8. [채팅 API]
      if (path === "/api/chat/send" && method === "POST") return await handleSendChat(request, env, corsHeaders);
      if (path === "/api/chat/history" && method === "GET") return await handleChatHistory(request, env, corsHeaders);

      // 9. [관리자 API]
      if (path === "/api/admin/midnight-reset" && method === "POST") return await handleMidnightReset(request, env, corsHeaders);
      if (path === "/api/admin/force-stop" && method === "POST") return await handleAdminForceStop(request, env, corsHeaders);

      return jsonResponse({ error: "존재하지 않는 경로입니다" }, corsHeaders, 404);

    } catch (err: any) {
      console.error("서버 오류:", err);
      return jsonResponse({ error: "서버 내부 오류", message: err.message }, corsHeaders, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await midnightReset(env);
  },
};

// =============================================
// API 핸들러 함수들
// =============================================

async function handleGoogleAuth(request: Request, env: Env, corsHeaders: any) {
  const { idToken } = await request.json() as { idToken: string };
  const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!googleResponse.ok) return jsonResponse({ error: "유효하지 않은 토큰" }, corsHeaders, 401);

  const googleUser = await googleResponse.json() as any;
  const role = googleUser.email === env.ADMIN_EMAIL ? "admin" : "user";

  await env.DB.prepare(`
    INSERT INTO users (id, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture
  `).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, role).run();

  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (session_id, user_id) VALUES (?, ?)").bind(sessionId, googleUser.sub).run();
  
  await env.DB.prepare("INSERT OR IGNORE INTO daily_record (user_id, nickname) VALUES (?, ?)").bind(googleUser.sub, googleUser.name).run();

  const freshUser = await env.DB.prepare("SELECT id, name, nickname, picture, email, role FROM users WHERE id = ?").bind(googleUser.sub).first();
  return jsonResponse({ sessionId, user: freshUser }, corsHeaders);
}

async function handleAuthCheck(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ valid: false }, corsHeaders, 401);

  const result = await env.DB.prepare(`
    SELECT u.id, u.name, u.nickname, u.picture, u.email, u.role FROM users u WHERE u.id = ?
  `).bind(userId).first();
  return jsonResponse({ valid: true, user: result }, corsHeaders);
}

async function handleLogout(request: Request, env: Env, corsHeaders: any) {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (sessionId) await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleNicknameSet(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { nickname } = await request.json() as { nickname: string };
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  await env.DB.prepare("UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?").bind(nickname.trim(), Date.now(), userId).run();
  await env.DB.prepare("UPDATE daily_record SET nickname = ? WHERE user_id = ?").bind(nickname.trim(), userId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleNicknameChange(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { nickname } = await request.json() as { nickname: string };
  // 간단 구현 (쿨다운 로직은 유지하거나 필요시 추가)
  await env.DB.prepare("UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?").bind(nickname.trim(), Date.now(), userId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleNicknameCheck(request: Request, env: Env, corsHeaders: any) {
  const url = new URL(request.url);
  const nickname = url.searchParams.get("nickname") || "";
  const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(nickname.trim()).first();
  return jsonResponse({ available: !existing }, corsHeaders);
}

async function handleGetTimer(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const today = new Date().toISOString().split("T")[0]; // 현재 날짜 (KST 기준은 서버 시간에 따라 다를 수 있음)

  // 오늘 날짜의 기록이 있는지 확인
  let record = await env.DB.prepare(
    "SELECT today_accumulated_ms FROM daily_record WHERE user_id = ? AND date = ?"
  ).bind(userId, today).first() as any;

  // 만약 오늘 기록이 없다면 (새벽에 처음 접속 등), 0으로 응답
  return jsonResponse({ today_accumulated_ms: record?.today_accumulated_ms || 0 }, corsHeaders);
}

async function handleUpdateTimer(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { accumulatedMs, tabId } = await request.json() as any;
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const today = new Date().toISOString().split("T")[0];
  const nickname = await getUserCurrentNickname(userId, env);

  // 핵심: user_id와 date가 겹치면 업데이트, 아니면 새로 한 줄 추가
  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, current_tab_id, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, date) DO UPDATE SET 
      today_accumulated_ms = excluded.today_accumulated_ms,
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, nickname, today, accumulatedMs, tabId).run();

  return jsonResponse({ success: true }, corsHeaders);
}

async function handleLeaderboard(request: Request, env: Env, corsHeaders: any) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode"); // 'live' 또는 'alltime'
  
  const today = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
  const yesterday = new Date(new Date().getTime() + (9 * 60 * 60 * 1000) - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  if (mode === "alltime") {
    // 1. 역대 기록 (history_record) - 비어있으면 빈 배열이 나갑니다.
    const { results } = await env.DB.prepare(`
      SELECT u.nickname, u.picture, h.count as ms 
      FROM history_record h
      JOIN users u ON h.user_id = u.id
      WHERE h.date = ? ORDER BY h.count DESC LIMIT 100
    `).bind(yesterday).all();
    return jsonResponse({ leaderboard: results }, corsHeaders);
  } else {
    // 2. 실시간 기록 (daily_record)
    const { results } = await env.DB.prepare(`
      SELECT u.nickname, u.picture, d.today_accumulated_ms as ms 
      FROM daily_record d
      JOIN users u ON d.user_id = u.id
      WHERE d.date = ? AND d.today_accumulated_ms > 0
      ORDER BY d.today_accumulated_ms DESC LIMIT 100
    `).bind(today).all();
    return jsonResponse({ leaderboard: results }, corsHeaders);
  }
}

async function handleSendChat(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);
  const { message, liveTime } = await request.json() as any;
  const nickname = await getUserCurrentNickname(userId, env);

  await env.DB.prepare("INSERT INTO chat_logs (user_id, nickname, message, live_time) VALUES (?, ?, ?, ?)")
    .bind(userId, nickname, message, liveTime).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleChatHistory(request: Request, env: Env, corsHeaders: any) {
  const { results } = await env.DB.prepare("SELECT nickname, message, live_time, created_at FROM chat_logs ORDER BY created_at DESC LIMIT 30").all();
  return jsonResponse({ messages: results.reverse() }, corsHeaders);
}

async function handleMidnightReset(request: Request, env: Env, corsHeaders: any) {
  await midnightReset(env);
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleAdminForceStop(request: Request, env: Env, corsHeaders: any) {
  const { targetUserId } = await request.json() as any;
  await env.DB.prepare("UPDATE daily_record SET current_tab_id = 'BLOCKED' WHERE user_id = ?").bind(targetUserId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

// =============================================
// 유틸리티 함수
// =============================================

async function midnightReset(env: Env) {
  const now = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString().split("T")[0];

  // history_record의 컬럼(user_id, date, count)에 맞춰서 INSERT
  await env.DB.prepare(`
    INSERT INTO history_record (user_id, date, count) 
    SELECT user_id, date, today_accumulated_ms 
    FROM daily_record 
    WHERE date = ? AND today_accumulated_ms > 0
  `).bind(yesterday).run();

  // 이전 기록 정리 (선택 사항: daily_record에서 어제 데이터 삭제)
  await env.DB.prepare("DELETE FROM daily_record WHERE date = ?").bind(yesterday).run();

  await env.DB.prepare("DELETE FROM history_record WHERE date < date('now', '-30 days', '+9 hours')").run();
}

async function getAuthUserId(request: Request, env: Env): Promise<string | null> {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionId) return null;
  const res = await env.DB.prepare("SELECT user_id FROM sessions WHERE session_id = ?").bind(sessionId).first() as any;
  return res?.user_id || null;
}

async function getUserCurrentNickname(userId: string, env: Env): Promise<string> {
  const user = await env.DB.prepare("SELECT nickname, name FROM users WHERE id = ?").bind(userId).first() as any;
  return user?.nickname || user?.name || "익명";
}

function jsonResponse(data: any, corsHeaders: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}