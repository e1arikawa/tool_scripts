import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as process from 'process';

// 非同期ファイル処理のためのユーティリティ
const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const appendFile = util.promisify(fs.appendFile);

// 対象ファイルかどうかを判定する関数（拡張子を使用）
function isTargetFile(filePath: string, targetExtensions: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return targetExtensions.includes(ext);
}

function readGitignore(targetDir: string): string[] {
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    return gitignoreContent.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.startsWith('/') ? line.substring(1) : line);
  }
  return [];
}

function shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some(pattern => {
    if (filePath === pattern || filePath.startsWith(pattern)) {
      return true;
    }
    try {
      const regex = new RegExp(pattern);
      return regex.test(filePath);
    } catch (e) {
      //console.error(`Invalid regex pattern: ${pattern}`);
      return false;
    }
  });
}

async function listFiles(dir: string, baseDir: string, ignorePatterns: string[]): Promise<string[]> {
  let results: string[] = [];
  const list = await readdir(dir);
  for (const file of list) {
    if (file.startsWith('.')) {
      continue; // Skip dot files
    }
    const filePath = path.join(dir, file);
    const relativePath = path.relative(baseDir, filePath);
    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      results = results.concat(await listFiles(filePath, baseDir, ignorePatterns));
    } else {
      results.push(relativePath);
    }
  }
  return results;
}

async function generateTree(dir: string, depth: number, baseDir: string, ignorePatterns: string[]): Promise<string> {
  let tree = '';
  const list = await readdir(dir);
  for (const file of list) {
    if (file.startsWith('.')) {
      continue; // Skip dot files
    }
    const filePath = path.join(dir, file);
    const relativePath = path.relative(baseDir, filePath);
    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }
    const fileStat = await stat(filePath);
    tree += `${'  '.repeat(depth)}- ${file}\n`;
    if (fileStat.isDirectory()) {
      tree += await generateTree(filePath, depth + 1, baseDir, ignorePatterns);
    }
  }
  return tree;
}

async function main() {
  const args = process.argv.slice(2);
  let targetDir = '';
  let outputFile = '';
  const targetExtensions: string[] = [];
  const excludePatterns: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--target':
        if (i + 1 < args.length) {
          targetDir = args[++i];
        }
        break;
      case '--output':
        if (i + 1 < args.length) {
          outputFile = args[++i];
        }
        break;
      case '--ext':
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          targetExtensions.push(`.${args[++i].toLowerCase()}`);
        }
        break;
      case '--exclude':
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          excludePatterns.push(args[++i]);
        }
        break;
    }
  }

  if (!targetDir || !outputFile) {
    console.error('Usage: ts-node dumpSourceCode.ts --target <directory> --output <outputFile> [--ext <extension> ...] [--exclude <pattern> ...]');
    process.exit(1);
  }

  const gitignorePatterns = readGitignore(targetDir);
  const ignorePatterns = gitignorePatterns.concat(excludePatterns);

  await writeFile(outputFile, '');

  await appendFile(outputFile, '## Find Output\n');
  const allFiles = await listFiles(targetDir, targetDir, ignorePatterns);
  for (const file of allFiles) {
    await appendFile(outputFile, `${file}\n`);
  }

  await appendFile(outputFile, '\n## Directory Tree\n');
  const treeStructure = await generateTree(targetDir, 0, targetDir, ignorePatterns);
  await appendFile(outputFile, treeStructure);

  await appendFile(outputFile, '\n## Source Code\n');

  for (const file of allFiles) {
    const filePath = path.join(targetDir, file);
    if (!isTargetFile(filePath, targetExtensions)) {
      console.log(`Ignored (not target extension): ${file}`);
      continue;
    }

    await appendFile(outputFile, `\`\`\`file:${file}\n`);
    const fileContent = await readFile(filePath, 'utf-8');
    await appendFile(outputFile, `${fileContent}\n\`\`\`\n\n`);
    console.log(`Processed: ${file}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
