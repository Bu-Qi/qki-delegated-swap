/* Windows startup supervisor. Uses built-ins so missing dependencies can be diagnosed. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');

function validateNode(version = process.versions.node) {
  if (Number(version.split('.')[0]) < 20) {
    throw new Error(`需要 Node.js 20 或更新版本，当前为 ${version}。下载：https://nodejs.org/`);
  }
}

function checkFiles(root) {
  const required = ['server.mjs', 'package.json', 'package-lock.json', 'probe.json',
    'lib/engine.mjs', 'public/index.html', 'public/app.mjs', 'public/style.css'];
  const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    throw new Error(`程序文件不完整：${missing.join(', ')}。请完整解压 ZIP，不要直接在压缩包中双击启动文件。`);
  }
}

function findNpmCli(execPath = process.execPath, extra = []) {
  const dir = path.dirname(execPath);
  const candidates = [path.join(dir, 'node_modules/npm/bin/npm-cli.js'),
    path.join(dir, '../lib/node_modules/npm/bin/npm-cli.js'), process.env.npm_execpath, ...extra].filter(Boolean);
  try {
    const paths = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which',
      [process.platform === 'win32' ? 'npm.cmd' : 'npm'], {encoding: 'utf8', windowsHide: true}).trim().split(/\r?\n/);
    for (const npm of paths) {
      candidates.push(path.join(path.dirname(npm), 'node_modules/npm/bin/npm-cli.js'));
      try { candidates.push(fs.realpathSync(npm)); } catch {}
    }
  } catch {}
  const found = candidates.find(file => path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  if (!found) throw new Error('找不到 npm。请安装包含 npm 的完整 Node.js，然后重新打开启动程序。');
  return found;
}

function command(file, args, {cwd, record, write, errorWrite}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {cwd, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true});
    child.stdout.on('data', chunk => { record(chunk); write(chunk); });
    child.stderr.on('data', chunk => { record(chunk); errorWrite(chunk); });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({code: code ?? 1, signal}));
  });
}

async function runLauncher(options = {}) {
  const root = options.root || __dirname;
  const logDirectory = options.logDirectory || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'QKIArbitrageScanner');
  const write = options.write || (chunk => process.stdout.write(chunk));
  const errorWrite = options.errorWrite || (chunk => process.stderr.write(chunk));
  fs.mkdirSync(logDirectory, {recursive: true});
  const logFile = path.join(logDirectory, 'startup.log');
  fs.writeFileSync(logFile, `[${new Date().toISOString()}] QKI scanner startup\n`, 'utf8');
  const record = chunk => fs.appendFileSync(logFile, chunk);
  const line = text => { const value = String(text) + '\n'; record(value); write(value); };
  try {
    line('启动日志：' + logFile);
    line('Node.js：' + process.version + ' / ' + process.execPath);
    line('程序目录：' + root);
    validateNode();
    checkFiles(root);
    const io = {cwd: root, record, write, errorWrite};
    line('检查运行依赖……');
    let dependencies = await command(process.execPath,
      ['--input-type=module', '-e', 'import("ethers").catch(e => { console.error(e.message); process.exitCode=1; })'], io);
    if (dependencies.code !== 0) {
      line('运行依赖缺失或不完整，正在重新安装……');
      const installed = await command(process.execPath,
        [findNpmCli(), 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], io);
      if (installed.code !== 0) throw new Error('依赖安装失败，请查看上方 npm 错误；完整记录已写入启动日志。');
      dependencies = await command(process.execPath,
        ['--input-type=module', '-e', 'import("ethers").catch(e => { console.error(e.message); process.exitCode=1; })'], io);
      if (dependencies.code !== 0) throw new Error('依赖安装后仍无法加载，请保留启动日志。');
    }
    const dataDir = path.join(logDirectory, 'data');
    const args = [path.join(root, 'server.mjs'), '--data-dir', dataDir];
    if (options.noOpen) args.push('--no-open');
    if (options.port) args.push('--port', String(options.port));
    line('正在启动本地界面，默认地址：http://127.0.0.1:3847');
    const result = await command(process.execPath, args, io);
    if (result.code !== 0) throw new Error(`程序启动失败或异常退出，退出码 ${result.code}${result.signal ? ' / ' + result.signal : ''}。`);
    line('程序已关闭。');
    return {logFile, code: 0};
  } catch (e) {
    line('\n启动失败：' + e.message);
    record((e.stack || String(e)) + '\n');
    line('请保留本窗口，或发送 startup.log 末尾的错误信息。');
    line('日志位置：' + logFile);
    throw Object.assign(e, {logFile});
  }
}

module.exports = {validateNode, checkFiles, findNpmCli, command, runLauncher};
if (require.main === module) {
  runLauncher({noOpen: process.argv.includes('--no-open')}).catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
