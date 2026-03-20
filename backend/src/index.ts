// =============================================
// backend/src/index.ts
// 닉네임 중복 방지 및 리더보드 최적화 버전
// =============================================

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

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/api/time" && method === "GET") return jsonResponse({ serverTime: Date.now() }, corsHeaders);
      if (path === "/api/auth/google" && method === "POST") return await handleGoogleAuth(request, env, corsHeaders);
      if (path === "/api/auth/check" && method === "GET") return await handleAuthCheck(request, env, corsHeaders);
      if (path === "/api/auth/logout" && method === "POST") return await handleLogout(request, env, corsHeaders);

      // 닉네임 관련 API
      if (path === "/api/nickname/set" && method === "POST") return await handleNicknameSet(request, env, corsHeaders);
      if (path === "/api/nickname/change" && method === "POST") return await handleNicknameChange(request, env, corsHeaders);
      if (path === "/api/nickname/check" && method === "GET") return await handleNicknameCheck(request, env, corsHeaders);

      if (path === "/api/timer/get" && method === "GET") return await handleGetTimer(request, env, corsHeaders);
      if (path === "/api/timer/update" && method === "POST") return await handleUpdateTimer(request, env, corsHeaders);

      if (path === "/api/leaderboard") {
        if (method === "GET") return await handleLeaderboard(request, env, corsHeaders);
        if (method === "POST") return await handlePostLeaderboard(request, env, corsHeaders);
      }

      if (path === "/api/chat/send" && method === "POST") return await handleSendChat(request, env, corsHeaders);
      if (path === "/api/chat/history" && method === "GET") return await handleChatHistory(request, env, corsHeaders);

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
  const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];

  await env.DB.prepare(`
    INSERT INTO users (id, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture
  `).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, role).run();

  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (session_id, user_id) VALUES (?, ?)").bind(sessionId, googleUser.sub).run();
  
  await env.DB.prepare("INSERT OR IGNORE INTO daily_record (user_id, nickname, date) VALUES (?, ?, ?)").bind(googleUser.sub, googleUser.name, today).run();

  const freshUser = await env.DB.prepare("SELECT id, name, nickname, picture, email, role FROM users WHERE id = ?").bind(googleUser.sub).first();
  return jsonResponse({ sessionId, user: freshUser }, corsHeaders);
}

async function handleAuthCheck(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ valid: false }, corsHeaders, 401);
  const result = await env.DB.prepare("SELECT u.id, u.name, u.nickname, u.picture, u.email, u.role FROM users u WHERE u.id = ?").bind(userId).first() as any;
  return jsonResponse({ valid: true, user: result }, corsHeaders);
}

async function handleLogout(request: Request, env: Env, corsHeaders: any) {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (sessionId) await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

/**
 * [수정됨] 닉네임 설정 시 중복 체크 강화
 */
async function handleNicknameSet(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { nickname } = await request.json() as { nickname: string };
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const trimmedNickname = nickname.trim();
  const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];

  try {
    // 1. 중복 확인 (이미 사용 중인지)
    const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(trimmedNickname).first();
    if (existing) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }

    // 2. 업데이트
    await env.DB.prepare("UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?").bind(trimmedNickname, Date.now(), userId).run();
    await env.DB.prepare("UPDATE daily_record SET nickname = ? WHERE user_id = ? AND date = ?").bind(trimmedNickname, userId, today).run();
    
    return jsonResponse({ success: true }, corsHeaders);
  } catch (err: any) {
    if (err.message.includes("UNIQUE")) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }
    throw err;
  }
}

/**
 * [수정됨] 닉네임 변경 시 중복 체크 강화
 */
