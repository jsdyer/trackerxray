import {loadConfig} from './settings.mjs';
const $=id=>document.getElementById('privacy-'+id);
let file=null,worker=null,result=null;
let config;
try{config=await loadConfig();}catch(error){$('status').textContent=error.message;}
function clearResult(){result=null;$('download').disabled=true;$('report').replaceChildren();}
function stop(){worker?.terminate();worker=null;$('run').disabled=!file;}
function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node;}
function invalidate(){stop();clearResult();$('status').textContent=file?'Options changed. Build a new copy to review its redaction report.':'Choose a HAR to make a separate sanitized copy.';}
$('file').addEventListener('change',event=>{file=event.target.files[0]||null;invalidate();});
for(const id of ['paths','dates'])$(id).addEventListener('change',invalidate);
$('clear').addEventListener('click',()=>{file=null;$('file').value='';invalidate();});
$('run').addEventListener('click',()=>{
  if(!file||!config)return;
  stop();clearResult();
  if(file.size>config.maxFileMegabytes*1024*1024){$('status').textContent=`The configured limit is ${config.maxFileMegabytes} MB.`;return;}
  $('run').disabled=true;$('status').textContent='Building a reduced copy locally…';
  const task=new Worker('./worker.mjs',{type:'module'});worker=task;
  task.addEventListener('message',({data})=>{
    if(worker!==task)return;stop();
    if(data.error){$('status').textContent=data.error;return;}
    result=data.result;const report=result.report;
    $('status').textContent=`Sanitized copy ready: ${report.counts.entries.toLocaleString()} requests; ${report.counts.skipped.toLocaleString()} unsupported entries omitted. The original file is unchanged.`;
    const dl=document.createElement('dl');dl.className='privacy-counts';
    const labels={headerValues:'Header values replaced',cookieValues:'Cookie values replaced',queryValues:'Query values replaced',formValues:'Form values replaced',requestBodies:'Request bodies removed',responseBodies:'Response bodies removed',paths:'URL paths replaced',timestamps:'Dates shifted'};
    for(const [key,label] of Object.entries(labels))dl.append(text('dt',label),text('dd',String(report.counts[key])));
    const removed=document.createElement('ul');for(const item of report.removed)removed.append(text('li',item));
    const kept=document.createElement('ul');for(const item of report.retained)kept.append(text('li',item));
    $('report').append(dl,text('h3','Removed or replaced'),removed,text('h3','Still in the copy'),kept,text('p',report.limitations));
    $('download').disabled=false;
  });
  task.addEventListener('error',()=>{if(worker!==task)return;stop();$('status').textContent='The local reader stopped. Try a smaller HAR.';});
  task.postMessage({file,sanitize:true,options:{keepPaths:$('paths').checked,keepDates:$('dates').checked}});
});
$('download').addEventListener('click',()=>{
  if(!result)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(result.har,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='trackerxray-sanitized.har';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
