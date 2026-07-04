const request = require("supertest");
const app = require("../src/index");

describe("GET /", () => {
  it("responde 200 con un mensaje", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});

describe("GET /health", () => {
  it("responde 200 con status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
