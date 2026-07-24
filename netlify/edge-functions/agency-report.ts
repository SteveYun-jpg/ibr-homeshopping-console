import type { Context, Config } from "@netlify/edge-functions";

// 대행사 무로그인 리포트 — 토큰 링크로 자사 정산(매출·수수료) 열람 전용
const SB = "https://keexrgngcpisrfgiqaeq.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlZXhyZ25nY3Bpc3JmZ2lxYWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDgwMDUsImV4cCI6MjA5ODcyNDAwNX0.q81FNk0-3Ffc4bTfYtAZyDsZbU0QPIYmvBKpJ6JheiA";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const won = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("ko-KR");

function page(title: string, body: string, desc = "") {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="IBR 홈쇼핑팀">
<style>body{margin:0;background:#f4f8f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Malgun Gothic',sans-serif;color:#0f2a3f;padding:20px}
.wrap{max-width:1000px;margin:0 auto}.card{background:#fff;border:1px solid #e2ece8;border-radius:12px;margin-bottom:12px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{color:#789;font-weight:600}td,th{padding:7px 14px}
.kpi{background:#fff;border:1px solid #e2ece8;border-radius:12px;padding:12px 16px;min-width:140px}
.mono{font-variant-numeric:tabular-nums}</style>
</head><body><div class="wrap">${body}
<div style="text-align:center;color:#9ab;font-size:11px;margin:16px 0 30px">본 리포트는 열람 전용입니다 · 링크를 아는 분만 볼 수 있습니다 · IBR COMMERCE 홈쇼핑팀</div>
</div></body></html>`;
}

export default async (req: Request, _ctx: Context) => {
  const token = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  let data: any = null;
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/hs_agency_report`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    data = await r.json();
  } catch (_) { /* ignore */ }

  if (!data || !data.name) {
    return new Response(page("리포트를 찾을 수 없습니다", `<div class="card" style="padding:40px;text-align:center;color:#888">유효하지 않은 링크입니다.</div>`), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const rows: any[] = data.rows || [];
  const byYm: Record<string, { gross: number; fee: number; chs: Record<string, { g: number; f: number }> }> = {};
  for (const s of rows) {
    const d = (byYm[s.ym] = byYm[s.ym] || { gross: 0, fee: 0, chs: {} });
    d.gross += Number(s.gross) || 0; d.fee += Number(s.fee) || 0;
    const c = (d.chs[s.channel] = d.chs[s.channel] || { g: 0, f: 0 });
    c.g += Number(s.gross) || 0; c.f += Number(s.fee) || 0;
  }
  const yms = Object.keys(byYm).sort().reverse();
  const tG = rows.reduce((a, s) => a + (Number(s.gross) || 0), 0);
  const tF = rows.reduce((a, s) => a + (Number(s.fee) || 0), 0);
  const title = `${data.name} 대행 정산 리포트`;

  let body = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <div style="width:40px;height:40px;border-radius:10px;background:#0f2a3f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px">IBR</div>
    <div><div style="font-size:19px;font-weight:800">${esc(title)}</div><div style="color:#789;font-size:12.5px">${esc(data.brand_label || "")} · IBR COMMERCE 홈쇼핑팀 · 금액 VAT별도</div></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
      <div class="kpi"><div style="font-size:11px;color:#789">정산 개월수</div><div style="font-size:18px;font-weight:700">${yms.length}개월</div></div>
      <div class="kpi"><div style="font-size:11px;color:#789">누적 매출총액</div><div style="font-size:18px;font-weight:700" class="mono">${won(tG)}원</div></div>
      <div class="kpi"><div style="font-size:11px;color:#789">누적 대행 수수료</div><div style="font-size:18px;font-weight:700" class="mono">${won(tF)}원</div></div>
    </div>`;
  for (const ym of yms) {
    const d = byYm[ym];
    const chs = Object.keys(d.chs).sort((x, y) => d.chs[y].g - d.chs[x].g);
    body += `<div class="card"><div style="padding:10px 14px;background:#eef4f1;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <b style="font-size:14px">${esc(ym)}</b><span style="color:#456" class="mono">매출총액 ${won(d.gross)}</span><span style="color:#456" class="mono">수수료 ${won(d.fee)}</span>
      <span style="font-weight:700" class="mono">청구 ${won(Math.round(d.fee * 1.1))} <span style="font-weight:400;color:#789">(VAT포함)</span></span></div>
      <table><thead><tr><th style="text-align:left">홈쇼핑사</th><th style="text-align:right">매출총액(VAT-)</th><th style="text-align:right">수수료율</th><th style="text-align:right">수수료(VAT-)</th></tr></thead><tbody>
      ${chs.map((c) => `<tr style="border-top:1px solid #eef1f0"><td>${esc(c)}</td><td style="text-align:right" class="mono">${won(d.chs[c].g)}</td><td style="text-align:right" class="mono">${d.chs[c].g ? (Math.round(d.chs[c].f / d.chs[c].g * 10000) / 100) + "%" : "-"}</td><td style="text-align:right" class="mono">${won(d.chs[c].f)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  if (!yms.length) body += `<div class="card" style="padding:30px;text-align:center;color:#888">정산 데이터가 없습니다.</div>`;

  return new Response(page(title, body, `누적 매출 ${won(tG)}원 · 수수료 ${won(tF)}원 · ${yms.length}개월`), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" },
  });
};

export const config: Config = { path: "/r/:token" };
