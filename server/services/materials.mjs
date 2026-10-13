import { createHash, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HttpError } from "../http/errors.mjs";
import { snapshotState, stateTransaction } from "../state-transaction.mjs";

const ID = /^material-[0-9a-f-]{36}$/;
const LOCAL = /^\/api\/media\/(material-[0-9a-f-]{36})\/file(?:\?download=1)?$/;
const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};
const LIMITS = {
  image: 30 * 1024 * 1024,
  video: 300 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
};
const localUrl = (id) => `/api/media/${id}/file`;

function networkUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("素材地址格式无效。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("素材只支持无用户名、密码的 HTTP(S) 地址。");
  return url;
}

// Trust file signatures, never a server-provided extension or HTML content type.
function mediaFormat(buffer, type) {
  const ascii = (start, end) => buffer.toString("ascii", start, end);
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mime = "image/png";
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    mime = "image/jpeg";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") mime = "image/webp";
  else if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) mime = "image/gif";
  else if (ascii(4, 8) === "ftyp")
    mime = /avif|avis/.test(ascii(8, 32)) ? "image/avif" : "video/mp4";
  else if (buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    mime = "video/webm";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") mime = "audio/wav";
  else if (ascii(0, 4) === "OggS") mime = "audio/ogg";
  else if (ascii(0, 3) === "ID3" || (buffer[0] === 255 && (buffer[1] & 224) === 224))
    mime = "audio/mpeg";
  if (!mime || !mime.startsWith(`${type}/`))
    throw new Error(
      "下载内容不是有效的目标媒体格式，已拒绝保存（可能是链接失效后的错误页面）。",
    );
  return mime;
}

function materialType(asset) {
  if (asset.type === "video") return "video";
  if (asset.type === "audio") return "audio";
  return "image";
}

