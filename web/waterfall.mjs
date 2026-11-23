import {waterfall,phaseOrder} from './advanced.mjs';
const colors={blocked:'#6b7280',dns:'#8e4ba8',connect:'#227e91',send:'#9a6419',wait:'#496e29',receive:'#214e88'};
const ms=value=>value>=1000?`${(value/1000).toFixed(2)} s`:`${Math.round(value)} ms`;
const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
function svg(tag,attrs){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;}
export function drawWaterfall(rows,limit,inspect){
  const chart=waterfall(rows,limit),container=document.getElementById('waterfall-rows');container.replaceChildren();
  document.getElementById('waterfall-summary').textContent=`${chart.measured.toLocaleString()} requests have start and duration measurements; ${chart.unavailable.toLocaleString()} are unavailable. Recorded span ${ms(chart.span)}; peak overlapping measured requests ${chart.peak}. Showing the first ${chart.rows.length} in start order from the current filters.`;
  const axis=document.getElementById('waterfall-axis');axis.textContent=`0 ms ${'·'.repeat(8)} ${ms(chart.span/2)} ${'·'.repeat(8)} ${ms(chart.span)}`;
  for(const {row,segments,phaseMismatch}of chart.rows){
    const line=el('div','');line.className='waterfall-row';const label=el('button',`${row.method} ${row.host}`);label.type='button';label.addEventListener('click',()=>inspect(row));
    const graphic=svg('svg',{viewBox:'0 0 640 32',role:'img','aria-label':`Starts ${ms(row.start)}, lasts ${ms(row.duration)}${phaseMismatch?'; recorded phase sum differs from total':''}`});
    const scale=chart.span>0?640/chart.span:1,x=row.start*scale,width=Math.max(.8,row.duration*scale);
    graphic.append(svg('rect',{x,y:8,width,height:16,fill:'#d7dfd9',stroke:'#627369'}));
    for(const segment of segments){const drawn=Math.max(0,Math.min(segment.duration,row.duration-segment.start));if(!drawn)continue;const rect=svg('rect',{x:x+segment.start*scale,y:9,width:Math.max(.4,drawn*scale),height:14,fill:colors[segment.key]});const title=svg('title',{});title.textContent=`${segment.key}: ${ms(segment.duration)}`;rect.append(title);graphic.append(rect);}
    const timing=el('span',`${ms(row.start)} / ${ms(row.duration)}${phaseMismatch?' *':''}`);timing.className='meta';line.append(label,graphic,timing);container.append(line);
  }
  if(!chart.rows.length)container.append(el('p','No start-and-duration pairs are available for these filters.'));
  const legend=document.getElementById('waterfall-legend');legend.replaceChildren(...phaseOrder.map(key=>{const item=el('span',key);item.className=`phase-${key}`;return item;}));
}
