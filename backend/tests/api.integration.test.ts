import assert from "node:assert/strict";
import test from "node:test";

const integrationTest = process.env.RUN_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("core HTTP lifecycle", async () => {
  const { app } = await import("../src/server");
  const { prisma } = await import("../src/db/client");
  const http = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const email = `phase0-${Date.now()}@example.com`;
  const password = "ValidPass123!";
  let databaseReady = false;

  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    const health = await request("/health");
    assert.equal(health.status, 200);
    databaseReady = true;

    const unauthenticated = await request("/portfolio");
    assert.equal(unauthenticated.status, 401);

    const registered = await request("/auth/register", json({ email, password }));
    assert.equal(registered.status, 201);

    const login = await request("/auth/login", json({ email, password }));
    assert.equal(login.status, 200);
    const loginBody = await login.json() as { accessToken: string };
    assert.ok(loginBody.accessToken);
    const setCookie = login.headers.get("set-cookie");
    assert.ok(setCookie);
    const cookie = setCookie!.split(";", 1)[0];

    const refresh = await request("/auth/refresh", { method: "POST", headers: { cookie } });
    assert.equal(refresh.status, 200);
    const refreshBody = await refresh.json() as { accessToken: string };
    assert.ok(refreshBody.accessToken);
  } finally {
    if (databaseReady) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.$transaction([
          prisma.watchlistItem.deleteMany({ where: { userId: user.id } }),
          prisma.holding.deleteMany({ where: { userId: user.id } }),
          prisma.alert.deleteMany({ where: { userId: user.id } }),
          prisma.trade.deleteMany({ where: { userId: user.id } }),
          prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
          prisma.auditLog.deleteMany({ where: { userId: user.id } }),
          prisma.user.delete({ where: { id: user.id } }),
        ]);
      }
    }
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