/** Local media is independent of replaceable/archived creative assets. */
export function createMaterialService({
  getState,
  save,
  dataDir,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 90_000,
  limits = LIMITS,
}) {
  const directory = resolve(dataDir, "media");
  const jobs = new Map();
  let closed = false;
  const persist = () => {
    if (!closed) save();
  };
  const find = (id) => {
    if (!ID.test(id)) return undefined;
    for (const project of getState().projects) {
      const material = project.materials?.find((item) => item.id === id);
      if (material) return { project, material };
    }
  };
  const pathFor = (material) => {
    const extension = EXTENSIONS[material.mimeType];
    if (!ID.test(material.id) || !extension)
      throw new HttpError(404, "本地素材不存在。");
    return resolve(directory, `${material.id}.${extension}`);
  };
  const updateAssets = (project, material) => {
    for (const asset of project.assets || []) {
      if (
        asset.materialId === material.id ||
        (!asset.materialId &&
          asset.id === material.assetId &&
          asset.url === material.sourceUrl)
      ) {
        asset.materialId = material.id;
        if (material.status === "local") asset.url = material.url;
      }
    }
  };

  // Interrupted downloads are explicitly retryable; startup never fetches remote URLs.
  let recovered = false;
  for (const project of getState().projects)
    for (const material of project.materials || [])
      if (material.status === "downloading") {
        material.status = "failed";
        material.error = "上次下载被中断，可重试保存；生成结果仍已保留。";
        recovered = true;
      }
  if (recovered) persist();

  async function responseFor(source, signal) {
    let url = networkUrl(source);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetchImpl(url.href, {
        signal,
        redirect: "manual",
        credentials: "omit",
        headers: { Accept: "image/*,video/*,audio/*,application/octet-stream" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects === 5)
          throw new Error("素材下载重定向次数过多或缺少目标地址。");
        const target = networkUrl(new URL(location, url).href);
        if (url.protocol === "https:" && target.protocol !== "https:")
          throw new Error("素材下载拒绝从 HTTPS 重定向到不安全的 HTTP 地址。");
        url = target;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `素材下载失败（HTTP ${response.status}），远程链接可能已过期。`,
        );
      }
      return response;
    }
  }

  async function download(project, material, callerSignal, reservedJob) {
    if (closed) throw new HttpError(503, "素材服务正在关闭。");
    if (jobs.has(material.id) && jobs.get(material.id) !== reservedJob)
      return jobs.get(material.id).promise;
    const controller = reservedJob?.controller ?? new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
      ...(callerSignal ? [callerSignal] : []),
    ]);
    stateTransaction(material, () => {
      material.status = "downloading";
      delete material.error;
      persist();
    });
    const temporary = resolve(directory, `${material.id}.${randomUUID()}.part`);
    const promise = (async () => {
      let handle;
      let localSaved = false;
      const originalSource = material.sourceUrl;
      try {
        signal.throwIfAborted();
        const maximum = limits[material.type] || LIMITS[material.type];
        let response;
        if (material.sourceUrl.startsWith("data:")) {
          const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
            material.sourceUrl,
          );
          if (!match) throw new Error("内嵌素材数据格式无效。");
          if (match[2].length > Math.ceil(maximum / 3) * 4)
            throw new Error("素材超过本地保存的大小限制。");
          response = new Response(Buffer.from(match[2], "base64"));
        } else response = await responseFor(material.sourceUrl, signal);
        const length = Number(response.headers.get("content-length") || 0);
        if (length > maximum) {
          await response.body?.cancel();
          throw new Error("素材超过本地保存的大小限制。");
        }
        if (!response.body) throw new Error("素材下载响应为空。");
        await mkdir(directory, { recursive: true });
        handle = await open(temporary, "wx");
        let bytes = 0;
        let signature = Buffer.alloc(0);
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maximum) throw new Error("素材超过本地保存的大小限制。");
          if (signature.length < 64)
            signature = Buffer.concat([
              signature,
              buffer.subarray(0, 64 - signature.length),
            ]);
          await handle.writeFile(buffer);
        }
        const mimeType = mediaFormat(signature, material.type);
        await handle.sync();
        await handle.close();
        handle = undefined;
        signal.throwIfAborted();
        const destination = pathFor({ ...material, mimeType });
        await rename(temporary, destination);
        localSaved = true;
        if (closed) return material;
        Object.assign(material, {
          status: "local",
          url: localUrl(material.id),
          mimeType,
          bytes,
          savedAt: new Date().toISOString(),
        });
        updateAssets(project, material);
        // The binary now lives on disk; never keep a second Base64 copy in SQLite.
        if (material.sourceUrl.startsWith("data:"))
          material.sourceUrl = `data:${mimeType};base64`;
        persist();
      } catch (error) {
        if (localSaved && !closed) {
          // The durable binary is already complete. Never downgrade it to a
          // failed remote download or discard its only retryable source.
          material.sourceUrl = originalSource;
          material.error = "本地文件已保存，但素材记录保存失败，请重试保存。";
          throw error;
        }
        if (!closed) {
          material.status = "failed";
          material.url =
            /^https?:\/\//.test(material.sourceUrl) ||
            /^data:[^,]+;base64,/.test(material.sourceUrl)
              ? material.sourceUrl
              : "";
          material.error = signal.aborted
            ? "素材下载已中断或超时，生成结果已保留，可重试下载。"
            : error instanceof TypeError
              ? "素材下载连接失败，生成结果已保留，可重试下载。"
              : error.message;
          persist();
        }
      } finally {
        await handle?.close();
        await rm(temporary, { force: true }).catch(() => {});
        jobs.delete(material.id);
      }
      return material;
    })();
    if (!reservedJob) jobs.set(material.id, { promise, controller, material });
    return promise;
  }

  async function capture(project, input, signal) {
    if (closed) throw new HttpError(503, "素材服务正在关闭。");
    if (!LIMITS[input.type] || typeof input.url !== "string")
      throw new HttpError(400, "素材类型或地址无效。");
    let sourceUrl = input.url;
    let sourceError;
    if (!sourceUrl.startsWith("data:")) {
      try {
        sourceUrl = networkUrl(sourceUrl).href;
      } catch (error) {
        sourceUrl = "";
        sourceError = error.message;
      }
    }
    if (input.captureId !== undefined && !ID.test(input.captureId))
      throw new HttpError(400, "素材恢复标识无效。");
    const sourceHash = createHash("sha256").update(sourceUrl).digest("hex");
    const existing = input.captureId && find(input.captureId);
    if (existing) {
      if (
        existing.project !== project ||
        existing.material.type !== input.type ||
        (existing.material.sourceHash
          ? existing.material.sourceHash !== sourceHash
          : existing.material.sourceUrl !== sourceUrl)
      )
        throw new HttpError(409, "素材恢复标识已关联其他生成结果。");
      return retry(project, existing.material.id, signal);
    }
    const material = {
      id: input.captureId ?? `material-${randomUUID()}`,
      projectId: project.id,
      name: input.name || "未命名素材",
      type: input.type,
      sourceUrl,
      sourceHash,
      url: sourceUrl,
      status: sourceError ? "failed" : "remote",
      createdAt: new Date().toISOString(),
    };
    for (const key of ["nodeId", "assetId", "providerId", "model", "prompt"])
      if (input[key] !== undefined) material[key] = input[key];
    if (Array.isArray(input.referenceAssets))
      material.referenceAssets = input.referenceAssets.map((reference) => ({
        id: reference.id,
        name: reference.name,
        type: reference.type,
        version: reference.version,
        ...(reference.materialId ? { materialId: reference.materialId } : {}),
      }));
    if (typeof input.providerTaskId === "string" && input.providerTaskId)
      material.providerTaskId = input.providerTaskId;
    if (input.videoShot && typeof input.videoShot === "object") {
      material.videoShot = {};
      for (const key of [
        "id",
        "startSeconds",
        "endSeconds",
        "durationSeconds",
        "storyboardId",
        "storyboardVersion",
      ])
        if (input.videoShot[key] !== undefined)
          material.videoShot[key] = input.videoShot[key];
    }
    if (sourceError) material.error = sourceError;
    stateTransaction(project, () => {
      (project.materials ||= []).push(material);
      persist();
    });
    return sourceError ? material : download(project, material, signal);
  }

  async function file(id) {
    if (closed) throw new HttpError(503, "素材服务正在关闭。");
    const found = find(id);
    if (!found || found.material.status !== "local")
      throw new HttpError(404, "本地素材不存在或尚未保存。");
    const path = pathFor(found.material);
    try {
      if (!(await stat(path)).isFile()) throw new Error();
    } catch {
      throw new HttpError(404, "本地素材文件缺失，请重新下载或生成。");
    }
    return {
      path,
      material: found.material,
      extension: EXTENSIONS[found.material.mimeType],
    };
  }

  async function references(refs, kind) {
    return Promise.all(
      refs.map(async (reference) => {
        const original = typeof reference === "string" ? reference : reference.url;
        if (typeof original !== "string") return reference;
        const match = LOCAL.exec(original);
        if (kind === "text" && (match || original.startsWith("data:"))) {
          if (typeof reference === "string")
            return "本地参考素材（文字接口仅使用资产说明）";
          const result = { ...reference };
          delete result.url;
          return result;
        }
        if (!match) return reference;
        const stored = await file(match[1]);
        if (stored.material.type !== "image")
          throw new HttpError(
            400,
            "此模型调用暂不支持本地视频或音频作为参考，请使用图片参考资产。",
          );
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(stored.material.mimeType)
        )
          throw new HttpError(
            400,
            "模型参考图片需为 PNG、JPEG 或 WebP，请转换后重新导入。",
          );
        const buffer = await readFile(stored.path);
        if (buffer.length > 18 * 1024 * 1024)
          throw new HttpError(
            400,
            "本地参考图超过模型内嵌图片限制（18 MiB），请缩小后重试。",
          );
        mediaFormat(buffer.subarray(0, 64), "image");
        const url = `data:${stored.material.mimeType};base64,${buffer.toString("base64")}`;
        return typeof reference === "string" ? url : { ...reference, url };
      }),
    );
  }

  async function retry(project, materialId, signal) {
    if (closed) throw new HttpError(503, "素材服务正在关闭。");
    const material = project.materials?.find((item) => item.id === materialId);
    if (!material) throw new HttpError(404, "素材不存在。");
    if (jobs.has(materialId)) return jobs.get(materialId).promise;
    // Reserve before the first filesystem await: deletion and shutdown must
    // observe recovery as an active job, just like a remote download.
    const controller = new AbortController();
    const job = { controller, material };
    jobs.set(materialId, job);
    const recoverySignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    job.promise = recover(project, material, recoverySignal, job).finally(() => {
      if (jobs.get(materialId) === job) jobs.delete(materialId);
    });
    return job.promise;
  }

  async function recover(project, material, signal, job) {
    // A crash or failed SQLite save can leave a complete binary with an older
    // remote/downloading record. Recover the validated file before any fetch.
    for (const [mimeType, extension] of Object.entries(EXTENSIONS)) {
      if (!mimeType.startsWith(`${material.type}/`)) continue;
      const path = resolve(directory, `${material.id}.${extension}`);
      let bytes;
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        const handle = await open(path, "r");
        try {
          const signature = Buffer.alloc(64);
          const { bytesRead } = await handle.read(signature, 0, 64, 0);
          if (mediaFormat(signature.subarray(0, bytesRead), material.type) !== mimeType)
            continue;
        } finally {
          await handle.close();
        }
        bytes = info.size;
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (closed) throw new HttpError(503, "素材服务正在关闭。");
      signal?.throwIfAborted();
      const source = material.sourceUrl;
      Object.assign(material, {
        status: "local",
        url: localUrl(material.id),
        mimeType,
        bytes,
        savedAt: material.savedAt ?? new Date().toISOString(),
      });
      updateAssets(project, material);
      if (source.startsWith("data:")) material.sourceUrl = `data:${mimeType};base64`;
      delete material.error;
      try {
        persist();
      } catch (error) {
        material.sourceUrl = source;
        material.error = "本地文件已保存，但素材记录保存失败，请重试保存。";
        throw error;
      }
      return material;
    }
    signal.throwIfAborted();
    return download(project, material, signal, job);
  }

  async function importExisting(project) {
    const result = [];
    for (const asset of project.assets || []) {
      if (!asset.url) continue;
      let material = project.materials?.find(
        (item) =>
          item.id === asset.materialId ||
          item.url === asset.url ||
          item.sourceUrl === asset.url,
      );
      if (!material && LOCAL.test(asset.url)) continue;
      if (!material)
        material = await capture(project, {
          url: asset.url,
          name: asset.name,
          type: materialType(asset),
          assetId: asset.id,
          nodeId: asset.tags?.find((tag) => tag.startsWith("node:"))?.slice(5),
        });
      else if (material.status !== "local")
        material = await download(project, material);
      if (closed) break;
      asset.materialId = material.id;
      if (material.status === "local") asset.url = material.url;
      persist();
      result.push(material);
    }
    return result;
  }

  // Keep validation, persistence and unlink synchronous: retries cannot start in
  // between, and a failed state save must never remove the only local binary.
  function remove(project, materialId, beforeSave = () => {}) {
    if (closed) throw new HttpError(503, "素材服务正在关闭。");
    if (project.running) throw new HttpError(409, "请先暂停项目，再删除素材。");
    const material = project.materials?.find((item) => item.id === materialId);
    if (!material || !ID.test(materialId)) throw new HttpError(404, "素材不存在。");
    if (jobs.has(materialId) || material.status === "downloading")
      throw new HttpError(409, "素材正在下载，请等待下载结束后再删除。");
    const referencesMaterial = (asset) =>
      asset.materialId
        ? asset.materialId === materialId
        : asset.url === localUrl(materialId) ||
          (Boolean(material.url) && asset.url === material.url) ||
          (asset.id === material.assetId && asset.url === material.sourceUrl);
    const assets = (project.assets || []).filter(referencesMaterial);
    if (
      getState().projects.some((item) =>
        item.episodeArchive?.some(
          (episode) =>
            episode.materials.some((reference) => reference.id === materialId) ||
            episode.assets.some(referencesMaterial),
        ),
      )
    )
      throw new HttpError(
        409,
        "素材被已归档剧集引用，需保留以便查看制作记录，无法删除。",
      );
    if (assets.some((asset) => asset.locked))
      throw new HttpError(409, "素材被已锁定资产引用，请先解锁相关资产后再删除。");
    if (
      getState().projects.some(
        (other) => other !== project && other.assets?.some(referencesMaterial),
      )
    )
      throw new HttpError(409, "素材被其他项目引用，无法删除。");
    const path = material.mimeType ? pathFor(material) : undefined;
    if (path && dirname(path) !== directory)
      throw new HttpError(400, "素材文件路径无效。");
    const restore = snapshotState(project);
    try {
      const removedIds = new Set(assets.map((asset) => asset.id));
      project.assets = (project.assets || []).filter(
        (asset) => !removedIds.has(asset.id),
      );
      project.materials = project.materials.filter((item) => item.id !== materialId);
      beforeSave({ material, assets });
      project.updatedAt = new Date().toISOString();
      save();
    } catch (error) {
      restore();
      throw error;
    }
    try {
      if (path) unlinkSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") {
        restore();
        save();
        throw new HttpError(409, "本地素材文件暂时无法删除，记录已恢复，请稍后重试。");
      }
    }
    return { material, assets };
  }

  return {
    capture,
    file,
    references,
    retry,
    importExisting,
    remove,
    close() {
      if (closed) return;
      for (const { material } of jobs.values()) {
        material.status = "failed";
        material.error = "本地服务关闭导致下载中断，可重试下载。";
      }
      try {
        if (jobs.size) persist();
      } finally {
        closed = true;
        for (const { controller } of jobs.values()) controller.abort();
      }
    },
  };
}
