import { assertEquals } from "@std/assert";
import {
  detectImportFormat,
  parseAmountToMinor,
  parseBusinessDate,
  parseCsv,
  parseOfx,
  parseType,
} from "../../src/modules/import/import.parsers.ts";

Deno.test("detecta o formato pelo conteúdo, não pela extensão", () => {
  assertEquals(detectImportFormat("OFXHEADER:100\nDATA:OFXSGML"), "ofx");
  assertEquals(detectImportFormat('<?xml version="1.0"?><OFX>'), "ofx");
  assertEquals(detectImportFormat("data,valor\n2026-01-01,10.00"), "csv");
  assertEquals(detectImportFormat("   "), null);
});

Deno.test("converte valores monetários sem ponto flutuante", () => {
  assertEquals(parseAmountToMinor("1.234,56"), 123456);
  assertEquals(parseAmountToMinor("1234.56"), 123456);
  assertEquals(parseAmountToMinor("R$ 1.234,56"), 123456);
  assertEquals(parseAmountToMinor("-45,90"), -4590);
  assertEquals(parseAmountToMinor("(12,34)"), -1234);
  assertEquals(parseAmountToMinor("10"), 1000);
  assertEquals(parseAmountToMinor("0,005"), 1);
  assertEquals(parseAmountToMinor(""), null);
  assertEquals(parseAmountToMinor("abc"), null);
});

Deno.test("aceita datas ISO, pt-BR e OFX", () => {
  assertEquals(parseBusinessDate("2026-12-31"), "2026-12-31");
  assertEquals(parseBusinessDate("31/12/2026"), "2026-12-31");
  assertEquals(parseBusinessDate("31/12/26"), "2026-12-31");
  assertEquals(parseBusinessDate("2026/12/31"), "2026-12-31");
  assertEquals(parseBusinessDate("2026-02-30"), null);
  assertEquals(parseBusinessDate("sem data"), null);
});

Deno.test("normaliza tipos explícitos em português e inglês", () => {
  assertEquals(parseType("Receita"), "income");
  assertEquals(parseType("crédito"), "income");
  assertEquals(parseType("Débito"), "expense");
  assertEquals(parseType("payment"), "expense");
  assertEquals(parseType("outro"), null);
});

Deno.test("CSV com ponto e vírgula, campos citados e sinal", () => {
  const content = [
    "Data;Valor;Descrição;Tipo;ID",
    '01/02/2026;-1.234,56;"Mercado, centro";Despesa;abc-1',
    "02/02/2026;500,00;Salário;Receita;abc-2",
    "03/02/2026;0;Inválida;;abc-3",
  ].join("\n");

  const parsed = parseCsv(content, "checking");

  assertEquals(parsed.format, "csv");
  assertEquals(parsed.rows.length, 2);
  assertEquals(parsed.rows[0]?.transactionDate, "2026-02-01");
  assertEquals(parsed.rows[0]?.amountMinor, 123456);
  assertEquals(parsed.rows[0]?.type, "expense");
  assertEquals(parsed.rows[0]?.description, "Mercado, centro");
  assertEquals(parsed.rows[0]?.externalId, "abc-1");
  assertEquals(parsed.rows[1]?.type, "income");
  assertEquals(parsed.errors.length, 1);
});

Deno.test("cartão de crédito força despesa e sinal manda quando não há tipo", () => {
  const content = "date,amount,description\n2026-01-10,100.00,Compra\n";
  const checking = parseCsv(content, "checking");
  assertEquals(checking.rows[0]?.type, "income");

  const card = parseCsv(content, "credit_card");
  assertEquals(card.rows[0]?.type, "expense");
});

Deno.test("CSV sem cabeçalho obrigatório reporta erro", () => {
  const parsed = parseCsv("foo,bar\n1,2\n", "checking");
  assertEquals(parsed.rows.length, 0);
  assertEquals(parsed.errors[0]?.message.includes("Cabeçalho inválido"), true);
});

Deno.test("OFX 1.x (SGML) e 2.x (XML) extraem STMTTRN", () => {
  const sgml = [
    "OFXHEADER:100",
    "<OFX>",
    "<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
    "<STMTTRN>",
    "<TRNTYPE>DEBIT",
    "<DTPOSTED>20260115",
    "<TRNAMT>-42.90",
    "<FITID>fit-1",
    "<MEMO>Padaria",
    "</STMTTRN>",
    "<STMTTRN>",
    "<TRNTYPE>CREDIT",
    "<DTPOSTED>20260116",
    "<TRNAMT>1000.00",
    "<FITID>fit-2",
    "<MEMO>Salário",
    "</STMTTRN>",
    "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
  ].join("\n");

  const parsed = parseOfx(sgml, "checking");
  assertEquals(parsed.rows.length, 2);
  assertEquals(parsed.rows[0]?.transactionDate, "2026-01-15");
  assertEquals(parsed.rows[0]?.amountMinor, 4290);
  assertEquals(parsed.rows[0]?.type, "expense");
  assertEquals(parsed.rows[0]?.externalId, "fit-1");
  assertEquals(parsed.rows[1]?.type, "income");

  const xml = [
    '<?xml version="1.0"?><OFX>',
    "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260115</DTPOSTED>",
    "<TRNAMT>-42.90</TRNAMT><FITID>fit-1</FITID><MEMO>Padaria</MEMO></STMTTRN>",
    "<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260116</DTPOSTED>",
    "<TRNAMT>1000.00</TRNAMT><FITID>fit-2</FITID><MEMO>Salário</MEMO></STMTTRN>",
    "</OFX>",
  ].join("\n");
  assertEquals(parseOfx(xml, "checking").rows.length, 2);
});

Deno.test("OFX sem STMTTRN reporta erro", () => {
  const parsed = parseOfx("OFXHEADER:100\n<OFX></OFX>", "checking");
  assertEquals(parsed.rows.length, 0);
  assertEquals(parsed.errors.length, 1);
});
