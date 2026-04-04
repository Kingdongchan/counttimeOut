// =============================================
// backend/src/index.ts
// 역할:
// 1. 인증 / 닉네임 / 타이머 / 리더보드 / 채팅 API 제공
// 2. 서버 기준 자정 이관(daily_record -> history_record) 보장
// 3. 채팅 300개 유지 / history_record 30일 보관 / IP 밴 처리
// =============================================

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ADMIN_EMAIL: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

interface BadgeSnapshot {
  dailyTopMap: Map<string, string>;
  allTimeKingUserId: string | null;
}

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload?.error || "HTTP Error"));
    this.status = status;
    this.payload = payload;
  }
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_MS = DAY_MS - 1;
const CHAT_LIMIT = 300;
const CHAT_HISTORY_PAGE_SIZE = 30;
const FIRE_BADGE_THRESHOLD_MS = 10 * 60 * 60 * 1000;

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

      if (path === "/api/admin/ip-ban" && method === "POST") return await handleAdminIpBan(request, env, corsHeaders);
      if (path === "/api/admin/ip-unban" && method === "POST") return await handleAdminIpUnban(request, env, corsHeaders);
      if (path === "/api/admin/ip-bans" && method === "GET") return await handleAdminIpBans(request, env, corsHeaders);

      return jsonResponse({ error: "존재하지 않는 경로입니다" }, corsHeaders, 404);
    } catch (err: any) {
      if (err instanceof HttpError) {
        return jsonResponse(err.payload, corsHeaders, err.status);
      }
      console.error("서버 오류:", err);
      return jsonResponse({ error: "서버 내부 오류", message: err?.message || "알 수 없는 오류" }, corsHeaders, 500);
    }
  },

  // ⚠️ 중요:
  // wrangler.toml 의 cron trigger 와 함께 사용되어야 자동 자정 리셋이 실제 배포 환경에서 동작합니다.
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await midnightReset(env);
  },
};

// =============================================
// 인증 / 유저 관련 API
// =============================================

async function handleGoogleAuth(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const { idToken } = await request.json() as { idToken: string };
  const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!googleResponse.ok) return jsonResponse({ error: "유효하지 않은 토큰" }, corsHeaders, 401);

  const googleUser = await googleResponse.json() as any;
  const role = googleUser.email === env.ADMIN_EMAIL ? "admin" : "user";
  const today = getKstDateKey();
  const ipAddress = getClientIp(request);

  await env.DB.prepare(`
    INSERT INTO users (id, email, name, picture, role, last_known_ip)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      picture = excluded.picture,
      role = excluded.role,
      last_known_ip = excluded.last_known_ip
  `).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, role, ipAddress).run();

  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (session_id, user_id) VALUES (?, ?)").bind(sessionId, googleUser.sub).run();

  await ensureUserDailyRecord(env, googleUser.sub, googleUser.name, today);

  const freshUser = await env.DB.prepare(`
    SELECT id, name, nickname, picture, email, role, last_known_ip
    FROM users
    WHERE id = ?
  `).bind(googleUser.sub).first();

  return jsonResponse({ sessionId, user: freshUser }, corsHeaders);
}

async function handleAuthCheck(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ valid: false }, corsHeaders, 401);

  await touchUserIp(userId, request, env);
  await normalizeDailyStateForUser(userId, env);

  const isBanned = await isRequestIpBanned(request, env);
  if (isBanned) {
    await resetUserTimerForBan(userId, env);
  }

  const user = await env.DB.prepare(`
    SELECT u.id, u.name, u.nickname, u.picture, u.email, u.role, u.last_known_ip
    FROM users u
    WHERE u.id = ?
  `).bind(userId).first() as any;

  return jsonResponse({ valid: true, user: { ...user, isBanned } }, corsHeaders);
}

async function handleLogout(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  }
  return jsonResponse({ success: true }, corsHeaders);
}

async function handleNicknameSet(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { nickname } = await request.json() as { nickname: string };
  const trimmedNickname = nickname.trim();
  const today = getKstDateKey();

  try {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(trimmedNickname).first() as any;
    if (existing && existing.id !== userId) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }

    await env.DB.prepare(`
      UPDATE users
      SET nickname = ?, nickname_changed_at = ?, last_known_ip = ?
      WHERE id = ?
    `).bind(trimmedNickname, Date.now(), getClientIp(request), userId).run();

    await env.DB.prepare(`
      UPDATE daily_record
      SET nickname = ?
      WHERE user_id = ? AND date = ?
    `).bind(trimmedNickname, userId, today).run();

    return jsonResponse({ success: true, nickname: trimmedNickname }, corsHeaders);
  } catch (err: any) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }
    throw err;
  }
}

