import type { Context, Config } from "@netlify/edge-functions";

// 아커 — 업무 도우미 LLM 백엔드
// 원칙 ① API 키는 서버에만 둔다 ② 데이터는 "사용자 본인 토큰"으로 조회해 DB가 등급을 강제한다
//      ③ 임의 SQL 실행 없음 — 아래 화이트리스트 도구만 호출한다
const SB = "https://keexrgngcpisrfgiqaeq.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlZXhyZ25nY3Bpc3JmZ2lxYWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDgwMDUsImV4cCI6MjA5ODcyNDAwNX0.q81FNk0-3Ffc4bTfYtAZyDsZbU0QPIYmvBKpJ6JheiA";
const MODEL_SMALL = "claude-haiku-4-5-20251001";
const MODEL_LARGE = "claude-sonnet-5";

const TOOLS = [
  {
    name: "my_tasks",
    description: "이 사용자에게 열려 있는 업무 지시 목록. '내 할 일', '뭐 해야 하지', 업무·지시·보고 관련 질문에 사용.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "data_gaps",
    description:
      "지금 비어 있는 데이터(PPL 비용 미입력, 방송 실적 미입력, 구성 판매가 미설정, 구성↔세트코드 미매칭, 소비자판매가 미입력) 건수. '뭐가 비었나', '확인할 것', '남은 일' 질문에 사용.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "broadcast",
    description: "방송 편성·실적 현황. 월을 지정하면 그 달만.",
    input_schema: {
      type: "object",
      properties: { ym: { type: "string", description: "YYYY-MM 형식. 생략하면 전체" } },
    },
  },
  {
    name: "settle",
    description:
      "자사 결산(홈사별 영업기준·회계마감기준). 원가·매출이익은 팀장 이상만 결과에 포함된다(DB가 판정). 결과의 can_see_cost가 false면 원가를 언급하지 말 것.",
    input_schema: { type: "object", properties: { ym: { type: "string", description: "YYYY-MM" } } },
  },
  {
    name: "agency",
    description: "대행 결산(대행사·홈사별 매출·수수료율·수수료). 전 직원 열람 가능.",
    input_schema: { type: "object", properties: { ym: { type: "string", description: "YYYY-MM" } } },
  },
  {
    name: "decisions",
    description:
      "회사가 확정한 업무 규칙·결정 기록 검색. '왜 이렇게 정했나', 기준·정책 질문에 사용. 검색어로 좁힐 수 있다.",
    input_schema: { type: "object", properties: { q: { type: "string" } } },
  },
];

