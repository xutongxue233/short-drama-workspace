import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generate } from "./providers/generate.mjs";

async function fixture(t, protocol = "ark") {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, body: raw ? JSON.parse(raw) : undefined });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        protocol === "webhook"
          ? { url: "https://example.test/clip.mp4" }
          : req.method === "POST"
            ? { id: "mock-video" }
            : {
                status: "succeeded",
                content: { video_url: "https://example.test/clip.mp4" },
              },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const provider = {
    id: "video-test",
    enabled: true,
    kind: "video",
    protocol,
    model: "doubao-seedance-2-0-260128",
    apiKey: "local-test-only",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
  return {
    calls,
    run: (extra = {}) =>
      generate({
        provider,
        prompt: "只生成批准的镜头01",
        kind: "video",
        pollIntervalMs: 1,
        ...extra,
      }),
  };
}

test("Seedance receives the exact approved shot duration and ratio", async (t) => {
  const fx = await fixture(t);
  await fx.run({ videoOptions: { duration: 8, ratio: "16:9" } });
  assert.equal(fx.calls[0].body.duration, 8);
  assert.equal(fx.calls[0].body.ratio, "16:9");
});

test("explicit Seedance duration limits reject short, long or fractional shots before submission", async (t) => {
  const fx = await fixture(t);
  let dispatches = 0;
  const onDispatch = () => {
    dispatches++;
  };
  for (const duration of [2, 3.5, 16])
    await assert.rejects(
      fx.run({ videoOptions: { duration, ratio: "9:16" }, onDispatch }),
      /要求 4–15 秒的整数时长/,
    );
  assert.equal(fx.calls.length, 0);
  assert.equal(dispatches, 0);
  await fx.run({ videoOptions: { duration: 4, ratio: "9:16" }, onDispatch });
  await fx.run({ videoOptions: { duration: 15, ratio: "9:16" }, onDispatch });
  assert.equal(dispatches, 2, "polling requests must not repeat the dispatch event");
  assert.deepEqual(
    fx.calls.filter((call) => call.method === "POST").map((call) => call.body.duration),
    [4, 15],
  );
});

test("unknown Ark endpoint limits are not guessed and Seedance 2.5 has its distinct duration range", async (t) => {
  const fx = await fixture(t);
  await assert.rejects(
    fx.run({ model: "ep-private", videoOptions: { duration: 8, ratio: "9:16" } }),
    /时长边界尚未确认/,
  );
  assert.equal(fx.calls.length, 0);
  await fx.run({
    model: "doubao-seedance-2-5-260628",
    videoOptions: { duration: 30, ratio: "21:9" },
  });
  assert.equal(fx.calls[0].body.duration, 30);
  await assert.rejects(
    fx.run({
      model: "doubao-seedance-2-5-260628",
      videoOptions: { duration: 31, ratio: "9:16" },
    }),
    /要求 4–30 秒/,
  );
});

test("video options reject invalid schemas without submitting a paid request", async (t) => {
  const fx = await fixture(t);
  for (const videoOptions of [
    null,
    {},
    [],
    { duration: "5", ratio: "9:16" },
    { duration: 5, ratio: "banana" },
    { duration: 0, ratio: "9:16" },
  ])
    await assert.rejects(fx.run({ videoOptions }), /视频参数需要/);
  assert.equal(fx.calls.length, 0);
});

test("Webhook video options remain explicit and support providers with fractional durations", async (t) => {
  const fx = await fixture(t, "webhook");
  await fx.run({ videoOptions: { duration: 3.5, ratio: "4:3" } });
  assert.equal(fx.calls[0].body.duration, 3.5);
  assert.equal(fx.calls[0].body.ratio, "4:3");
  await fx.run();
  assert.equal(fx.calls[1].body.duration, undefined);
});

test("legacy direct Ark calls retain defaults while workflow can supply explicit options", async (t) => {
  const fx = await fixture(t);
  await fx.run();
  assert.equal(fx.calls[0].body.duration, 5);
  assert.equal(fx.calls[0].body.ratio, "9:16");
});