async function handleNicknameChange(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  const { nickname } = await request.json() as { nickname: string };
  const trimmedNickname = nickname.trim();

  try {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(trimmedNickname).first() as any;
    if (existing && existing.id !== userId) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }

    await env.DB.prepare(`
      UPDATE users
      SET nickname = ?, nickname_changed_at = ?, last_known_ip = ?
      WHERE id = ?
    `).bind(trimmedNickname, Date.now(), getClientIp(request), userId).run();

    await env.DB.prepare(`
      UPDATE daily_record
      SET nickname = ?
      WHERE user_id = ? AND date = ?
    `).bind(trimmedNickname, userId, getKstDateKey()).run();

    return jsonResponse({ success: true, nickname: trimmedNickname }, corsHeaders);
  } catch (err: any) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return jsonResponse({ error: "duplicate", message: "이미 사용 중인 닉네임입니다." }, corsHeaders, 400);
    }
    throw err;
  }
}

async function handleNicknameCheck(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const url = new URL(request.url);
  const nickname = (url.searchParams.get("nickname") || "").trim();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(nickname).first();
  return jsonResponse({ available: !existing }, corsHeaders);
}

// =============================================
// 타이머 / 리더보드 API
// =============================================

async function handleGetTimer(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  await touchUserIp(userId, request, env);
  await normalizeDailyStateForUser(userId, env);

  const isBanned = await isRequestIpBanned(request, env);
  if (isBanned) {
    await resetUserTimerForBan(userId, env);
    return jsonResponse({
      today_accumulated_ms: 0,
      blocked: true,
      banned: true,
      message: "IP 밴 상태입니다. 타이머가 고정되었습니다.",
      date: getKstDateKey(),
    }, corsHeaders);
  }

  const today = getKstDateKey();
  const record = await env.DB.prepare(`
    SELECT today_accumulated_ms
    FROM daily_record
    WHERE user_id = ? AND date = ?
  `).bind(userId, today).first() as any;

  return jsonResponse({
    today_accumulated_ms: Number(record?.today_accumulated_ms || 0),
    blocked: false,
    banned: false,
    date: today,
  }, corsHeaders);
}

async function handleUpdateTimer(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  await touchUserIp(userId, request, env);

  const isBanned = await isRequestIpBanned(request, env);
  if (isBanned) {
    await resetUserTimerForBan(userId, env);
    return jsonResponse({ success: false, blocked: true, banned: true, serverAccumulatedMs: 0 }, corsHeaders, 403);
  }

  const { accumulatedMs, tabId } = await request.json() as { accumulatedMs?: number; tabId?: string };
  const today = getKstDateKey();
  const nickname = await getUserCurrentNickname(userId, env);
  const correctedMs = await prepareDailyRecordForIncomingTimer(userId, today, Number(accumulatedMs || 0), env);

  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, current_tab_id, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (date, user_id) DO UPDATE SET
      nickname = excluded.nickname,
      today_accumulated_ms = excluded.today_accumulated_ms,
      current_tab_id = excluded.current_tab_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, nickname, today, correctedMs, tabId || null).run();

  return jsonResponse({
    success: true,
    blocked: false,
    banned: false,
    serverAccumulatedMs: correctedMs,
    date: today,
  }, corsHeaders);
}

