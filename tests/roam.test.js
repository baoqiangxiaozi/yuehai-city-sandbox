/* Confirms first-person roam is gone. No controller, button, HUD or shortcut copy. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('ok', name); }

const banned = [
  '进入第一人称', '自由漫游', 'YuehaiRoam', 'id="enterRoam"', 'id="roamHud"',
  'id="roamPad"', 'data-roam-dir', 'WASD', 'yuehai.roam.js', '/*__ROAM__*/'
];

check('roam controller file is not part of the source', () => {
  if (fs.existsSync(path.join(root, 'src', 'yuehai.roam.js'))) throw new Error('src/yuehai.roam.js still exists');
});

check('shell, styles, app and build have no roam entry', () => {
  const files = ['src/yuehai.shell.html', 'src/yuehai.css', 'src/yuehai.js', 'scripts/build_page.py'];
  for (const rel of files) {
    const text = read(rel);
    for (const token of banned) {
      if (text.includes(token)) throw new Error(rel + ' still contains ' + token);
    }
  }
});

check('built page, when present, has no roam entry', () => {
  const page = path.join(root, 'index.html');
  if (!fs.existsSync(page)) return;
  const text = read('index.html');
  for (const token of banned) {
    if (text.includes(token)) throw new Error('index.html still contains ' + token);
  }
  if (!text.includes('id="resetCamera"')) throw new Error('orbit reset control missing');
  if (!text.includes('data-camera="orbit"')) throw new Error('orbit camera control missing');
});

console.log(checks + ' roam-removal checks passed');
