import denoJson from "../deno.json" with { type: "json" };

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const version = denoJson.version;
const changelog = await Deno.readTextFile(new URL("../CHANGELOG.md", import.meta.url));

function fail(message: string): never {
  Deno.stderr.writeSync(new TextEncoder().encode(`erro: ${message}\n`));
  Deno.exit(1);
}

if (!SEMVER.test(version)) {
  fail(`versão inválida no deno.json: ${version}`);
}

if (!/^## \[Unreleased\]/m.test(changelog)) {
  fail("CHANGELOG.md precisa conter a seção [Unreleased]");
}

if (version !== "0.0.0" && !changelog.includes(`## [${version}]`)) {
  fail(`CHANGELOG.md não possui seção para a versão ${version}`);
}

Deno.stdout.writeSync(
  new TextEncoder().encode(`versão ${version} sincronizada com CHANGELOG.md\n`),
);