const RPC: Record<string, { fn: string; arg?: (i: any) => any }> = {
  my_tasks: { fn: "ak_my_tasks" },
  data_gaps: { fn: "ak_data_gaps" },
  broadcast: { fn: "ak_broadcast", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  settle: { fn: "ak_settle", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  agency: { fn: "ak_agency", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  decisions: { fn: "ak_decisions", arg: (i) => ({ p_q: i?.q ?? null }) },
};

const SYSTEM = `당신은 IBR커머스 홈쇼핑팀 운영 콘솔의 업무 도우미 '아커'입니다.

[역할]
직원이 콘솔에서 막히지 않도록 돕습니다. 화면 위치, 업무 처리 방법, 지금 숫자가 어떤지, 왜 그렇게 정해졌는지를 알려줍니다.

[말투]
- 한국어 존댓말. 짧고 담백하게. 과장하거나 사과를 반복하지 않습니다.
- 결론을 먼저, 근거를 뒤에. 목록이 필요하면 짧은 줄로.
- 모르면 모른다고 하고, 어디서 확인하면 되는지 알려줍니다.
- 이모지를 쓰지 않습니다.

[콘솔 구조]
방송 스케줄(편성·실적·실시간 콜) / 자사 결산(방송결과·영업·회계마감·부가세·월별 검수·정산서 업로드) / 대행 결산(방송결과·월별 청구·현장 대조·대행사 요율·정산서 업로드) / 라인·세트 구성(라인 설정·세트 구성·품목 원가) / PPL 프로그램 / 시뮬레이션 / 업무 지시 / 홈쇼핑사 / 브랜드 관리 / 상품구성 SKU / 직원 관리

[핵심 업무 규칙]
- 영업기준 = 소비자 판매가. 회계마감기준 = 소비자 판매가 − 홈사 수수료(직매입은 공급가).
- 구성 판매가는 「라인·세트 구성 › 세트 구성」에서 정한 값이 방송 편성에 그대로 들어간다. 비우면 SKU 판매가, 그것도 없으면 0원.
- PPL 회당 비용은 방송 1건 단위. 본방+재방 패키지는 본방 80%·재방 20%로 나눈다. 회계마감은 계산서 발행월로 귀속.
- 방송일이 지나면 편성 조건이 잠긴다. 「수정 잠금 해제」로 사유를 남기면 수정 가능.
- SCM에 품목이 없는 운영대행 브랜드는 「브랜드 관리 → + 브랜드 추가」로 콘솔에서 직접 등록한다.

[데이터 조회]
숫자를 묻는 질문은 반드시 도구로 조회해서 답합니다. 추측하지 않습니다.
도구 결과에 없는 항목은 "그 값은 제가 볼 수 있는 범위에 없습니다"라고 답하고, 지어내지 않습니다.
settle 결과의 can_see_cost가 false이면 원가·매출이익을 절대 언급하지 않습니다. 권한이 없어 제외됐다고만 말합니다.

[답변 끝]
화면에서 처리해야 하는 일이면 어느 메뉴로 가면 되는지 한 줄로 덧붙입니다.`;

async function callTool(name: string, input: any, jwt: string) {
  const spec = RPC[name];
  if (!spec) return { error: "unknown tool" };
  const body = spec.arg ? JSON.stringify(spec.arg(input)) : "{}";
  const r = await fetch(`${SB}/rest/v1/rpc/${spec.fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!r.ok) return { error: `조회 실패 (${r.status})` };
  try {
    return await r.json();
  } catch {
    return { error: "파싱 실패" };
  }
}

export default async (req: Request, _ctx: Context) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return Response.json({ error: "서버에 API 키가 설정되지 않았습니다." }, { status: 500, headers: cors });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers: cors });

  // 토큰이 실제로 유효한지 확인 — 여기서부터 이 사람의 권한으로만 조회된다
  const who = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
  if (!who.ok) return Response.json({ error: "세션이 만료됐습니다. 다시 로그인해 주세요." }, { status: 401, headers: cors });

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {}
  const history = Array.isArray(payload.messages) ? payload.messages.slice(-8) : [];
  const hint = typeof payload.view === "string" ? payload.view : "";
  const deep = payload.deep === true;

  const messages: any[] = [...history];
  if (hint && messages.length) {
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && typeof last.content === "string") {
      last.content = `${last.content}\n\n(참고: 지금 보고 있는 화면은 「${hint}」입니다)`;
    }
  }

  const sys = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ];

  let model = deep ? MODEL_LARGE : MODEL_SMALL;
  let usedTools: string[] = [];
  let inTok = 0,
    outTok = 0;

  for (let round = 0; round < 4; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: sys,
        tools: TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return Response.json({ error: `모델 호출 실패 (${res.status})`, detail: t.slice(0, 300) }, { status: 502, headers: cors });
    }
    const data = await res.json();
    inTok += data?.usage?.input_tokens || 0;
    outTok += data?.usage?.output_tokens || 0;

    const toolUses = (data.content || []).filter((c: any) => c.type === "tool_use");
    if (!toolUses.length) {
      const text = (data.content || [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();
      return Response.json(
        { text: text || "답변을 만들지 못했습니다. 다시 물어봐 주세요.", tools: usedTools, model, in: inTok, out: outTok },
        { headers: cors },
      );
    }

    messages.push({ role: "assistant", content: data.content });
    const results: any[] = [];
    for (const t of toolUses) {
      usedTools.push(t.name);
      const out = await callTool(t.name, t.input, jwt);
      results.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(out).slice(0, 12000),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return Response.json({ text: "조회가 너무 길어졌습니다. 질문을 조금 좁혀서 다시 물어봐 주세요.", tools: usedTools }, { headers: cors });
};

export const config: Config = { path: "/api/acker" };
