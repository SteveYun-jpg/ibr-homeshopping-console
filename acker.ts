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
  {
    name: "meetings",
    description:
      "회의록 검색. 방송 사전·사후미팅, 업체·외부 미팅, 팀 회의, 내부 논의에서 실제로 오간 내용과 결정 사항. '지난 회의에서 뭐라고 했나', '그 브랜드 미팅 내용', '지난주 팀회의 결론', '왜 그렇게 하기로 했지' 같은 질문에 사용. brand로 브랜드를, q로 키워드를 좁힌다. 결과에는 그 사람이 볼 수 있는 회의록만 나온다.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "본문·제목 키워드" },
        brand: { type: "string", description: "브랜드명 (예: 아티키)" },
      },
    },
  },
  {
    name: "howto",
    description:
      "콘솔 사용법 안내. 「어디서 하나요」 「어떻게 써요」 「이거 어떻게 쓰는 거예요」 같은 질문에 사용. 업데이트 공지에 적어둔 메뉴 경로(menu_path)와 단계(steps)를 그대로 돌려주므로, 그 순서대로 풀어서 안내하면 된다. 기능 이름으로 좁힐 수 있다(예: 회의록, 녹음, 정산서 업로드, PPL).",
    input_schema: { type: "object", properties: { q: { type: "string", description: "기능 이름 키워드" } } },
  },
  {
    name: "whatsnew",
    description: "가장 최근 업데이트 공지 전체. 「뭐가 바뀌었어」 「새로 생긴 거 뭐야」 질문에 사용.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "settle_upload",
    description:
      "월별 정산서 업로드 현황 — 홈사별로 정산서가 다 올라왔는지, 안 올라온 곳과 마감(방송 익월 10일) 대비 지연일수. '7월 결산 다 올라왔나', '정산서 빠진 데 있어?', '뭐 안 올라왔지', '마감 지난 거 있나' 같은 질문에 사용. state가 missing이면 아예 안 올라온 것, partial이면 방송한 브랜드 중 일부만 올라온 것, no_sales는 담당이 '그 달 매출 없음'으로 닫은 것이라 재촉하면 안 된다. 홈쇼핑팀 전용.",
    input_schema: {
      type: "object",
      properties: { ym: { type: "string", description: "YYYY-MM. 생략하면 지난달" } },
    },
  },
  {
    name: "meeting_actions",
    description: "최근 90일 회의록에서 나온 아직 처리되지 않은 액션아이템 목록. '회의에서 하기로 한 것', '남은 후속 조치' 질문에 사용.",
    input_schema: { type: "object", properties: {} },
  },
];