async function handleLeaderboard(request: Request, env: Env, corsHeaders: Record<string, string>) {
  await cleanupHistoryRecords(env);

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");
  const today = getKstDateKey();

  if (mode === "alltime") {
    const { results } = await env.DB.prepare(`
      SELECT
        u.nickname,
        u.picture,
        MAX(h.count) AS ms
      FROM history_record h
      JOIN users u ON h.user_id = u.id
      GROUP BY u.id
      ORDER BY ms DESC, u.nickname ASC
      LIMIT 100
    `).all();

    return jsonResponse({ leaderboard: results || [] }, corsHeaders);
  }

  const { results } = await env.DB.prepare(`
    SELECT
      u.nickname,
      u.picture,
      d.today_accumulated_ms AS ms,
      CASE
        WHEN (strftime('%s', 'now') - strftime('%s', d.updated_at)) < 90 THEN 1
        ELSE 0
      END AS is_online
    FROM daily_record d
    JOIN users u ON d.user_id = u.id
    WHERE d.date = ? AND d.today_accumulated_ms > 0
    ORDER BY d.today_accumulated_ms DESC, d.updated_at ASC
    LIMIT 100
  `).bind(today).all();

  return jsonResponse({ leaderboard: results || [] }, corsHeaders);
}

async function handlePostLeaderboard(request: Request, env: Env, corsHeaders: Record<string, string>) {
  // ⚠️ 참고:
  // 기존 프론트가 /api/leaderboard POST 를 계속 호출하고 있으므로,
  // 운영 중 호환성을 위해 /api/timer/update 와 동일한 서버 기준 보정 로직을 사용합니다.
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  await touchUserIp(userId, request, env);

  const isBanned = await isRequestIpBanned(request, env);
  if (isBanned) {
    await resetUserTimerForBan(userId, env);
    return jsonResponse({ success: false, blocked: true, banned: true }, corsHeaders, 403);
  }

  const body = await request.json() as any;
  const today = getKstDateKey();
  const nickname = await getUserCurrentNickname(userId, env);
  const correctedMs = await prepareDailyRecordForIncomingTimer(userId, today, Number(body?.score || body?.time || 0), env);

  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (date, user_id) DO UPDATE SET
      nickname = excluded.nickname,
      today_accumulated_ms = excluded.today_accumulated_ms,
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, nickname, today, correctedMs).run();

  return jsonResponse({ success: true, banned: false, serverAccumulatedMs: correctedMs }, corsHeaders);
}

// =============================================
// 채팅 API
// =============================================

async function handleSendChat(request: Request, env: Env, corsHeaders: Record<string, string>) {
  const userId = await getAuthUserId(request, env);
  if (!userId) return jsonResponse({ error: "인증 필요" }, corsHeaders, 401);

  await touchUserIp(userId, request, env);
  await normalizeDailyStateForUser(userId, env);

  const isBanned = await isRequestIpBanned(request, env);
  if (isBanned) {
    await resetUserTimerForBan(userId, env);
    return jsonResponse({ error: "차단된 IP 입니다." }, corsHeaders, 403);
  }

  const { message, liveTime } = await request.json() as { message?: string; liveTime?: string };
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) return jsonResponse({ error: "메시지가 비어 있습니다." }, corsHeaders, 400);
  if (trimmedMessage.length > 150) return jsonResponse({ error: "메시지는 150자를 초과할 수 없습니다." }, corsHeaders, 400);

  const nickname = await getUserCurrentNickname(userId, env);

  await env.DB.prepare(`
    INSERT INTO chat_logs (user_id, nickname, message, live_time)
    VALUES (?, ?, ?, ?)
  `).bind(userId, nickname, trimmedMessage, String(liveTime || "")).run();

  await trimChatLogs(env);

  return jsonResponse({ success: true }, corsHeaders);
}

