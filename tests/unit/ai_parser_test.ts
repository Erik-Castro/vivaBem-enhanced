import { assertEquals, assertThrows } from "@std/assert";
import {
  AiResponseParseError,
  extractJsonObject,
  parseAiResponse,
} from "../../src/ai/ai.parser.ts";

Deno.test("parser aceita o contrato canônico", () => {
  const response = parseAiResponse(
    JSON.stringify({
      confidence: 0.82,
      analysis: { risk: "medium", summary: "Gasto acima do normal" },
      tool_calls: [
        { name: "create_insight", arguments: { title: "Atenção", message: "..." } },
      ],
    }),
  );

  assertEquals(response.confidence, 0.82);
  assertEquals(response.analysis.risk, "medium");
  assertEquals(response.analysis.summary, "Gasto acima do normal");
  assertEquals(response.toolCalls.length, 1);
  assertEquals(response.toolCalls[0]?.name, "create_insight");
  assertEquals(response.toolCalls[0]?.arguments, {
    title: "Atenção",
    message: "...",
  });
});

Deno.test("parser remove bloco think e cerca markdown", () => {
  const raw = `Vou analisar com calma.
<think>Rascunho interno que não deve chegar ao parser.</think>
\`\`\`json
{
  "confidence": 0.9,
  "analysis": { "risk": "low", "summary": "Tudo certo" },
  "tool_calls": []
}
\`\`\`
Fim.`;

  const response = parseAiResponse(raw);
  assertEquals(response.confidence, 0.9);
  assertEquals(response.analysis.summary, "Tudo certo");
  assertEquals(response.toolCalls, []);
});

Deno.test("extractJsonObject ignora chaves dentro de strings", () => {
  const extracted = extractJsonObject(
    'prefixo {"summary": "use { e } literalmente", "ok": true} sufixo',
  );
  assertEquals(extracted, '{"summary": "use { e } literalmente", "ok": true}');
});

Deno.test("parser normaliza formatos alternativos de tool call", () => {
  const tools = parseAiResponse(
    JSON.stringify({
      confidence: 0.7,
      analysis: { risk: "low", summary: "A" },
      tools: [{ tool: "notify_user", params: { message: "oi" } }],
    }),
  );
  assertEquals(tools.toolCalls[0]?.name, "notify_user");
  assertEquals(tools.toolCalls[0]?.arguments, { message: "oi" });

  const single = parseAiResponse(
    JSON.stringify({
      confidence: 0.7,
      analysis: { risk: "low", summary: "B" },
      tool_call: { name: "block_ip", args: { ip: "10.0.0.1" } },
    }),
  );
  assertEquals(single.toolCalls[0]?.arguments, { ip: "10.0.0.1" });

  const action = parseAiResponse(
    JSON.stringify({
      confidence: 0.7,
      analysis: { risk: "low", summary: "C" },
      action: "create_insight",
      arguments: { title: "t" },
    }),
  );
  assertEquals(action.toolCalls[0]?.name, "create_insight");
  assertEquals(action.toolCalls[0]?.arguments, { title: "t" });
});

Deno.test("parser clampa confiança e normaliza risco desconhecido", () => {
  const high = parseAiResponse(
    JSON.stringify({
      confidence: "1.7",
      analysis: { risk: "extremo", summary: "x" },
      tool_calls: [],
    }),
  );
  assertEquals(high.confidence, 1);
  assertEquals(high.analysis.risk, "low");

  const low = parseAiResponse(
    JSON.stringify({
      confidence: -3,
      analysis: { risk: "high", summary: "x" },
      tool_calls: [],
    }),
  );
  assertEquals(low.confidence, 0);
  assertEquals(low.analysis.risk, "high");
});

Deno.test("parser aceita summary e message no nível raiz", () => {
  const fromSummary = parseAiResponse(
    JSON.stringify({ confidence: 0.6, risk: "high", summary: "raiz", tool_calls: [] }),
  );
  assertEquals(fromSummary.analysis.summary, "raiz");
  assertEquals(fromSummary.analysis.risk, "high");

  const fromMessage = parseAiResponse(
    JSON.stringify({ confidence: 0.6, message: "mensagem", tool_calls: [] }),
  );
  assertEquals(fromMessage.analysis.summary, "mensagem");
});

Deno.test("parser rejeita resposta sem JSON", () => {
  assertThrows(
    () => parseAiResponse("desculpe, não consegui analisar"),
    AiResponseParseError,
  );
});

Deno.test("parser rejeita JSON inválido", () => {
  assertThrows(
    () => parseAiResponse('{"confidence": 0.5, "analysis": }'),
    AiResponseParseError,
  );
});

Deno.test("parser rejeita JSON que não é objeto", () => {
  assertThrows(() => parseAiResponse("[1, 2, 3]"), AiResponseParseError);
});
