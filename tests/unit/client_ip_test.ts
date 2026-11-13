import { assert, assertEquals } from "@std/assert";
import {
  buildIpBlockList,
  isTrustedIp,
  normalizeIp,
  parseCidr,
} from "../../src/shared/utils/ip.ts";
import { resolveClientIp } from "../../src/http/middleware/rate-limit.ts";

const TRUSTED_CIDRS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

const trustedList = buildIpBlockList(TRUSTED_CIDRS);

Deno.test("normalizeIp aceita IPv4 simples", () => {
  assertEquals(normalizeIp("192.168.1.50"), "192.168.1.50");
});

Deno.test("normalizeIp remove porta de IPv4 com porta", () => {
  assertEquals(normalizeIp("192.168.1.50:443"), "192.168.1.50");
});

Deno.test("normalizeIp aceita IPv6 entre colchetes", () => {
  assertEquals(normalizeIp("[::1]"), "::1");
  assertEquals(normalizeIp("[2001:db8::1]"), "2001:db8::1");
});

Deno.test("normalizeIp remove porta de IPv6 com colchetes", () => {
  assertEquals(normalizeIp("[::1]:8443"), "::1");
});

Deno.test("normalizeIp converte IPv4 mapeado (::ffff:1.2.3.4)", () => {
  assertEquals(normalizeIp("::ffff:192.168.1.50"), "192.168.1.50");
});

Deno.test("normalizeIp devolve null para entrada inválida", () => {
  assertEquals(normalizeIp("nao-e-ip"), null);
  assertEquals(normalizeIp(""), null);
  assertEquals(normalizeIp("[invalid"), null);
});

Deno.test("parseCidr decompõe CIDR válido", () => {
  const v4 = parseCidr("10.0.0.0/8");
  assert(v4 !== null);
  assertEquals(v4!.address, "10.0.0.0");
  assertEquals(v4!.prefix, 8);
  assertEquals(v4!.family, "ipv4");

  const v6 = parseCidr("fc00::/7");
  assert(v6 !== null);
  assertEquals(v6!.address, "fc00::");
  assertEquals(v6!.prefix, 7);
  assertEquals(v6!.family, "ipv6");
});

Deno.test("parseCidr rejeita CIDR inválido", () => {
  assertEquals(parseCidr("10.0.0.0/33"), null);
  assertEquals(parseCidr("nao-e-cidr"), null);
  assertEquals(parseCidr("10.0.0.0"), null);
});

Deno.test("isTrustedIp devolve true para IPs nas faixas confiáveis", () => {
  assertEquals(isTrustedIp(trustedList, "127.0.0.1"), true);
  assertEquals(isTrustedIp(trustedList, "10.0.0.1"), true);
  assertEquals(isTrustedIp(trustedList, "172.16.0.1"), true);
  assertEquals(isTrustedIp(trustedList, "172.31.255.255"), true);
  assertEquals(isTrustedIp(trustedList, "192.168.1.1"), true);
  assertEquals(isTrustedIp(trustedList, "169.254.0.1"), true);
  assertEquals(isTrustedIp(trustedList, "100.64.0.1"), true);
  assertEquals(isTrustedIp(trustedList, "100.127.255.255"), true);
  assertEquals(isTrustedIp(trustedList, "::1"), true);
  assertEquals(isTrustedIp(trustedList, "fc00::1"), true);
  assertEquals(isTrustedIp(trustedList, "fe80::1"), true);
});

Deno.test("isTrustedIp devolve false para IPs públicos", () => {
  assertEquals(isTrustedIp(trustedList, "8.8.8.8"), false);
  assertEquals(isTrustedIp(trustedList, "1.1.1.1"), false);
  assertEquals(isTrustedIp(trustedList, "203.0.113.1"), false);
  assertEquals(isTrustedIp(trustedList, "2001:db8::1"), false);
});

Deno.test("resolveClientIp: peer público ignora X-Forwarded-For", () => {
  const ip = resolveClientIp(
    { peer: "203.0.113.10", forwardedFor: "198.51.100.1, 198.51.100.2", realIp: "198.51.100.3" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.10");
});

Deno.test("resolveClientIp: peer confiável usa posição fixa hops=1 (último do XFF)", () => {
  // Nginx anexa o IP real no final; hops=1 pega o último
  const ip = resolveClientIp(
    { peer: "172.17.0.1", forwardedFor: "198.51.100.1, 203.0.113.50", realIp: "203.0.113.60" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: hops=2 pega o penúltimo", () => {
  const ip = resolveClientIp(
    {
      peer: "172.17.0.1",
      forwardedFor: "198.51.100.1, 203.0.113.50, 192.0.2.10",
      realIp: "192.0.2.20",
    },
    trustedList,
    2,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: cadeia curta com hops maior que o tamanho devolve o primeiro", () => {
  const ip = resolveClientIp(
    { peer: "172.17.0.1", forwardedFor: "203.0.113.50", realIp: "203.0.113.60" },
    trustedList,
    3,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: XFF vazio cai no X-Real-IP quando peer é confiável", () => {
  const ip = resolveClientIp(
    { peer: "172.17.0.1", forwardedFor: "", realIp: "203.0.113.50" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: sem XFF e sem X-Real-IP devolve o peer confiável", () => {
  const ip = resolveClientIp(
    { peer: "172.17.0.1", forwardedFor: "", realIp: undefined },
    trustedList,
    1,
  );
  assertEquals(ip, "172.17.0.1");
});

Deno.test("resolveClientIp: sem peer válido devolve unknown", () => {
  const ip = resolveClientIp(
    { peer: undefined, forwardedFor: "203.0.113.1", realIp: "203.0.113.2" },
    trustedList,
    1,
  );
  assertEquals(ip, "unknown");
});

Deno.test("resolveClientIp: IPv6 peer confiável funciona", () => {
  const ip = resolveClientIp(
    { peer: "::1", forwardedFor: "2001:db8::1, 203.0.113.50", realIp: "203.0.113.60" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: IPv4 mapeado no peer é normalizado", () => {
  const ip = resolveClientIp(
    { peer: "::ffff:172.17.0.1", forwardedFor: "203.0.113.50", realIp: "203.0.113.60" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.50");
});

Deno.test("resolveClientIp: XFF com lixo e espaços é filtrado", () => {
  const ip = resolveClientIp(
    { peer: "172.17.0.1", forwardedFor: "  , invalid , 203.0.113.50 ,  ", realIp: "203.0.113.60" },
    trustedList,
    1,
  );
  assertEquals(ip, "203.0.113.50");
});
