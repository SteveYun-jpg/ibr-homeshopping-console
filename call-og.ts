import type { Context, Config } from "@netlify/edge-functions";

// 콜현황 카톡 미리보기 — 방송별 OG 카드(홈사·제품·시간) 후 콘솔 콜현황으로 이동
const SB = "https://keexrgngcpisrfgiqaeq.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlZXhyZ25nY3Bpc3JmZ2lxYWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDgwMDUsImV4cCI6MjA5ODcyNDAwNX0.q81FNk0-3Ffc4bTfYtAZyDsZbU0QPIYmvBKpJ6JheiA";
const APP = "https://ibr-homeshopping-console.netlify.app";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const esc = (s: string) =>
  String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const id = url.pathname.split("/").filter(Boolean).pop() || "";
  let title = "실시간 콜모니터 · IBR 홈쇼핑팀";
  let desc = "홈쇼핑 방송 실시간 누적 콜·매출 모니터링";
  const target = id ? `${APP}/#calllive/${id}` : APP;
  if (id) {
    try {
      const r = await fetch(
        `${SB}/rest/v1/hs_v_call_meta?id=eq.${id}&select=channel_name,product_name,air_at`,
        { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
      );
      const rows = await r.json();
      const b = rows && rows[0];
      if (b) {
        const d = new Date(b.air_at);
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const hh = String(d.getUTCHours()).padStart(2, "0");
        const mi = String(d.getUTCMinutes()).padStart(2, "0");
        const dow = DOW[d.getUTCDay()];
        const nm = [b.channel_name, b.product_name].filter(Boolean).join(" · ");
        title = `[실시간 콜모니터] ${nm}`;
        desc = `${mm}/${dd}(${dow}) ${hh}:${mi} · 실시간 누적 콜·매출`;
      }
    } catch (_) { /* fall back to defaults */ }
  }
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="IBR 홈쇼핑팀">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(target)}">
<meta name="description" content="${esc(desc)}">
</head><body style="font-family:sans-serif;padding:48px 20px;text-align:center;color:#0f2a3f">
<div style="font-size:17px;font-weight:800;margin-bottom:6px">${esc(title)}</div>
<div style="color:#667;font-size:13px;margin-bottom:22px">${esc(desc)}</div>
<a href="${esc(target)}" style="display:inline-block;background:#0D9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">실시간 콜현황 보기 →</a>
<script>setTimeout(function(){location.replace(${JSON.stringify(target)});},250);</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
};

export const config: Config = { path: "/c/:id" };
