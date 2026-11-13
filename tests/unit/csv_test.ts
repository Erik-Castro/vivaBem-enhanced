import { assertEquals } from "@std/assert";
import { escapeCsv } from "../../src/modules/export/export.service.ts";

Deno.test("escapeCsv: número puro sem sinal não muda", () => {
  assertEquals(escapeCsv("12345"), "12345");
  assertEquals(escapeCsv("0"), "0");
});

Deno.test("escapeCsv: número com sinal positivo permanece numérico", () => {
  assertEquals(escapeCsv("+12345"), "+12345");
});

Deno.test("escapeCsv: número negativo permanece numérico", () => {
  assertEquals(escapeCsv("-12345"), "-12345");
  assertEquals(escapeCsv("-0.5"), "-0.5");
});

Deno.test("escapeCsv: decimal puro permanece numérico", () => {
  assertEquals(escapeCsv("123.45"), "123.45");
  assertEquals(escapeCsv("0.99"), "0.99");
});

Deno.test("escapeCsv: fórmula iniciada por = ganha apóstrofo", () => {
  assertEquals(escapeCsv("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assertEquals(escapeCsv("=1+1"), "'=1+1");
});

Deno.test("escapeCsv: fórmula iniciada por + ganha apóstrofo", () => {
  assertEquals(escapeCsv("+A1+B1"), "'+A1+B1");
});

Deno.test("escapeCsv: fórmula iniciada por - ganha apóstrofo", () => {
  assertEquals(escapeCsv("-A1-B1"), "'-A1-B1");
});

Deno.test("escapeCsv: fórmula iniciada por @ ganha apóstrofo", () => {
  assertEquals(escapeCsv("@SUM(A1:A10)"), "'@SUM(A1:A10)");
});

Deno.test("escapeCsv: tab no início ganha apóstrofo", () => {
  assertEquals(escapeCsv("\tvalor"), "'\tvalor");
});

Deno.test("escapeCsv: CR no início ganha apóstrofo E aspas (por conter CR)", () => {
  // CR no início é caractere de fórmula → apóstrofo, mas CR também exige aspas
  assertEquals(escapeCsv("\rvalor"), '"\'\rvalor"');
});

Deno.test("escapeCsv: texto normal sem separadores não muda", () => {
  assertEquals(escapeCsv("Feira semanal"), "Feira semanal");
  assertEquals(escapeCsv("Pagamento"), "Pagamento");
});

Deno.test("escapeCsv: texto com vírgula é envolvido em aspas e aspas internas dobradas", () => {
  assertEquals(escapeCsv('Feira, "semanal"'), '"Feira, ""semanal"""');
});

Deno.test("escapeCsv: texto com aspas dobra as aspas", () => {
  assertEquals(escapeCsv('Disse "olá"'), '"Disse ""olá"""');
});

Deno.test("escapeCsv: texto com quebra de linha é envolvido em aspas", () => {
  assertEquals(escapeCsv("Linha 1\nLinha 2"), '"Linha 1\nLinha 2"');
});

Deno.test("escapeCsv: texto com CR é envolvido em aspas", () => {
  assertEquals(escapeCsv("Linha 1\rLinha 2"), '"Linha 1\rLinha 2"');
});

Deno.test("escapeCsv: fórmula com vírgula ganha apóstrofo E aspas", () => {
  // Fórmula + vírgula → apóstrofo + aspas (a vírgula exige aspas)
  assertEquals(escapeCsv("=SUM(A1,B1)"), '"\'=SUM(A1,B1)"');
});

Deno.test("escapeCsv: valor já prefixado não dobra apóstrofo", () => {
  // Valor já começa com apóstrofo → não adiciona outro, sem separadores → sem aspas
  assertEquals(escapeCsv("'=SUM(A1:A10)"), "'=SUM(A1:A10)");
});

Deno.test("escapeCsv: string vazia permanece vazia", () => {
  assertEquals(escapeCsv(""), "");
});

Deno.test("escapeCsv: apenas espaços não é fórmula", () => {
  assertEquals(escapeCsv("  valor"), "  valor");
});
