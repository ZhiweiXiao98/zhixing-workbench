import { gunzip } from "node:zlib";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export async function archivePaths(archive) {
  return (await readArchive(archive)).map((entry) => entry.path);
}

export async function extractArchive(archive, destination) {
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  for (const entry of await readArchive(archive)) {
    const target = safeTarget(root, entry.path);
    if (entry.type === "directory") {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (entry.type !== "file") throw new Error(`Release 包含不支持的归档类型：${entry.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.content);
    if (process.platform !== "win32" && entry.mode) await chmod(target, entry.mode & 0o777);
  }
}

async function readArchive(archive) {
  const data = await gunzipAsync(await readFile(archive));
  const entries = [];
  let offset = 0;
  let nextPath = "";
  let globalPax = {};
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const size = tarNumber(header.subarray(124, 136));
    const mode = tarNumber(header.subarray(100, 108));
    const typeFlag = String.fromCharCode(header[156] || 0);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > data.length) throw new Error("Release tar 内容不完整");
    const body = data.subarray(bodyStart, bodyEnd);
    const headerPath = tarPath(header);

    if (typeFlag === "x" || typeFlag === "g") {
      const values = parsePax(body);
      if (typeFlag === "g") globalPax = { ...globalPax, ...values };
      else nextPath = values.path || nextPath;
    } else if (typeFlag === "L") {
      nextPath = nullTerminated(body);
    } else {
      const entryPath = normalizeArchivePath(nextPath || globalPax.path || headerPath);
      nextPath = "";
      if (entryPath) {
        entries.push({
          path: entryPath,
          type: typeFlag === "5" ? "directory" : typeFlag === "\0" || typeFlag === "0" || typeFlag === "7" ? "file" : "unsupported",
          content: body,
          mode
        });
      }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarPath(header) {
  const name = nullTerminated(header.subarray(0, 100));
  const prefix = nullTerminated(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function tarNumber(value) {
  if ((value[0] || 0) & 0x80) {
    let result = BigInt((value[0] || 0) & 0x7f);
    for (const byte of value.subarray(1)) result = (result << 8n) | BigInt(byte);
    return Number(result);
  }
  const text = nullTerminated(value).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function parsePax(body) {
  const values = {};
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(body.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > body.length) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function nullTerminated(value) {
  const end = value.indexOf(0);
  return value.subarray(0, end < 0 ? value.length : end).toString("utf8");
}

function normalizeArchivePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function safeTarget(root, archivePath) {
  if (!archivePath || archivePath.startsWith("/") || /^[A-Za-z]:/.test(archivePath)) {
    throw new Error(`Release 包含无效路径：${archivePath}`);
  }
  const target = path.resolve(root, ...archivePath.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Release 包含越界路径：${archivePath}`);
  return target;
}