async function handleNicknameChange(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { nickname } = await request.json() as { nickname: string };
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const trimmedNickname = nickname.trim();

  try {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(trimmedNickname).first();
    if (existing) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }

    await env.DB.prepare("UPDATE users SET nickname = ?, nickname_changed_at = ? WHERE id = ?").bind(trimmedNickname, Date.now(), userId).run();
    return jsonResponse({ success: true }, corsHeaders);
  } catch (err: any) {
    if (err.message.includes("UNIQUE")) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }
    throw err;
  }
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
  const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
  let record = await env.DB.prepare("SELECT today_accumulated_ms FROM daily_record WHERE user_id = ? AND date = ?").bind(userId, today).first() as any;
  return jsonResponse({ today_accumulated_ms: record?.today_accumulated_ms || 0 }, corsHeaders);
}

async function handleUpdateTimer(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  const { accumulatedMs, tabId } = await request.json() as any;
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);
  const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
  const nickname = await getUserCurrentNickname(userId, env);
  
  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, current_tab_id, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, date) DO UPDATE SET today_accumulated_ms = excluded.today_accumulated_ms, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, nickname, today, accumulatedMs, tabId).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleLeaderboard(request: Request, env: Env, corsHeaders: any) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode"); 
  const kstNow = new Date(Date.now() + (9 * 60 * 60 * 1000));
  const today = kstNow.toISOString().split('T')[0];

  if (mode === "alltime") {
    const { results } = await env.DB.prepare(`
      SELECT u.nickname, u.picture, MAX(h.count) as ms 
      FROM history_record h
      JOIN users u ON h.user_id = u.id
      GROUP BY u.id
      ORDER BY ms DESC 
      LIMIT 100
    `).all();
    return jsonResponse({ leaderboard: results }, corsHeaders);
  } else {
    const { results } = await env.DB.prepare(`
      SELECT u.nickname, u.picture, d.today_accumulated_ms as ms FROM daily_record d
      JOIN users u ON d.user_id = u.id
      WHERE d.date = ? AND d.today_accumulated_ms > 0
      ORDER BY d.today_accumulated_ms DESC LIMIT 100
    `).bind(today).all();
    return jsonResponse({ leaderboard: results }, corsHeaders);
  }
}

async function handlePostLeaderboard(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  try {
    const body = await request.json() as any;
    const nickname = await getUserCurrentNickname(userId, env);
    const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split("T")[0];
    const ms = parseFloat(body.score || body.time || "0");

    await env.DB.prepare(`
      INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, date) DO UPDATE SET today_accumulated_ms = excluded.today_accumulated_ms, updated_at = CURRENT_TIMESTAMP
    `).bind(userId, nickname, today, ms).run();

    return jsonResponse({ success: true }, corsHeaders);
  } catch (e: any) {
    return jsonResponse({ error: "저장 실패", message: e.message }, corsHeaders, 500);
  }
}

async function handleSendChat(request: Request, env: Env, corsHeaders: any) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);
  const { message, liveTime } = await request.json() as any;
  const nickname = await getUserCurrentNickname(userId, env);
  await env.DB.prepare("INSERT INTO chat_logs (user_id, nickname, message, live_time) VALUES (?, ?, ?, ?)").bind(userId, nickname, message, liveTime).run();
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleChatHistory(request: Request, env: Env, corsHeaders: any) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT nickname, message, live_time, IFNULL(timestamp, CURRENT_TIMESTAMP) as created_at 
      FROM chat_logs 
      ORDER BY id DESC LIMIT 30
    `).all();
    return jsonResponse({ messages: (results || []).reverse() }, corsHeaders);
  } catch (e) {
    return jsonResponse({ messages: [] }, corsHeaders);
  }
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

async function midnightReset(env: Env) {
  const now = new Date(Date.now() + (9 * 60 * 60 * 1000));
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString().split("T")[0];

  await env.DB.prepare(`
    INSERT INTO history_record (user_id, date, count) 
    SELECT user_id, date, today_accumulated_ms 
    FROM daily_record 
    WHERE date < ? AND today_accumulated_ms > 0
  `).bind(today).run();

  await env.DB.prepare("DELETE FROM daily_record WHERE date < ?").bind(today).run();
  await env.DB.prepare("DELETE FROM history_record WHERE date < date('now', '-30 days', '+9 hours')").run();
  
  console.log(`[${today}] 자정 리셋 완료.`);
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