import {workspaceIdentity} from './workspace-config.mjs';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  }
  if (attrs.value !== undefined && ['SELECT', 'TEXTAREA'].includes(node.tagName)) node.value = attrs.value;
  return node;
}
export const t = (state, zh, en) => state.language === 'en' ? en : zh;
export const field = (label, input) => el('label', { class: 'field-label' }, el('span', { text: label }), input);
export const button = (text, onclick, className = 'button', attrs = {}) => el('button', { type: 'button', class: className, onclick, ...attrs }, text);
export function icon(name, size = 18) {
  const paths = {
    plus: 'M12 5v14M5 12h14', minus:'M5 12h14', clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M8 8h.01',
    tasks: 'M9 6h11M9 12h11M9 18h11M3 5l1 1 2-2M3 11l1 1 2-2M3 17l1 1 2-2',
    settings: 'M12.00 3.00 L13.76 3.17 L14.68 5.53 L15.89 6.18 L18.36 5.64 L19.48 7.00 L18.47 9.32 L18.87 10.63 L21.00 12.00 L20.83 13.76 L18.47 14.68 L17.82 15.89 L18.36 18.36 L17.00 19.48 L14.68 18.47 L13.37 18.87 L12.00 21.00 L10.24 20.83 L9.32 18.47 L8.11 17.82 L5.64 18.36 L4.52 17.00 L5.53 14.68 L5.13 13.37 L3.00 12.00 L3.17 10.24 L5.53 9.32 L6.18 8.11 L5.64 5.64 L7.00 4.52 L9.32 5.53 L10.63 5.13 Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    shield: 'M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6zM9 12l2 2 4-4',
    arrow: 'M6 18 18 6M6 6h12v12', menu: 'M4 6h16M4 12h16M4 18h16',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5', close: 'm6 6 12 12M18 6 6 18',
    down: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', sliders: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    chevron: 'm8 5 7 7-7 7', check: 'm5 12 4 4L19 6', moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k,v] of Object.entries({ viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true' })) svg.setAttribute(k,v);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d',paths[name] || paths.plus); svg.append(path); return svg;
}
export function brand() {
  return el('div', { class: 'brand' }, el('span', { class:'brand-mark','aria-hidden':'true' },
    el('span',{class:'orbit orbit-a'}),el('span',{class:'orbit orbit-b'}),el('span',{class:'orbit-dot'})),
    el('div',{},el('strong',{text:workspaceIdentity.name}),el('small',{text:workspaceIdentity.subtitle})));
}
export const localDate = value => {
  const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export const dateTime = (state, value) => value ? new Date(value).toLocaleString(state.language === 'en' ? 'en-US' : 'zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