async function handleChatHistory(request: Request, env: Env, corsHeaders: Record<string, string>) {
  try {
    const url = new URL(request.url);
    const sinceId = Number(url.searchParams.get("since") || 0);
    const safeSinceId = Number.isFinite(sinceId) && sinceId > 0 ? Math.floor(sinceId) : 0;
    const badgeSnapshot = await buildBadgeSnapshot(env);
    const today = getKstDateKey();

    const statement = safeSinceId > 0
      ? env.DB.prepare(`
        SELECT
          c.id,
          c.user_id,
          c.nickname,
          c.message,
          c.live_time,
          COALESCE(c.created_at, c.timestamp, CURRENT_TIMESTAMP) AS created_at,
          u.picture,
          u.role,
          d.today_accumulated_ms
        FROM chat_logs c
        LEFT JOIN users u ON c.user_id = u.id
        LEFT JOIN daily_record d ON c.user_id = d.user_id AND d.date = ?
        WHERE c.id > ?
        ORDER BY c.id ASC
        LIMIT ?
      `).bind(today, safeSinceId, CHAT_LIMIT)
      : env.DB.prepare(`
        SELECT
          c.id,
          c.user_id,
          c.nickname,
          c.message,
          c.live_time,
          COALESCE(c.created_at, c.timestamp, CURRENT_TIMESTAMP) AS created_at,
          u.picture,
          u.role,
          d.today_accumulated_ms
        FROM (
          SELECT id, user_id, nickname, message, live_time, created_at, timestamp
          FROM chat_logs
          ORDER BY id DESC
          LIMIT ?
        ) c
        LEFT JOIN users u ON c.user_id = u.id
        LEFT JOIN daily_record d ON c.user_id = d.user_id AND d.date = ?
        ORDER BY c.id ASC
      `).bind(CHAT_HISTORY_PAGE_SIZE, today);

    const { results } = await statement.all();

    const messages = (results || []).map((row: any) => {
      const liveTime = String(row.live_time || "");
      const liveMs = Number(row.today_accumulated_ms || 0);
      const badges = buildBadgesForUser(row.user_id, liveMs, badgeSnapshot, row.role);

      return {
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname,
        picture: row.picture,
        message: row.message,
        liveTime,
        created_at: row.created_at,
        date: today,
        badges,
      };
    });

    return jsonResponse({ messages }, corsHeaders);
  } catch (err) {
    console.error("[채팅] history 조회 실패:", err);
    return jsonResponse({ messages: [] }, corsHeaders);
  }
}

// =============================================
// 관리자 API
// =============================================

async function handleAdminIpBan(request: Request, env: Env, corsHeaders: Record<string, string>) {
  await requireAdmin(request, env);

  const { ip, reason } = await request.json() as { ip?: string; reason?: string };
  const trimmedIp = String(ip || "").trim();
  if (!trimmedIp) return jsonResponse({ error: "IP가 필요합니다." }, corsHeaders, 400);

  const adminUserId = await getAuthUserId(request, env);

  await env.DB.prepare(`
    INSERT INTO banned_ips (ip_address, reason, banned_by_user_id)
    VALUES (?, ?, ?)
    ON CONFLICT(ip_address) DO UPDATE SET
      reason = excluded.reason,
      banned_by_user_id = excluded.banned_by_user_id,
      created_at = CURRENT_TIMESTAMP
  `).bind(trimmedIp, String(reason || "관리자 차단"), adminUserId).run();

  // ⚠️ 중요:
  // 같은 IP 로 마지막 접속이 기록된 유저는 즉시 시간을 0 으로 말소합니다.
  await env.DB.prepare(`
    UPDATE daily_record
    SET today_accumulated_ms = 0,
        current_tab_id = 'BANNED',
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id IN (
      SELECT id
      FROM users
      WHERE last_known_ip = ?
    )
  `).bind(trimmedIp).run();

  return jsonResponse({ success: true, ip: trimmedIp }, corsHeaders);
}

async function handleAdminIpUnban(request: Request, env: Env, corsHeaders: Record<string, string>) {
  await requireAdmin(request, env);

  const { ip } = await request.json() as { ip?: string };
  const trimmedIp = String(ip || "").trim();
  if (!trimmedIp) return jsonResponse({ error: "IP가 필요합니다." }, corsHeaders, 400);

  await env.DB.prepare("DELETE FROM banned_ips WHERE ip_address = ?").bind(trimmedIp).run();

  return jsonResponse({ success: true, ip: trimmedIp }, corsHeaders);
}

async function handleAdminIpBans(request: Request, env: Env, corsHeaders: Record<string, string>) {
  await requireAdmin(request, env);

  const { results } = await env.DB.prepare(`
    SELECT ip_address, reason, created_at
    FROM banned_ips
    ORDER BY created_at DESC, ip_address ASC
    LIMIT 100
  `).all();

  return jsonResponse({ bans: results || [] }, corsHeaders);
}

// =============================================
// 자정 리셋 / 정리 로직
// =============================================

