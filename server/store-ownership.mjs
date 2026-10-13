import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A separate SQLite lock survives for this store's lifetime, not each save.
 * The OS releases it even after a crash; the workspace DB is never opened by
 * a competing process, so startup recovery cannot overwrite active work.
 */
export function acquireStoreOwnership(filename) {
  if (filename === ":memory:") return () => {};
  const absolute = resolve(filename);
  mkdirSync(dirname(absolute), { recursive: true });
  const canonical = existsSync(absolute)
    ? realpathSync(absolute)
    : join(realpathSync(dirname(absolute)), basename(absolute));
  const lock = new DatabaseSync(`${canonical}.owner`);
  try {
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  } catch (cause) {
    lock.close();
    throw new Error("工作台数据库已被另一个实例占用，请先关闭该实例。", { cause });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.close();
  };
}
