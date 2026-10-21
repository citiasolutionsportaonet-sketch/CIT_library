import { describe, expect, it } from "vitest";
import { isPrivateIp } from "@/modules/research/http";
import { isAllowed, parseRobots } from "@/modules/research/robots";

describe("SSRF", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.112", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])("bloqueia %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "200.147.67.142", "2606:4700::6810:84e5"])("permite %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("robots.txt", () => {
  const txt = `User-agent: *\nContent-Signal: search=yes\nAllow: /\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: ClaudeBot\nDisallow: /\n`;
  it("usa o grupo * para o nosso agente", () => {
    const r = parseRobots(txt, "CITLibraryBot");
    expect(isAllowed(r, "/pt-br/camera")).toBe(true);
    expect(isAllowed(r, "/admin/x")).toBe(false);
    expect(isAllowed(r, "/admin/public/a")).toBe(true);
  });
  it("respeita grupo específico", () => {
    expect(isAllowed(parseRobots(txt, "ClaudeBot"), "/")).toBe(false);
  });
  it("curingas e âncora", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$\n", "x");
    expect(isAllowed(r, "/a/manual.pdf")).toBe(false);
    expect(isAllowed(r, "/a/manual.pdf?x=1")).toBe(true);
  });
});