async function midnightReset(env: Env) {
  const today = getKstDateKey();

  // 1. 어제 및 그 이전 daily_record 를 history_record 로 옮깁니다.
  // today_accumulated_ms 가 0 인 데이터는 제외하여 빈 기록이 history 에 남지 않도록 합니다.
  await env.DB.prepare(`
    INSERT INTO history_record (user_id, date, count)
    SELECT user_id, date, today_accumulated_ms
    FROM daily_record
    WHERE date < ? AND today_accumulated_ms > 0
    ON CONFLICT(user_id, date) DO UPDATE SET
      count = MAX(history_record.count, excluded.count)
  `).bind(today).run();

  // 2. 이관이 끝난 이전 날짜 daily_record 는 제거합니다.
  await env.DB.prepare(`
    DELETE FROM daily_record
    WHERE date < ?
  `).bind(today).run();

  // 3. history_record 는 30일까지만 보관합니다.
  await cleanupHistoryRecords(env);

  // 4. 운영 중 혹시 남아 있을 수 있는 오래된 채팅도 다시 한 번 정리합니다.
  await trimChatLogs(env);

  console.log(`[${today}] 자정 리셋 완료`);
}

async function cleanupHistoryRecords(env: Env) {
  const thresholdDate = getKstDateKey(Date.now() - (30 * DAY_MS));
  await env.DB.prepare(`
    DELETE FROM history_record
    WHERE date < ?
  `).bind(thresholdDate).run();
}

async function trimChatLogs(env: Env) {
  // 최신 300개를 남기고 그보다 오래된 id 를 제거합니다.
  await env.DB.prepare(`
    DELETE FROM chat_logs
    WHERE id IN (
      SELECT id
      FROM chat_logs
      ORDER BY id DESC
      LIMIT -1 OFFSET ?
    )
  `).bind(CHAT_LIMIT).run();
}

// =============================================
// 배지 계산
// =============================================

async function buildBadgeSnapshot(env: Env): Promise<BadgeSnapshot> {
  const today = getKstDateKey();
  const dailyTopMap = new Map<string, string>();

  const { results: dailyResults } = await env.DB.prepare(`
    SELECT user_id
    FROM daily_record
    WHERE date = ? AND today_accumulated_ms > 0
    ORDER BY today_accumulated_ms DESC, updated_at ASC
    LIMIT 3
  `).bind(today).all();

  const dailyBadges = ["🥇", "🥈", "🥉"];
  (dailyResults || []).forEach((row: any, index: number) => {
    if (dailyBadges[index]) {
      dailyTopMap.set(String(row.user_id), dailyBadges[index]);
    }
  });

  const allTimeKing = await env.DB.prepare(`
    SELECT user_id
    FROM history_record
    ORDER BY count DESC, date ASC
    LIMIT 1
  `).first() as any;

  return {
    dailyTopMap,
    allTimeKingUserId: allTimeKing?.user_id || null,
  };
}

function buildBadgesForUser(userId: string, liveMs: number, badgeSnapshot: BadgeSnapshot, role?: string): string[] {
  // ⚠️ 중요:
  // 닉네임 오른쪽에 표시되는 이모지 순서는 아래 순서로 고정합니다.
  // 1) 관리자 아이콘 -> 2) 금일 순위 메달 -> 3) 10시간 배지 -> 4) 역대 1위 왕관
  const badges: string[] = [];
  if (role === "admin") badges.push("🛠️");
  const dailyBadge = badgeSnapshot.dailyTopMap.get(String(userId));
  if (dailyBadge) badges.push(dailyBadge);
  if (liveMs >= FIRE_BADGE_THRESHOLD_MS) badges.push("🔥");
  if (badgeSnapshot.allTimeKingUserId && badgeSnapshot.allTimeKingUserId === String(userId)) badges.push("👑");
  return badges;
}

// =============================================
// 유틸리티 / 공통 보정 함수
// =============================================

async function normalizeDailyStateForUser(userId: string, env: Env) {
  const today = getKstDateKey();

  // ⚠️ 중요:
  // 자정 리셋 cron 이 일시적으로 누락되어도,
  // 인증/타이머 요청 시 사용자 단위로 이전 날짜 데이터를 보정합니다.
  await env.DB.prepare(`
    INSERT INTO history_record (user_id, date, count)
    SELECT user_id, date, today_accumulated_ms
    FROM daily_record
    WHERE user_id = ? AND date < ? AND today_accumulated_ms > 0
    ON CONFLICT(user_id, date) DO UPDATE SET
      count = MAX(history_record.count, excluded.count)
  `).bind(userId, today).run();

  await env.DB.prepare(`
    DELETE FROM daily_record
    WHERE user_id = ? AND date < ?
  `).bind(userId, today).run();

  const nickname = await getUserCurrentNickname(userId, env);
  await ensureUserDailyRecord(env, userId, nickname, today);
}

