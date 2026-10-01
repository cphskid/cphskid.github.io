// Tiny Swords 小兵：城堡島上巡邏的戰士與射箭的弓箭手、村莊島上跑來跑去的村民。
// 這些圖的授權禁止散布，所以不在公開 repo 裡：發佈時從私有素材 repo 拉進 img/ts/
// （見 tools/private-assets.sh）。沒有圖的時候（例如自己電腦上跑）就不放小兵。

const TS = 'img/ts/';
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;

let available;
export function unitsAvailable() {
  available ??= new Promise((ok) => {
    const probe = new Image();
    probe.onload = () => ok(true);
    probe.onerror = () => ok(false);
    probe.src = TS + 'pawn_run.png';
  });
  return available;
}

function sprite(sheet, frames, size, dur) {
  const d = document.createElement('div');
  d.className = 'sprite';
  d.style.cssText = `width:${size}px;height:${size}px;background-image:url(${TS}${sheet});background-size:${frames * size}px ${size}px;--w:${frames * size}px;--n:${frames};animation-duration:${dur}ms`;
  return d;
}

function place(lift, cls, x, y, extra = '') {
  const u = document.createElement('div');
  u.className = 'unit ' + cls;
  u.style.cssText = `left:${x}%;top:${y}%;${extra}`;
  lift.appendChild(u);
  return u;
}

const svgTarget = `<svg viewBox="0 0 26 36"><ellipse cx="13" cy="34" rx="8" ry="2" fill="rgba(0,0,0,.2)"/><rect x="11.5" y="16" width="3" height="18" fill="#8a5429"/><circle cx="13" cy="13" r="11" fill="#f6e3b0" stroke="#7a4a22" stroke-width="2"/><circle cx="13" cy="13" r="7" fill="#e2553f"/><circle cx="13" cy="13" r="3.2" fill="#f6e3b0"/></svg>`;

const KINDS = {
  castle(lift) {
    place(lift, 'walker', 4, 62, '--dist:95px;--t:8s').appendChild(sprite('warrior_blue_run.png', 6, 68, 600));
    place(lift, 'walker', 64, 58, '--dist:70px;--t:7s;--delay:-3s').appendChild(sprite('warrior_red_run.png', 6, 68, 600));
    place(lift, 'archer', 12, 64).appendChild(sprite('archer_shoot.png', 8, 68, 1200));
    const target = document.createElement('div');
    target.className = 'target';
    target.style.cssText = 'left:40%;top:72%';
    target.innerHTML = svgTarget;
    lift.appendChild(target);
    if (reduceMotion) return;
    // 箭跟著弓箭手的動畫節奏射出，畫一條拋物線打中箭靶
    setTimeout(() => setInterval(() => {
      if (!lift.offsetParent) return;
      const a = document.createElement('img');
      a.src = TS + 'arrow.png'; a.className = 'arrow'; a.alt = '';
      lift.appendChild(a);
      const W = lift.clientWidth, H = lift.clientHeight;
      const x0 = W * .12 + 40, y0 = H * .64 + 30, x1 = W * .40 + 2, y1 = H * .72 + 6;
      const kf = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * 30;
        const dy = (y1 - y0) - Math.cos(Math.PI * t) * 30 * Math.PI;
        kf.push({ transform: `translate(${x}px,${y}px) rotate(${Math.atan2(dy, x1 - x0) * 180 / Math.PI}deg)` });
      }
      a.animate(kf, { duration: 520, easing: 'linear', fill: 'forwards' }).onfinish = () => {
        a.remove();
        target.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(9deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 380 });
      };
    }, 1200), 780);
  },
  village(lift) {
    place(lift, 'walker', 40, 56, '--dist:90px;--t:9s').appendChild(sprite('pawn_run.png', 6, 60, 600));
    place(lift, 'walker', 22, 48, '--dist:-60px;--t:7.5s;--delay:-4s').appendChild(sprite('pawn_run.png', 6, 60, 600));
  },
};

export async function addUnits(lift, kind) {
  if (!kind || !KINDS[kind] || !(await unitsAvailable())) return;
  KINDS[kind](lift);
}
