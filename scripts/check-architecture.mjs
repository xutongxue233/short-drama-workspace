import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = (file) => relative(root, file).replaceAll("\\", "/");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(file);
    return sourceExtensions.has(extname(file)) && !/\.test\./.test(file) ? [file] : [];
  });
}
function localTarget(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  return [
    base,
    ...[".ts", ".tsx", ".mjs", ".js"].map((extension) => base + extension),
    ...["index.ts", "index.tsx", "index.mjs", "index.js"].map((index) =>
      resolve(base, index),
    ),
  ].find((file) => existsSync(file) && extname(file));
}
function boundaryViolation(from, to) {
  if (from.startsWith("src/") && to.startsWith("server/"))
    return "浏览器代码不能导入服务端模块";
  if (from.startsWith("server/") && to.startsWith("src/"))
    return "服务端不能依赖界面模块";
  if (from.startsWith("src/ui/") && !to.startsWith("src/ui/"))
    return "UI 基础库不能依赖业务模块";
  if (
    from.startsWith("src/shared/") &&
    !to.startsWith("src/shared/") &&
    to !== "src/types.ts"
  )
    return "共享契约不能反向依赖界面或业务实现";
  if (
    from.startsWith("src/components/") &&
    (to.startsWith("src/features/") || to.startsWith("src/app/"))
  )
    return "共享展示组件不能依赖应用或业务页面";
  if (
    from.startsWith("src/features/") &&
    (to.startsWith("src/app/") ||
      ["src/App.tsx", "src/SettingsViews.tsx", "src/providerPresets.ts"].includes(to))
  )
    return "业务模块不能反向依赖应用入口或兼容入口";
  if (
    from.startsWith("server/providers/") &&
    (to.startsWith("server/routes/") ||
      ["server/app.mjs", "server/index.mjs", "server/workflow.mjs"].includes(to))
  )
    return "模型适配器不能依赖 HTTP 路由或工作流协调器";
  return null;
}

const files = [...sources(resolve(root, "src")), ...sources(resolve(root, "server"))];
const graph = new Map(files.map((file) => [file, new Set()]));
const problems = [];
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const checkImport = (specifier) => {
    if (!specifier.startsWith(".")) return;
    const target = localTarget(file, specifier);
    if (!target) {
      problems.push(`${name(file)} → ${specifier}: 导入路径不存在`);
      return;
    }
    const violation = boundaryViolation(name(file), name(target));
    if (violation) problems.push(`${name(file)} → ${name(target)}: ${violation}`);
    if (graph.has(target)) graph.get(file).add(target);
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkImport(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const visited = new Set();
const active = new Set();
const chain = [];
function visit(file) {
  if (active.has(file)) {
    problems.push(
      `循环依赖: ${[...chain.slice(chain.indexOf(file)), file].map(name).join(" → ")}`,
    );
    return;
  }
  if (visited.has(file)) return;
  visited.add(file);
  active.add(file);
  chain.push(file);
  for (const target of graph.get(file)) visit(target);
  chain.pop();
  active.delete(file);
}
for (const file of files) visit(file);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Architecture OK: ${files.length} modules, no dependency cycles or boundary violations.`,
  );