async function ensureUserDailyRecord(env: Env, userId: string, nickname: string, date: string) {
  await env.DB.prepare(`
    INSERT INTO daily_record (user_id, nickname, date, today_accumulated_ms, updated_at)
    VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(date, user_id) DO UPDATE SET
      nickname = excluded.nickname
  `).bind(userId, nickname, date).run();
}

// =============================================
// [핵심 수정] 타이머 보정 함수
//
// 변경 이유:
//   1. 기존 코드는 latestRecord.date === today 인 경우 safeIncomingMs 를 그대로 반환했습니다.
//      이 경우 프론트가 자정을 가로질러 이전 날의 누적값을 포함한 큰 수를 보내도
//      서버가 그대로 저장하는 버그가 있었습니다.
//
//   2. 수정된 로직은 today 레코드가 있더라도 서버에 저장된 현재값보다
//      급격하게 큰 값이 들어오면 이전 날의 마지막 저장값을 차감하여 보정합니다.
//
// 허용 오차(JUMP_TOLERANCE_MS):
//   네트워크 지연, 탭 비활성 등으로 단기간에 누적값이 튀는 것을 허용하는 범위입니다.
//   5분(300,000ms) 이상 급증하면 어제 값을 차감하는 보정을 적용합니다.
// =============================================

const JUMP_TOLERANCE_MS = 5 * 60 * 1000; // 5분

async function prepareDailyRecordForIncomingTimer(userId: string, today: string, incomingMs: number, env: Env): Promise<number> {
  const safeIncomingMs = clampMs(incomingMs);

  // 가장 최근 daily_record 를 날짜 무관하게 가져옵니다.
  const latestRecord = await env.DB.prepare(`
    SELECT date, today_accumulated_ms
    FROM daily_record
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1
  `).bind(userId).first() as any;

  // 레코드가 없으면 첫 접속이므로 incoming 값을 그대로 사용합니다.
  if (!latestRecord) {
    return safeIncomingMs;
  }

  // ─────────────────────────────────────────────────────────────
  // [Case 1] 최근 레코드가 오늘 날짜인 경우
  // ─────────────────────────────────────────────────────────────
  if (latestRecord.date === today) {
    const currentServerMs = Number(latestRecord.today_accumulated_ms || 0);

    // 정상적인 증가: 서버 저장값 이상이고, 급격한 점프가 없으면 그대로 수락합니다.
    if (safeIncomingMs >= currentServerMs && safeIncomingMs - currentServerMs <= JUMP_TOLERANCE_MS) {
      return safeIncomingMs;
    }

    // ⚠️ 급격한 점프 감지:
    // 프론트가 자정을 인식하지 못하고 어제 누적값을 포함한 큰 수를 보낸 경우입니다.
    // 예) 어제 22시간 공부 후 자정을 넘겨 22시간 + 새벽 5분을 통째로 전송한 경우.
    // 이 경우 history_record 에서 어제 마지막 저장값을 찾아 차감합니다.
    if (safeIncomingMs - currentServerMs > JUMP_TOLERANCE_MS) {
      const yesterdayMs = await getYesterdayHistoryMs(userId, today, env);
      if (yesterdayMs > 0) {
        // 어제 기록이 history 에 이미 이관된 경우: 어제 값을 차감합니다.
        const corrected = clampMs(safeIncomingMs - yesterdayMs);
        console.log(`[timer-jump] userId=${userId} incoming=${safeIncomingMs} server=${currentServerMs} yesterday=${yesterdayMs} corrected=${corrected}`);
        return corrected;
      }
      // 어제 기록이 없으면 점프가 아닌 정상 증가로 간주합니다.
      return safeIncomingMs;
    }

    // incoming 이 서버 저장값보다 작으면 (탭 교체, 페이지 리로드 등) 서버 값을 유지합니다.
    // ⚠️ 중요: 절대로 서버 저장값을 줄이지 않습니다.
    return currentServerMs;
  }

  // ─────────────────────────────────────────────────────────────
  // [Case 2] 최근 레코드가 이전 날짜인 경우
  // 자정이 지났는데도 프론트가 이전 날짜 누적값을 그대로 들고 온 상황입니다.
  // ─────────────────────────────────────────────────────────────

  // 먼저 이전 날짜 데이터를 history 로 이관합니다.
  await normalizeDailyStateForUser(userId, env);

  const previousDayMs = Number(latestRecord.today_accumulated_ms || 0);

  // 들어온 값이 이전 날의 마지막 저장값과 같거나 작으면 자정을 막 넘긴 것이므로 0 으로 시작합니다.
  if (safeIncomingMs <= previousDayMs) {
    return 0;
  }

  // 이전 날의 누적분을 차감하여 오늘 분량만 추출합니다.
  const todayMs = clampMs(safeIncomingMs - previousDayMs);
  console.log(`[timer-crossday] userId=${userId} incoming=${safeIncomingMs} prevDay=${previousDayMs} todayMs=${todayMs}`);
  return todayMs;
}