const RPC: Record<string, { fn: string; arg?: (i: any) => any }> = {
  my_tasks: { fn: "ak_my_tasks" },
  data_gaps: { fn: "ak_data_gaps" },
  broadcast: { fn: "ak_broadcast", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  settle: { fn: "ak_settle", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  settle_upload: { fn: "ak_settle_upload", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  agency: { fn: "ak_agency", arg: (i) => ({ p_ym: i?.ym ?? null }) },
  decisions: { fn: "ak_decisions", arg: (i) => ({ p_q: i?.q ?? null }) },
  meetings: { fn: "ak_meetings", arg: (i) => ({ p_q: i?.q ?? null, p_brand: i?.brand ?? null, p_limit: 6 }) },
  meeting_actions: { fn: "ak_meeting_actions" },
  howto: { fn: "ak_howto", arg: (i) => ({ p_q: i?.q ?? null, p_limit: 4 }) },
  whatsnew: { fn: "ak_whatsnew" },
};

// 회의록 정리 전용 프롬프트 — 전사/메모를 제목·요약·액션아이템으로 만든다
const MEET_SYS = `당신은 IBR커머스 홈쇼핑팀 회의록을 정리하는 도우미입니다.
주어진 회의 메모 또는 받아쓰기 원문을 읽고 아래 JSON만 출력합니다. 다른 말은 하지 않습니다.

{"title":"회의 제목 (25자 이내, 브랜드·주제가 드러나게)",
 "summary":"3~6줄 요약. 각 줄은 '· '로 시작. 결정된 것과 남은 쟁점을 구분해서.",
 "action_items":[{"text":"할 일 (한 문장)","owner":"담당자 이름 또는 빈 문자열","due":"YYYY-MM-DD 또는 빈 문자열"}],
 "brands":["언급된 브랜드명"]}

원칙
- 원문에 없는 내용을 지어내지 않습니다. 숫자는 원문 그대로 옮깁니다.
- 액션아이템은 실제로 누가 뭘 하기로 한 것만. 없으면 빈 배열.
- 받아쓰기 오탈자는 문맥상 명백할 때만 고칩니다.
- 이모지를 쓰지 않습니다.`;

const SYSTEM = `당신은 IBR커머스 홈쇼핑팀 운영 콘솔의 업무 도우미 '아커'입니다.

[역할]
직원이 콘솔에서 막히지 않도록 돕습니다. 화면 위치, 업무 처리 방법, 지금 숫자가 어떤지, 왜 그렇게 정해졌는지를 알려줍니다.

[말투]
- 한국어 존댓말. 짧고 담백하게. 과장하거나 사과를 반복하지 않습니다.
- 결론을 먼저, 근거를 뒤에. 목록이 필요하면 짧은 줄로.
- 모르면 모른다고 하고, 어디서 확인하면 되는지 알려줍니다.
- 이모지를 쓰지 않습니다.

[콘솔 구조]
방송 스케줄(편성·실적·실시간 콜) / 자사 결산(방송결과·영업·회계마감·부가세·월별 검수·정산서 업로드) / 대행 결산(방송결과·월별 청구·현장 대조·대행사 요율·정산서 업로드) / 라인·세트 구성(라인 설정·세트 구성·품목 원가) / PPL 프로그램 / 시뮬레이션 / 업무 지시 / 회의록(사전미팅·사후미팅·업체미팅) / 홈쇼핑사 / 브랜드 관리 / 상품구성 SKU / 직원 관리

[핵심 업무 규칙]
- 영업기준 = 소비자 판매가. 회계마감기준 = 소비자 판매가 − 홈사 수수료(직매입은 공급가).
- 구성 판매가는 「라인·세트 구성 › 세트 구성」에서 정한 값이 방송 편성에 그대로 들어간다. 비우면 SKU 판매가, 그것도 없으면 0원.
- PPL 회당 비용은 방송 1건 단위. 본방+재방 패키지는 본방 80%·재방 20%로 나눈다. 회계마감은 계산서 발행월로 귀속.
- 방송일이 지나면 편성 조건이 잠긴다. 「수정 잠금 해제」로 사유를 남기면 수정 가능.
- SCM에 품목이 없는 운영대행 브랜드는 「브랜드 관리 → + 브랜드 추가」로 콘솔에서 직접 등록한다.

[데이터 조회]
숫자를 묻는 질문은 반드시 도구로 조회해서 답합니다. 추측하지 않습니다.
브랜드·업체·방송에 대해 "무슨 얘기가 오갔나", "왜 그렇게 하기로 했나"를 물으면 meetings 도구로 회의록을 먼저 찾아봅니다. 회의록을 인용할 때는 언제 어떤 회의였는지 함께 밝힙니다.

[사용법 안내]
"어디서 하나요", "어떻게 써요" 류의 질문은 howto 도구를 먼저 씁니다. 화면 이름만 던지지 말고 결과의 menu_path 와 steps 를 그대로 풀어서 안내합니다.
- menu_path 는 "왼쪽 메뉴 › 회의록 › ＋ 회의록 열기" 처럼 화살표로 이어 한 줄로 보여줍니다.
- steps 가 있으면 1. 2. 3. 으로 번호를 붙여 순서대로 적습니다. 단계를 요약해 뭉개지 않습니다.
- tip 이 있으면 마지막에 한 줄로 덧붙입니다.
- howto 에 없는 기능이면 지어내지 말고 "그건 아직 안내가 준비되지 않았습니다"라고 답한 뒤 메뉴 위치만 알려줍니다.
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

  // ── 회의록 정리 모드 — 전사/메모 → 제목·요약·액션아이템 (도구 호출 없음)
  if (payload.mode === "meeting") {
    const raw = String(payload.text || "").slice(0, 60000);
    if (raw.trim().length < 30)
      return Response.json({ error: "정리할 내용이 너무 짧습니다." }, { status: 400, headers: cors });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL_LARGE,
        max_tokens: 2000,
        system: [{ type: "text", text: MEET_SYS, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content:
              `(오늘은 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}입니다. "다음 주 금요일" 같은 표현은 이 날짜를 기준으로 환산하세요.)\n\n` +
              raw,
          },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ error: `정리 실패 (${res.status})`, detail: t.slice(0, 300) }, { status: 502, headers: cors });
    }
    const d = await res.json();
    const body = (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    let out: any = null;
    try {
      // 모델이 앞뒤에 말을 덧붙였을 수 있으니 바깥 중괄호만 잘라낸다
      out = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    } catch {
      return Response.json({ error: "정리 결과를 읽지 못했습니다. 다시 시도해 주세요." }, { status: 502, headers: cors });
    }
    return Response.json(
      {
        title: String(out.title || "").slice(0, 120),
        summary: String(out.summary || ""),
        action_items: Array.isArray(out.action_items) ? out.action_items.slice(0, 30) : [],
        brands: Array.isArray(out.brands) ? out.brands.slice(0, 20) : [],
        in: d?.usage?.input_tokens || 0,
        out: d?.usage?.output_tokens || 0,
      },
      { headers: cors },
    );
  }

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