// ─────────────────────────────────────────────────────────────
// 어제 날짜의 history_record count 를 가져옵니다.
// 자정을 넘긴 후 프론트에서 급격한 점프가 감지되었을 때 차감 기준으로 사용합니다.
// ─────────────────────────────────────────────────────────────
async function getYesterdayHistoryMs(userId: string, today: string, env: Env): Promise<number> {
  // today 에서 하루 전 날짜를 계산합니다.
  const todayMs = new Date(today).getTime();
  const yesterdayKey = getKstDateKey(todayMs - DAY_MS + KST_OFFSET_MS);

  const record = await env.DB.prepare(`
    SELECT count
    FROM history_record
    WHERE user_id = ? AND date = ?
  `).bind(userId, yesterdayKey).first() as any;

  return Number(record?.count || 0);
}

async function resetUserTimerForBan(userId: string, env: Env) {
  await normalizeDailyStateForUser(userId, env);

  await env.DB.prepare(`
    UPDATE daily_record
    SET today_accumulated_ms = 0,
        current_tab_id = 'BANNED',
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND date = ?
  `).bind(userId, getKstDateKey()).run();
}

async function requireAdmin(request: Request, env: Env) {
  const userId = await getAuthUserId(request, env);
  if (!userId) {
    throw new HttpError(401, { error: "인증 필요" });
  }

  const user = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first() as any;
  if (!user || user.role !== "admin") {
    throw new HttpError(403, { error: "관리자 권한이 없습니다." });
  }
}

async function getAuthUserId(request: Request, env: Env): Promise<string | null> {
  const sessionId = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionId) return null;

  const session = await env.DB.prepare(`
    SELECT user_id
    FROM sessions
    WHERE session_id = ?
  `).bind(sessionId).first() as any;

  return session?.user_id || null;
}

async function getUserCurrentNickname(userId: string, env: Env): Promise<string> {
  const user = await env.DB.prepare(`
    SELECT nickname, name
    FROM users
    WHERE id = ?
  `).bind(userId).first() as any;

  return String(user?.nickname || user?.name || "익명");
}

async function touchUserIp(userId: string, request: Request, env: Env) {
  const ipAddress = getClientIp(request);
  if (!ipAddress) return;

  await env.DB.prepare(`
    UPDATE users
    SET last_known_ip = ?
    WHERE id = ?
  `).bind(ipAddress, userId).run();
}

async function isRequestIpBanned(request: Request, env: Env) {
  const ipAddress = getClientIp(request);
  if (!ipAddress) return false;

  const banned = await env.DB.prepare(`
    SELECT ip_address
    FROM banned_ips
    WHERE ip_address = ?
  `).bind(ipAddress).first();

  return Boolean(banned);
}

function getClientIp(request: Request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();

  const forwarded = request.headers.get("X-Forwarded-For");
  if (!forwarded) return "";

  return forwarded.split(",")[0].trim();
}

function getKstDateKey(baseMs = Date.now()) {
  return new Date(baseMs + KST_OFFSET_MS).toISOString().split("T")[0];
}

function clampMs(value: number) {
  const numeric = Number.isFinite(value) ? Math.floor(value) : 0;
  if (numeric <= 0) return 0;
  return Math.min(numeric, MAX_DAILY_MS);
}

function parseLiveTimeToMs(liveTime: string) {
  const parts = String(liveTime || "").split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
}

function jsonResponse(data: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
