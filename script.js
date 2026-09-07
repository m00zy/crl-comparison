'use strict';
/* THE THROUGH LINE
 * No libraries, requests, assets or build step required.
 * Model is independent of the DOM. Renderer and interaction layer follow below.
 * All numeric operating parameters are illustrative assumptions (see About).
 */
const STATIONS = [
  {id:'swanson',name:'Swanson',x:77,y:363,rate:10,region:'west',dx:-4,dy:-22},
  {id:'henderson',name:'Henderson',x:175,y:363,rate:15,region:'west',dx:0,dy:29},
  {id:'newlynn',name:'New Lynn',x:282,y:363,rate:19,region:'west',dx:0,dy:-22},
  {id:'kingsland',name:'Kingsland',x:360,y:415,rate:9,region:'west',dx:-10,dy:31},
  {id:'maungawhau',name:'Maungawhau',x:458,y:415,rate:9,region:'west',dx:-7,dy:35},
  {id:'grafton',name:'Grafton',x:559,y:415,rate:8,region:'south',dx:0,dy:30},
  {id:'newmarket',name:'Newmarket',x:654,y:415,rate:15,region:'south',dx:22,dy:4,anchor:'start'},
  {id:'parnell',name:'Parnell',x:708,y:297,rate:6,region:'south',dx:20,dy:6,anchor:'start'},
  {id:'britomart',name:'Waitematā',x:657,y:143,rate:16,region:'city',dx:21,dy:-18,anchor:'start'},
  {id:'waihorotiu',name:'Te Waihorotiu',x:551,y:223,rate:14,region:'city',dx:-20,dy:0,anchor:'end',crl:true},
  {id:'karanga',name:'Karanga-a-Hape',x:458,y:316,rate:11,region:'city',dx:-24,dy:4,anchor:'end',crl:true},
  {id:'orakei',name:'Ōrākei',x:803,y:221,rate:5,region:'east',dx:19,dy:-14,anchor:'start'},
  {id:'panmure',name:'Panmure',x:868,y:350,rate:15,region:'east',dx:20,dy:4,anchor:'start'},
  {id:'manukau',name:'Manukau',x:868,y:479,rate:15,region:'east',dx:18,dy:5,anchor:'start'},
  {id:'ellerslie',name:'Ellerslie',x:694,y:473,rate:8,region:'south',dx:-20,dy:4,anchor:'end'},
  {id:'otahuhu',name:'Ōtāhuhu',x:754,y:528,rate:12,region:'south',dx:-20,dy:5,anchor:'end'},
  {id:'papakura',name:'Papakura',x:817,y:585,rate:17,region:'south',dx:20,dy:5,anchor:'start'}
];
const BY_ID = Object.fromEntries(STATIONS.map(s=>[s.id,s]));
const COLORS = {west:'#b5a0eb',east:'#74b9de',south:'#e8be77',crl:'#74d5b4'};
const DEFAULTS = {demand:1,destinations:'city',tph:24,capacity:650,dwell:35,headway:90,turnaround:240,exchange:22,delays:5,rates:Object.fromEntries(STATIONS.map(s=>[s.id,s.rate]))};
const cloneSettings = p=>({...p,rates:{...p.rates}});
const sum = (items,fn=x=>x)=>items.reduce((n,x)=>n+fn(x),0);
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const fmt = n=>Math.round(n).toLocaleString('en-NZ');
const edgeKey = (a,b)=>[a,b].sort().join('|');
const STAGES = [
 {label:'Old network',through:false,link:false,stations:false,frequency:1,length:1,junction:55,explain:'Trains reverse at Waitematā and cross the same shared throat on the way out.'},
 {label:'Britomart becomes through-running',through:true,link:false,stations:false,frequency:1,length:1,junction:55,explain:'A counterfactual exit beyond Britomart removes reversal and the shared arrival/departure conflict. It isolates the value of through-running.'},
 {label:'CRL connection added',through:true,link:true,stations:false,frequency:1,length:1,junction:55,explain:'The west gets a direct path into the city. West–east trains no longer detour via Newmarket.'},
 {label:'New stations added',through:true,link:true,stations:true,frequency:1,length:1,junction:55,explain:'City demand spreads across three stops. More access points also mean more dwell time: this step need not increase throughput.'},
 {label:'Higher service frequency',through:true,link:true,stations:true,frequency:1.5,length:1,junction:55,explain:'Request 50% more services, using the room created by the new connection.'},
 {label:'Longer trains',through:true,link:true,stations:true,frequency:1.5,length:900/650,junction:55,explain:'Increase capacity per train by 38%. This is a future-capacity scenario, not an opening-day train length.'},
 {label:'Full CRL configuration',through:true,link:true,stations:true,frequency:1.5,length:900/650,junction:40,explain:'Shorter synthetic junction clearance (55 → 40 seconds) completes the scenario. The next limit is elsewhere in the network.'}
];
function makeRoutes(cfg){
 const west=['swanson','henderson','newlynn','kingsland','maungawhau'];
 const south=['papakura','otahuhu','ellerslie','newmarket'];
 const east=['manukau','panmure','orakei','britomart'];
 if(!cfg.link) return [
  {name:'Western',color:COLORS.west,path:[...west,'grafton','newmarket','parnell','britomart'],weight:1/3},
  {name:'Southern',color:COLORS.south,path:[...south,'parnell','britomart'],weight:1/3},
  {name:'Eastern',color:COLORS.east,path:east,weight:1/3}
 ];
 const crl=cfg.stations?['karanga','waihorotiu']:[];
 return [
  {name:'East West',color:COLORS.west,path:[...west,...crl,'britomart','orakei','panmure','manukau'],weight:.55},
  {name:'South City',color:COLORS.south,path:[...south,'parnell','britomart',...(cfg.stations?['waihorotiu','karanga']:[]),'grafton','newmarket'],weight:.45}
 ];
}
class RailSimulation {
 constructor(kind,settings,options={}){
  this.kind=kind;this.settings=settings;
  this.config=options.stage?{...options.stage}:kind==='old'?{...STAGES[0]}:{...STAGES[6],length:1};
  this.time=0;this.seed=options.seed??2026;this.trains=[];this.nextId=1;this.events=[];this.release={};this.dispatchIndex=0;this.nextDispatch=0;this.nextArrivals=0;this.generated=0;this.completed=0;this.waitReasons={};this.edgeActivity={};this.surges={};
  this.routes=makeRoutes(this.config);
  this.activeIds=[...new Set(this.routes.flatMap(r=>r.path))];
  this.stations=Object.fromEntries(this.activeIds.map(id=>[id,{id,queue:[],entered:0,boarded:0}]));
  this.neighbours=Object.fromEntries(this.activeIds.map(id=>[id,[]]));
  this.routes.forEach(r=>r.path.slice(1).forEach((id,i)=>{const prev=r.path[i];if(!this.neighbours[id].includes(prev)){this.neighbours[id].push(prev);this.neighbours[prev].push(id);}}));
  this.dist={};
  for(const target of this.activeIds){const d={[target]:0},q=[target];for(let i=0;i<q.length;i++)for(const n of this.neighbours[q[i]])if(d[n]===undefined){d[n]=d[q[i]]+1;q.push(n);}this.dist[target]=d;}
 }
 random(){this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296;}
 capacity(){return Math.round(this.settings.capacity*this.config.length);}
 tph(){return this.settings.tph*this.config.frequency;}
 people(t){return sum(t.load,g=>g.n);}
 queue(id){return sum(this.stations[id]?.queue||[],g=>g.n);}
 addEvent(type,n=1){this.events.push({time:this.time,type,n});}
 addGroup(id,n,dest,born=this.time,missed=false){if(n<.001||id===dest)return;this.stations[id].queue.push({n,dest,born,missed});}
 destination(origin){
  const p=this.settings, candidates=this.activeIds.filter(id=>id!==origin);
  const weights=candidates.map(id=>{const s=BY_ID[id];let w=1;if(p.destinations==='city')w=s.region==='city'?30/this.activeIds.filter(k=>BY_ID[k].region==='city').length:1;if(p.destinations==='outbound')w=s.region==='city'?.35:2;return w;});
  let v=this.random()*sum(weights);for(let i=0;i<candidates.length;i++){v-=weights[i];if(v<=0)return candidates[i];}return candidates.at(-1);
 }
 arrivals(){
  const amounts={};for(const s of STATIONS){const id=this.stations[s.id]?s.id:'britomart';amounts[id]=(amounts[id]||0)+this.settings.rates[s.id]*this.settings.demand/3;}
  for(const [id,base] of Object.entries(amounts)){
   let count=base*(.85+this.random()*.3);if(this.surges[id]>this.time)count*=4;
   this.generated+=count;this.stations[id].entered+=count;
   for(let k=0;k<3;k++)this.addGroup(id,count/3,this.destination(id));
  }
 }
 spawn(){
  const x=(this.dispatchIndex*.61803398875)%1;let w=0;let route=this.routes.at(-1);for(const r of this.routes){w+=r.weight;if(x<w){route=r;break;}}
  let path=[...route.path];
  if(!this.config.through)path=[...path,...path.slice(0,-1).reverse()];
  else if(this.config.link){
   if(this.dispatchIndex%2)path.reverse();
   path=[...path,...path.slice(0,-1).reverse()];
  }
  else if(!this.config.link){ // Counterfactual return via an unconstrained off-map continuation.
   path=[...path,...path.slice(0,-1).reverse()];
  }
  const train={id:this.nextId++,name:route.name,color:route.color,path,index:0,progress:0,state:'pending',hold:0,load:[],reason:'',wait:0,boarded:0,alighted:0,terminalIndex:!this.config.through?route.path.length-1:-1};
  this.trains.push(train);this.dispatchIndex++;
 }
 platformKey(t,index=t.index){const id=t.path[index];if(id==='britomart'&&!this.config.through)return id;const next=t.path[index+1]||t.path[index-1];return id+':'+(BY_ID[next].x+BY_ID[next].y>BY_ID[id].x+BY_ID[id].y?'a':'b');}
 platformAvailable(t,index){const key=this.platformKey(t,index),limit=key==='britomart'?5:1;return this.trains.filter(o=>o!==t&&o.state==='dwell'&&this.platformKey(o)===key).length<limit;}
 enterStation(t){
  t.state='dwell';t.progress=0;t.wait=0;t.reason='';t.boarded=0;t.alighted=0;
  const id=t.path[t.index],next=t.path[t.index+1];
  const keep=[];for(const g of t.load){if(g.dest===id){this.completed+=g.n;this.addEvent('completed',g.n);t.alighted+=g.n;}else if(!next||this.dist[g.dest][next]>=this.dist[g.dest][id]){this.addGroup(id,g.n,g.dest,this.time,g.missed);t.alighted+=g.n;}else keep.push(g);}t.load=keep;
  if(id==='britomart'){this.addEvent('city');}
  t.hold=this.settings.dwell+t.alighted/this.settings.exchange+(t.index===t.terminalIndex?this.settings.turnaround:0);
  if(this.random()<this.settings.delays/100){t.hold+=30+this.random()*90;t.delay=true;}else t.delay=false;
 }
 eligible(g,t){const id=t.path[t.index],next=t.path[t.index+1];return next&&this.dist[g.dest][next]<this.dist[g.dest][id];}
 board(t,dt){
  let room=Math.max(0,this.capacity()-this.people(t)),budget=Math.min(room,this.settings.exchange*dt);if(budget<=0)return;
  const station=this.stations[t.path[t.index]];
  for(const g of station.queue){if(g.n<.001||!this.eligible(g,t))continue;const n=Math.min(g.n,budget);t.load.push({...g,n});g.n-=n;budget-=n;station.boarded+=n;t.boarded+=n;if(budget<.001)break;}
  station.queue=station.queue.filter(g=>g.n>.001);
  // Consolidate cohorts only once per stop; boarding remains FIFO and mass conserving.
 }
 depart(t){
  const id=t.path[t.index],next=t.path[t.index+1];
  if(!next){t.state='done';return;}
  const p=this.settings,key=id+'>'+next, resources=[{key,seconds:p.headway,reason:'Minimum headway'}];
  if(!this.config.through&&(id==='britomart'||next==='britomart'))resources.push({key:'terminalThroat',seconds:p.headway,reason:'Britomart throat'});
  if(['newmarket','maungawhau'].includes(id))resources.push({key:'junction:'+id,seconds:this.config.junction,reason:BY_ID[id].name+' junction'});
  const blocked=resources.find(r=>(this.release[r.key]||0)>this.time);
  if(blocked){t.reason=blocked.reason;return;}
  const leader=this.trains.find(o=>o!==t&&o.state==='moving'&&o.path[o.index]===id&&o.path[o.index+1]===next&&o.progress<.16);
  if(leader){t.reason='Train ahead';return;}
  for(const r of resources)this.release[r.key]=this.time+r.seconds;
  if(this.people(t)>=this.capacity()-.1){for(const g of this.stations[id].queue){if(!g.missed&&this.eligible(g,t)){g.missed=true;this.addEvent('left',g.n);}}}
  // Merge each destination's onboard groups for bounded per-frame work.
  const compact={};for(const g of t.load){const k=g.dest+'|'+g.missed;const prev=compact[k];if(prev){prev.born=(prev.born*prev.n+g.born*g.n)/(prev.n+g.n);prev.n+=g.n;}else compact[k]={...g};}t.load=Object.values(compact);
  t.state='moving';t.progress=0;t.reason='';t.wait=0;
  const e=edgeKey(id,next);this.edgeActivity[e]=(this.edgeActivity[e]||0)+1;
 }
 tick(dt=1){
  this.time+=dt;
  if(this.time>=this.nextArrivals){this.arrivals();this.nextArrivals=this.time+20;}
  if(this.time>=this.nextDispatch){this.spawn();this.nextDispatch=this.time+3600/this.tph();}
  for(const t of this.trains){
   if(t.state==='pending'){if(this.platformAvailable(t,0))this.enterStation(t);else t.reason='Origin platform occupied';}
   else if(t.state==='dwell'){
    this.board(t,dt);t.hold-=dt;
    if(t.hold<=0)this.depart(t);
    else if(t.index===t.terminalIndex)t.reason='Terminal turnaround';
    else if(t.delay)t.reason='Disruption hold';
    else t.reason='Boarding & dwell';
   }else if(t.state==='moving'){
    const a=t.path[t.index],b=t.path[t.index+1],distance=Math.hypot(BY_ID[a].x-BY_ID[b].x,BY_ID[a].y-BY_ID[b].y),duration=clamp(distance*.6,60,110);
    let max=1;
    for(const other of this.trains)if(other!==t&&other.state==='moving'&&other.path[other.index]===a&&other.path[other.index+1]===b&&other.progress>t.progress)max=Math.min(max,other.progress-.15);
    if(!this.platformAvailable(t,t.index+1))max=Math.min(max,.90);
    const progress=Math.max(t.progress,Math.min(t.progress+dt/duration,max));
    t.reason=progress===t.progress?(max<=.9?'Platform / train ahead':'Train ahead'):'';
    t.progress=progress;
    if(t.progress>=.999){t.index++;this.enterStation(t);}
   }
   if(t.reason&&!['Boarding & dwell','Terminal turnaround'].includes(t.reason)){t.wait+=dt;this.waitReasons[t.reason]=(this.waitReasons[t.reason]||0)+dt;}
  }
  this.trains=this.trains.filter(t=>t.state!=='done');
  if(Math.floor(this.time)%30===0){this.events=this.events.filter(e=>e.time>this.time-600);for(const k in this.waitReasons)this.waitReasons[k]*=.92;for(const k in this.edgeActivity)this.edgeActivity[k]*=.9;}
 }
 advance(seconds){for(let i=0;i<seconds;i++)this.tick(1);return this;}
 metrics(){
  const e=this.events.filter(e=>e.time>this.time-600),window=Math.min(600,this.time)||1;
  let queue=0,waitingTime=0,busiest='britomart',maxQ=-1;
  for(const s of Object.values(this.stations)){const n=this.queue(s.id);queue+=n;waitingTime+=sum(s.queue,g=>(this.time-g.born)*g.n);if(n>maxQ){maxQ=n;busiest=s.id;}}
  const blocked=this.trains.filter(t=>t.wait>15).length,arrivalRate=sum(Object.values(this.settings.rates))*this.settings.demand;
  const stress=clamp(Math.max(queue/Math.max(1,arrivalRate*8),blocked/Math.max(1,this.trains.length)*1.5),0,1);
  const reason=Object.entries(this.waitReasons).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const occupancy=sum(this.trains,t=>this.people(t))/Math.max(1,this.trains.length*this.capacity());
  let bottleneck=reason||'Service frequency';
  if(sum(e.filter(v=>v.type==='left'),v=>v.n)>100&&occupancy>.65)bottleneck='Train capacity';
  else if(maxQ>arrivalRate*2&&!blocked)bottleneck=this.settings.dwell>65?'Station dwell':'Service frequency';
  if(!this.config.through&&(this.waitReasons['Britomart throat']||0)>sum(Object.values(this.waitReasons))*.2)bottleneck='Britomart throat';
  return {throughput:sum(e.filter(v=>v.type==='completed'),v=>v.n)*3600/window,city:sum(e.filter(v=>v.type==='city'),v=>v.n)*3600/window,wait:queue?waitingTime/queue/60:0,left:sum(e.filter(v=>v.type==='left'),v=>v.n),occupancy,queue,busiest,stress,bottleneck,blocked,arrivalRate};
 }
}
// Expose just the pure model for repeatable command-line verification.
if(typeof module!=='undefined'&&module.exports)module.exports={RailSimulation,DEFAULTS,STAGES,STATIONS,cloneSettings};
if(typeof document!=='undefined'){
const $=id=>document.getElementById(id);
let settings=cloneSettings(DEFAULTS),mode='new',playing=true,speed=30,simulations={},renderers={},selected=null,experiment=null,experimentToken=0,lastUi=0,lastFrame=0,accumulator=0,frameTime=0;
const history={old:[],new:[]},displayValues={old:0,new:0};
const operations=[['tph','Trains requested / hour',6,60,1,'tph'],['capacity','People per train',200,1200,50,'people'],['dwell','Station dwell',10,120,5,'s'],['headway','Minimum headway',40,240,5,'s'],['turnaround','Terminal turnaround',60,600,15,'s'],['exchange','Boarding / alighting',4,50,1,'people/s']];
function rangeMarkup(id,label,min,max,step,value,unit){return `<div class="operation"><label class="range-label" for="${id}">${label}<output id="${id}Out">${value} ${unit}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;}
$('operationControls').innerHTML=operations.map(([id,label,min,max,step,unit])=>rangeMarkup(id,label,min,max,step,settings[id],unit)).join('');
$('stationControls').innerHTML=STATIONS.map(s=>rangeMarkup('rate-'+s.id,s.name,0,60,1,s.rate,'/min')).join('');
$('stressBars').innerHTML='<i></i>'.repeat(22);
const metricDefinitions=[['city','City trains / hour','Waitematā passages · both ways'],['wait','Average wait','people currently waiting'],['left','Passengers left behind','first missed train · last 10 min'],['occupancy','Train occupancy','across active trains'],['busiest','Busiest station','largest passenger queue'],['bottleneck','Current bottleneck','largest observed constraint']];
$('metricGrid').innerHTML=metricDefinitions.map(([id,label,note])=>`<div class="metric"><div class="metric-label">${label}<span aria-hidden="true">${id==='city'?'↗':id==='bottleneck'?'◇':'·'}</span></div><div id="metric-${id}" class="metric-value ${['busiest','bottleneck'].includes(id)?'text-value':''}">—</div><div class="metric-note">${note}</div></div>`).join('');
const svgNS='http://www.w3.org/2000/svg';
function svgElement(tag,attrs={},parent){const el=document.createElementNS(svgNS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(parent)parent.appendChild(el);return el;}
function pathBetween(a,b){return `M${a.x},${a.y} L${b.x},${b.y}`;}
const mapBackground=`<defs><pattern id="mapdots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#647f8e" opacity=".14"/></pattern></defs><rect width="1000" height="630" fill="url(#mapdots)"/><path class="water" d="M0 0H1000V190L955 204 918 189 891 213 852 177 807 186 778 160 740 158 710 129 670 121 659 92 615 92 588 102 570 82 541 104 494 94 475 123 440 120 414 148 388 143 351 177 308 180 280 204 246 192 210 167 155 182 114 162 70 178 0 160Z"/><path class="coast" d="M0 160L70 178 114 162 155 182 210 167 246 192 280 204 308 180 351 177 388 143 414 148 440 120 475 123 494 94 541 104 570 82 588 102 615 92 659 92 670 121 710 129 740 158 778 160 807 186 852 177 891 213 918 189 955 204 1000 190"/><text class="harbour-label" x="418" y="62">WAITEMATĀ HARBOUR</text><g class="street"><path d="M150 235L300 287 360 243 470 267 640 95M235 494L368 283 621 157M400 575L382 462 593 197M314 519L602 252 741 456M375 344L616 327 832 269M481 495L645 276 962 441M473 168L733 507M92 302L382 301 587 507M162 429L397 237 480 237 605 160M52 438L300 438 498 566M220 259L341 541M604 566L847 409M770 567L912 302M47 500L246 548 324 591M695 179L948 285M765 326L932 482"/></g><g class="block"><path d="M533 158l45-38 11 14-45 38zM546 184l45-38 12 14-45 38zM570 208l45-38 13 14-45 38zM591 237l45-38 12 14-45 38zM554 268l45-38 12 14-45 38zM516 312l26-28 15 14-26 28zM473 350l34-32 12 14-34 32z"/></g><text class="place-label" x="130" y="279">WEST AUCKLAND</text><text class="place-label" x="546" y="364">CENTRAL CITY</text><text class="place-label" x="763" y="410">EAST</text><text class="place-label" x="520" y="550">SOUTH AUCKLAND</text><g transform="translate(940 66)"><path d="M0 27V0L-4 9M0 0L4 9" stroke="#657d88" fill="none"/><text class="north-arrow" x="-4" y="-9">N</text></g>`;
class MapRenderer{
 constructor(kind,container){
  this.kind=kind;this.nodes={};this.trainNodes={};this.edgeNodes={};
  this.shell=document.createElement('div');this.shell.className='map-shell';container.appendChild(this.shell);
  this.shell.innerHTML=`<div class="map-caption">${kind==='old'?'BEFORE / THE TERMINAL':'AFTER / THE CONNECTION'}<b>${kind==='old'?'All roads lead to a dead end.':'A city that keeps moving.'}</b></div><div class="map-badge"><span class="badge-icon">${kind==='old'?'↶':'↳'}</span><span><strong>${kind==='old'?'Arrive. Reverse. Repeat.':'Through the city. On with your journey.'}</strong>${kind==='old'?'One shared throat. Two competing directions.':'Follow the mint line through the new connection.'}</span></div>`;
  this.svg=svgElement('svg',{viewBox:'0 0 1000 630',role:'group','aria-label':kind==='old'?'Old Auckland rail network, terminating at Britomart':'CRL network, through-running from west to east'},this.shell);
  this.svg.innerHTML=mapBackground.replaceAll('mapdots','mapdots-'+kind);
  this.trackLayer=svgElement('g',{},this.svg);this.stationLayer=svgElement('g',{},this.svg);this.trainLayer=svgElement('g',{},this.svg);
  this.build();
 }
 build(){
  const sim=simulations[this.kind];
  if(experiment?.type==='why'&&this.kind==='new'){this.shell.querySelector('.map-caption').innerHTML='TRANSFORMATION EXPERIMENT<b>'+sim.config.label+'</b>';this.shell.querySelector('.map-badge').style.display='none';}
  this.trackLayer.innerHTML='';this.stationLayer.innerHTML='';this.trainLayer.innerHTML='';this.nodes={};this.trainNodes={};this.edgeNodes={};
  if(!sim.config.link)svgElement('path',{d:'M657 143L551 223L458 316L458 415',class:'future-track'},this.trackLayer);
  const edges=new Map();for(const r of sim.routes)for(let i=1;i<r.path.length;i++){const a=r.path[i-1],b=r.path[i],key=edgeKey(a,b);let color=(BY_ID[a].crl||BY_ID[b].crl)?COLORS.crl:BY_ID[a].region==='west'?COLORS.west:BY_ID[a].region==='east'||BY_ID[b].region==='east'?COLORS.east:COLORS.south;edges.set(key,{a,b,color});}
  for(const [key,{a,b,color}]of edges){const d=pathBetween(BY_ID[a],BY_ID[b]);svgElement('path',{d,class:'track-bed'},this.trackLayer);const glow=svgElement('path',{d,class:'track-glow',stroke:color},this.trackLayer);const track=svgElement('path',{d,class:'track',stroke:color},this.trackLayer);const flow=svgElement('path',{d,class:'track-flow'},this.trackLayer);this.edgeNodes[key]={glow,track,flow};}
  for(const id of sim.activeIds){
   const s=BY_ID[id],node=svgElement('g',{class:'station'+(s.region==='city'?' city':''),transform:`translate(${s.x} ${s.y})`,tabindex:'0',role:'button','aria-label':s.name+' station details'},this.stationLayer);
   const halo=svgElement('circle',{class:'halo',r:17},node),ring=svgElement('circle',{class:'ring',r:s.region==='city'?7:5},node);svgElement('circle',{class:'dot',r:1.7},node);
   const text=svgElement('text',{x:s.dx,y:s.dy,'text-anchor':s.anchor||'middle'},node);text.textContent=s.name;
   if(id==='britomart'){const sub=svgElement('tspan',{x:s.dx,dy:14,fill:'#8095a0','font-size':9,'font-weight':400},text);sub.textContent='Britomart';}
   if(s.crl){const tag=svgElement('text',{x:s.dx,y:s.dy+15,'text-anchor':s.anchor||'middle',class:'new-station-tag'},node);tag.textContent='NEW STATION';}
   const queue=svgElement('text',{class:'queue-label',x:13,y:21},node);const dots=[];
   for(let i=0;i<12;i++)dots.push(svgElement('circle',{class:'passenger-dot',r:1.6,cx:(i%6)*4-10,cy:11+Math.floor(i/6)*4},node));
   const title=svgElement('title',{},node);title.textContent='Click to change arrivals and inspect the queue';
   node.addEventListener('click',()=>selectEntity(this.kind,'station',id));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectEntity(this.kind,'station',id);}});
   this.nodes[id]={node,halo,ring,queue,dots};
  }
  this.platformSlots=null;
  const g=svgElement('g',{class:!sim.config.through?'old-callout':''},this.stationLayer);
  if(!sim.config.through){
   svgElement('path',{d:'M677 195L619 193 600 174',class:'callout-line'},g);svgElement('rect',{x:408,y:126,width:189,height:77,rx:8,class:'callout-box'},g);const t=svgElement('text',{x:423,y:147,class:'callout-text'},g);t.textContent='THE BRITOMART BOTTLENECK';const t2=svgElement('text',{x:423,y:165,class:'callout-text','font-size':9},g);t2.textContent='Every arrival needs a way back out.';
   this.platformSlots=[];for(let i=0;i<5;i++){const slot=svgElement('rect',{x:423+i*32,y:181,width:25,height:6,rx:2,fill:'#493e39'},g);const title=svgElement('title',{},slot);title.textContent='Terminal platform '+(i+1)+' occupancy';this.platformSlots.push(slot);}
  }else{
   svgElement('path',{d:'M553 265L635 265 659 252',class:'callout-line'},g);svgElement('rect',{x:568,y:275,width:178,height:51,rx:8,class:'callout-box'},g);const t=svgElement('text',{x:582,y:296,class:'callout-text'},g);t.textContent=sim.config.link?'THE CITY RAIL LINK':'THROUGH-STATION EXPERIMENT';const t2=svgElement('text',{x:582,y:313,class:'callout-text','font-size':9},g);t2.textContent=sim.config.link?'A new way through the city.':'Virtual continuation beyond the city.';
  }
 }
 render(sim,visualTime){
  if(this.platformSlots){const occupied=sim.trains.filter(t=>t.state==='dwell'&&t.path[t.index]==='britomart').length;this.platformSlots.forEach((slot,i)=>slot.setAttribute('fill',i<occupied?'#f19a83':'#493e39'));}
  for(const [id,n]of Object.entries(this.nodes)){
   const queue=sim.queue(id),pressure=clamp(queue/700,0,1),crowded=queue>350;
   n.halo.setAttribute('r',15+pressure*22);n.halo.style.opacity=.04+pressure*.15;n.node.classList.toggle('crowded',crowded);n.ring.setAttribute('r',(BY_ID[id].region==='city'?7:5)+pressure*2);
   n.queue.textContent=queue>90?fmt(queue):'';n.dots.forEach((d,i)=>{d.style.opacity=i<queue/24?.7:0;d.setAttribute('cy',11+Math.floor(i/6)*4+Math.sin(visualTime*2+i)*.7);});
  }
  for(const [key,n]of Object.entries(this.edgeNodes)){const activity=sim.edgeActivity[key]||0;n.glow.style.opacity=Math.min(.7,activity/14);n.track.setAttribute('stroke-width',4+Math.min(2,activity/10));n.flow.setAttribute('stroke-dashoffset',-visualTime*12);}
  const alive=new Set();
  for(const t of sim.trains){
   alive.add(t.id);let n=this.trainNodes[t.id];
   if(!n){const g=svgElement('g',{class:'train',role:'button',tabindex:'0','aria-label':t.name+' train '+t.id},this.trainLayer);svgElement('rect',{x:-13,y:-5,width:26,height:10,rx:3,class:'train-body'},g);const fill=svgElement('rect',{x:-11,y:-3.5,width:0,height:7,rx:1.5,class:'train-fill'},g);for(let i=0;i<4;i++)svgElement('rect',{x:-8+i*5,y:-3,width:1.7,height:6,class:'train-window'},g);svgElement('circle',{cx:10.5,cy:0,r:1.1,class:'train-light'},g);const title=svgElement('title',{},g);g.addEventListener('click',()=>selectEntity(this.kind,'train',t.id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectEntity(this.kind,'train',t.id);}});n={g,fill,title,x:null,y:null,angle:0};this.trainNodes[t.id]=n;}
   const a=BY_ID[t.path[t.index]],b=BY_ID[t.path[t.index+1]||t.path[Math.max(0,t.index-1)]],p=t.state==='moving'?t.progress:0;
   let angle=Math.atan2(b.y-a.y,b.x-a.x),offset=6;
   if(t.state==='dwell'&&a.id==='britomart'&&!sim.config.through){const peers=sim.trains.filter(o=>o.state==='dwell'&&o.path[o.index]==='britomart');offset=(peers.indexOf(t)-2)*11;}
   if(t.state==='pending'){const peers=sim.trains.filter(o=>o.state==='pending'&&o.path[0]===a.id);offset=12+peers.indexOf(t)*12;}
   const x=a.x+(b.x-a.x)*p-Math.sin(angle)*offset,y=a.y+(b.y-a.y)*p+Math.cos(angle)*offset;
   if(n.x===null||Math.hypot(n.x-x,n.y-y)>120){n.x=x;n.y=y;}else{n.x+=(x-n.x)*.22;n.y+=(y-n.y)*.22;}
   n.g.setAttribute('transform',`translate(${n.x.toFixed(2)} ${n.y.toFixed(2)}) rotate(${angle*180/Math.PI})`);
   const occupied=clamp(sim.people(t)/sim.capacity(),0,1);n.fill.setAttribute('width',22*occupied);n.g.classList.toggle('held',t.wait>10||t.delay);n.g.classList.toggle('full',occupied>.9);n.title.textContent=`${t.name} #${t.id}: ${fmt(sim.people(t))}/${sim.capacity()} people. ${t.reason||'Moving'}. Click for details.`;
  }
  for(const [id,n]of Object.entries(this.trainNodes))if(!alive.has(+id)){n.g.remove();delete this.trainNodes[id];}
 }
}
function initialise(warm=true){
 simulations={old:new RailSimulation('old',settings),new:new RailSimulation('new',settings)};
 if(warm){simulations.old.advance(1200);simulations.new.advance(1200);}
 history.old=[];history.new=[];selected=null;$('detailPanel').hidden=true;accumulator=0;buildMaps();updateUI();
}
function buildMaps(){
 $('mapArea').innerHTML='';$('mapArea').classList.toggle('compare',mode==='compare');renderers={};
 for(const kind of mode==='compare'?['old','new']:[mode])renderers[kind]=new MapRenderer(kind,$('mapArea'));
 const old=mode==='old';$('networkInsight').innerHTML=old?'<strong>A train arriving is only half the story.</strong> It must unload, reverse, and claim the same throat again to leave.':mode==='compare'?'<strong>Same passengers. Two very different flows.</strong> Coral queues reveal the cost of a dead end; the CRL creates a path through.':'<strong>Keep moving. That’s the difference.</strong> Trains continue through Waitematā, freeing space for the next arrival.';
 $('stressNetwork').textContent=old?'OLD':mode==='compare'?'WORST OF BOTH':'CRL';
 document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
}
function paintRanges(){document.querySelectorAll('input[type=range]').forEach(input=>input.style.setProperty('--fill',((+input.value-+input.min)/(+input.max-+input.min)*100)+'%'));}
function syncControls(){
 $('demand').value=settings.demand;$('demandOut').textContent=settings.demand.toFixed(1)+'×';$('destinations').value=settings.destinations;$('delays').value=settings.delays;$('delaysOut').textContent=settings.delays+'%';
 for(const [id,, , , ,unit]of operations){$(id).value=settings[id];$(id+'Out').textContent=settings[id]+' '+unit;}
 for(const s of STATIONS){$('rate-'+s.id).value=settings.rates[s.id];$('rate-'+s.id+'Out').textContent=settings.rates[s.id]+' /min';}
 $('serviceNote').textContent=`Dispatches: old ${settings.tph} / CRL ${Math.round(settings.tph*1.5)} trainsets per hour. Each runs a return journey; CRL passes through the city in both directions. Actual departures obey track and platform limits. Turnaround applies at old Britomart.`;paintRanges();
}
function updateUI(){
 const m={old:simulations.old.metrics(),new:simulations.new.metrics()};
 for(const k of ['old','new']){
  displayValues[k]+=(m[k].throughput-displayValues[k])*.35;if(Math.abs(displayValues[k]-m[k].throughput)<1)displayValues[k]=m[k].throughput;$(k==='old'?'oldThroughput':'newThroughput').textContent=fmt(displayValues[k]);
  history[k].push(m[k].throughput);if(history[k].length>60)history[k].shift();const max=Math.max(...history[k],1),min=Math.min(...history[k])*.7;const points=history[k].map((v,i)=>`${i/(Math.max(1,history[k].length-1))*140},${32-(v-min)/(max-min||1)*27}`).join(' ');$(k+'Spark').innerHTML=`<polyline points="${points}" fill="none" stroke="${k==='old'?COLORS.south:'#b3efc8'}" stroke-width="1.5"/>`;
 }
 const uplift=m.old.throughput?((m.new.throughput/m.old.throughput-1)*100):null;$('uplift').textContent=experiment?'Testing…':uplift===null?'—':(uplift>=0?'+':'')+Math.round(uplift)+'%';
 const k=mode==='old'?'old':'new',current=m[k],stress=mode==='compare'?Math.max(m.old.stress,m.new.stress):current.stress;
 $('stressValue').textContent=Math.round(stress*100)+'%';$('stressValue').style.color=stress>.7?'var(--coral)':'var(--mint)';
 [...$('stressBars').children].forEach((bar,i)=>bar.style.background=i<stress*22?(i>15?'#f19a83':i>10?'#e8be77':'#b3efc8'):'#2a363e');
 $('stressCaption').textContent=stress>.8?'Under serious pressure':stress>.5?'Queues are building':stress>.25?'Working a little harder':'Room to breathe';
 const values={city:fmt(current.city),wait:current.wait.toFixed(1)+' min',left:fmt(current.left),occupancy:Math.round(current.occupancy*100)+'%',busiest:BY_ID[current.busiest].name,bottleneck:current.bottleneck};
 for(const [id]of metricDefinitions)$('metric-'+id).textContent=values[id];
 if(mode==='compare')for(const [id]of metricDefinitions)$('metric-'+id).closest('.metric').querySelector('.metric-note').textContent=id==='city'?`Old ${fmt(m.old.city)} · CRL ${fmt(m.new.city)}`:id==='wait'?`Old ${m.old.wait.toFixed(1)} · CRL ${m.new.wait.toFixed(1)} min`:id==='left'?`Old ${fmt(m.old.left)} · CRL ${fmt(m.new.left)}`:id==='occupancy'?`Old ${Math.round(m.old.occupancy*100)}% · CRL ${Math.round(m.new.occupancy*100)}%`:'CRL · '+metricDefinitions.find(d=>d[0]===id)[2];
 else for(const [id,,note]of metricDefinitions)$('metric-'+id).closest('.metric').querySelector('.metric-note').textContent=note;
 const t=Math.floor(simulations.new.time-1200+8*3600);$('simClock').textContent=experiment?'TRIAL '+Math.floor(simulations[experiment.type==='why'?'new':experiment.testing||'old'].time/60)+'m':new Date(Math.max(0,t)*1000).toISOString().slice(11,19);
 $('mapStatus').textContent=experiment?'Experiment in progress':playing?'Trains in motion':'Simulation paused';
 if(selected)updateDetails();
}
function selectEntity(kind,type,id){selected={kind,type,id};$('detailPanel').hidden=false;updateDetails(true);}
function updateDetails(build=false){
 const {kind,type,id}=selected,sim=simulations[kind],prefix=kind==='old'?'OLD NETWORK':'CITY RAIL LINK';
 if(type==='station'){
  const s=BY_ID[id],state=sim.stations[id];if(!state)return;const queue=sim.queue(id),platforms=sim.trains.filter(t=>t.state==='dwell'&&t.path[t.index]===id).length;
  if(build)$('detailContent').innerHTML=`<div class="eyebrow mint">${prefix} / STATION</div><h2 id="detailTitle">${s.name}</h2><div class="detail-stats"><span>Waiting<strong id="detailQueue"></strong></span><span>Platforms occupied<strong id="detailPlatforms"></strong></span></div><p id="detailExplain"></p><label class="range-label" for="detailRate">People arriving / minute<output id="detailRateOut"></output></label><input id="detailRate" type="range" min="0" max="60" step="1" value="${settings.rates[id]}"><button class="outline-button" id="stationSurge">↗ Send a surge here</button>`;
  $('detailQueue').textContent=fmt(queue);$('detailPlatforms').textContent=platforms;
  $('detailExplain').textContent=id==='britomart'?(kind==='old'?'Why are trains queuing here? Arrivals and departures compete for the same throat. Turning a train around also keeps its platform occupied.':'Trains stop, exchange passengers, and continue into the CRL. Opposite directions have independent track slots.'):queue>350?'Arrivals are outpacing boarding. Try more frequent services, larger trains, or faster boarding.':'Click a train to see where these passengers can go. Each dot represents a small group waiting to board.';
  $('detailRateOut').textContent=settings.rates[id]+' /min';
  if(build){$('detailRate').oninput=e=>{cancelExperiment(true);settings.rates[id]=+e.target.value;syncControls();updateDetails();};$('stationSurge').onclick=()=>sendSurge(id);paintRanges();}
 }else{
  const t=sim.trains.find(t=>t.id===id);
  if(!t){$('detailContent').innerHTML=`<div class="eyebrow mint">JOURNEY COMPLETE</div><h2 id="detailTitle">Train #${id} has arrived.</h2><p>Its passengers are counted when they reach their destinations. Select another train to keep following the flow.</p>`;return;}
  $('detailContent').innerHTML=`<div class="eyebrow mint">${prefix} / TRAIN ${id}</div><h2 id="detailTitle">${t.name}</h2><div class="detail-stats"><span>On board<strong>${fmt(sim.people(t))} / ${sim.capacity()}</strong></span><span>Occupancy<strong>${Math.round(sim.people(t)/sim.capacity()*100)}%</strong></span></div><p><strong>${t.reason||'Moving between stations'}</strong><br>${BY_ID[t.path[t.index]].name} → ${BY_ID[t.path[t.index+1]||t.path[t.index]].name}</p><p>${t.index===t.terminalIndex?'This train must finish its turnaround before requesting a departure through the shared throat.':t.wait>10?'A resource ahead is occupied. Following trains must keep their distance, so the queue spreads backwards.':'It can board people whose next stop brings them closer to their destination.'}</p>`;
 }
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function sendSurge(id){cancelExperiment(true);id=id||selected?.type==='station'&&selected.id||'newlynn';for(const sim of Object.values(simulations)){const target=sim.stations[id]?id:'britomart';sim.surges[target]=sim.time+120;}toast(`Passenger surge at ${BY_ID[id].name} · 4× arrivals for 2 simulated minutes`);}
function setPlaying(value){playing=value;document.body.classList.toggle('paused',!playing);$('playButton').textContent=playing?'Ⅱ':'▶';$('playButton').setAttribute('aria-label',playing?'Pause simulation':'Play simulation');updateUI();}
function setMode(value){mode=value;buildMaps();updateUI();}
function settingsChanged(){cancelExperiment(true);document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));syncControls();}
for(const [id]of operations)$(id).addEventListener('input',e=>{const old=settings[id];settings[id]=+e.target.value;settingsChanged();for(const sim of Object.values(simulations)){if(id==='tph')sim.nextDispatch=Math.min(sim.nextDispatch,sim.time+3600/sim.tph());if(id==='headway')for(const key in sim.release)if(!key.startsWith('junction:'))sim.release[key]=Math.max(sim.time,sim.release[key]+settings[id]-old);if(id==='dwell'||id==='turnaround')for(const t of sim.trains)if(t.state==='dwell'&&(id==='dwell'||t.index===t.terminalIndex))t.hold=Math.max(0,t.hold+settings[id]-old);}});
$('demand').addEventListener('input',e=>{settings.demand=+e.target.value;settingsChanged();});
$('destinations').addEventListener('change',e=>{settings.destinations=e.target.value;settingsChanged();});
$('delays').addEventListener('input',e=>{settings.delays=+e.target.value;settingsChanged();});
for(const s of STATIONS)$('rate-'+s.id).addEventListener('input',e=>{settings.rates[s.id]=+e.target.value;settingsChanged();});
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>setMode(b.dataset.mode);
for(const b of document.querySelectorAll('[data-speed]'))b.onclick=()=>{speed=+b.dataset.speed;document.querySelectorAll('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));};
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{
 cancelExperiment(true);const p=b.dataset.preset,values={quiet:{demand:.35,delays:0},normal:{demand:1,delays:5},rush:{demand:2.2,delays:10},chaos:{demand:4.5,delays:45}}[p];Object.assign(settings,values);document.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x===b));document.body.classList.toggle('chaos',p==='chaos');syncControls();setPlaying(true);toast(p==='chaos'?'Chaos unleashed. Watch the queues ripple back through the network.':b.textContent+' demand applied to both networks.');
};
$('playButton').onclick=()=>setPlaying(!playing);
$('resetButton').onclick=()=>{cancelExperiment();Object.assign(settings,cloneSettings(DEFAULTS));document.body.classList.remove('chaos');syncControls();initialise();setPlaying(true);document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset==='normal'));toast('Fresh morning. Default settings and identical seeded warm-up restored.');};
$('surgeButton').onclick=()=>sendSurge();
$('disruptButton').onclick=()=>{cancelExperiment(true);for(const sim of Object.values(simulations)){const t=sim.trains.find(t=>t.state==='dwell'&&BY_ID[t.path[t.index]].region==='city')||sim.trains.find(t=>t.state==='dwell');if(t){t.hold+=90;t.delay=true;}}toast('A train in each network is held for 90 seconds. Watch for bunching.');};
$('closeDetail').onclick=()=>{selected=null;$('detailPanel').hidden=true;};
for(const id of ['aboutButton','sourcesButton'])$(id).onclick=()=>$('aboutDialog').showModal();
$('closeAbout').onclick=()=>$('aboutDialog').close();
$('aboutDialog').addEventListener('click',e=>{if(e.target===$('aboutDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('detailPanel').hidden=true;selected=null;}if(e.code==='Space'&&!['INPUT','SELECT','BUTTON','SUMMARY'].includes(document.activeElement.tagName)&&!$('aboutDialog').open){e.preventDefault();setPlaying(!playing);}});
// Experiments use the exact same RailSimulation as the live maps. Work is chunked
// between animation frames; every capacity value comes from completed journeys.
const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function runTrial(kind,params,stage,demand,token,show=true){
 const p=cloneSettings(params);p.demand=demand;const sim=new RailSimulation(kind,p,{stage,seed:2026});
 if(show){experiment.testing=kind;simulations[kind]=sim;renderers[kind]?.build();}
 let completeStart=0;const samples=[];
 for(let t=0;t<3600;t+=120){
  if(token!==experimentToken)return null;
  while(!playing){await yieldFrame();if(token!==experimentToken)return null;}
  sim.advance(120);if(t===1080)completeStart=sim.completed;if(t>=1200)samples.push(sim.metrics().queue);
  await yieldFrame();
 }
 const m=sim.metrics(),first=sum(samples.slice(0,5))/5,last=sum(samples.slice(-5))/5,qGrowth=last-first;
 const overloaded=last>m.arrivalRate*5&&qGrowth>m.arrivalRate*2;
 return {sim,demand,overloaded,capacity:(sim.completed-completeStart)*1.5,metrics:m,growth:qGrowth};
}
async function findCapacity(kind,params,stage,token,onStep){
 let previous=null,last=null;
 for(let d=.5;d<=6;d+=.5){
  last=await runTrial(kind,params,stage,d,token);if(!last)return null;if(onStep)onStep(last);
  if(last.overloaded)return {sustainable:previous?.capacity||0,limit:d,last,previous,unbounded:false};
  previous=last;
 }
 return {sustainable:last.capacity,limit:6,last,previous:last,unbounded:true};
}
function explanation(result,kind){
 if(result.unbounded)return 'No sustained overload was found by 6× demand. This result is a lower bound; increase station arrivals or reduce supply to explore further.';
 const reason=result.last.metrics.bottleneck;
 if(kind==='old'&&/Britomart|headway|Platform|Train ahead/i.test(reason))return 'Britomart is the limiting constraint. Arriving and departing trains compete for its shared throat, while reversals occupy platforms. Train queues spread backwards and passengers wait longer.';
 if(/capacity/i.test(reason))return 'The bottleneck has moved inside the trains: seats and standing space fill faster than services can carry people away. The tunnel can keep flowing, but larger or more frequent trains are needed.';
 if(/junction/i.test(reason))return reason+' is the limiting constraint. Through-running has relieved the city terminal, but converging services still need gaps to cross the junction.';
 if(/headway|ahead|Platform/i.test(reason))return 'The bottleneck has moved to track and platform spacing. Trains keep running through the city, but the next service must wait for a safe gap and a free platform.';
 return 'Passenger arrivals now exceed the available service. '+reason+' is the strongest observed constraint. Through-running removes the terminal conflict; it does not provide unlimited train capacity.';
}
function beginExperiment(type){
 cancelExperiment();experiment={type,saved:cloneSettings(settings)};experimentToken++;document.body.classList.add('experiment-running');$('limitButton').disabled=true;$('whyButton').disabled=true;$('experimentResults').hidden=false;setPlaying(true);setMode('compare');
 $('experimentResults').innerHTML=`<div class="result-header"><h3>${type==='limit'?'Turning up the pressure…':'Building the difference, one change at a time.'}</h3><button id="cancelExperiment">Stop experiment</button></div><p id="experimentStatus">Starting independent seeded runs. Controls remain available; changing one ends the experiment.</p><div class="progress-track"><div id="experimentProgress" style="width:0%"></div></div><div id="resultBody"></div>`;
 $('cancelExperiment').onclick=()=>cancelExperiment();$('experimentResults').scrollIntoView({behavior:'smooth',block:'nearest'});return experimentToken;
}
function finishExperiment(){
 const saved=experiment?.saved;experiment=null;document.body.classList.remove('experiment-running');$('limitButton').disabled=false;$('whyButton').disabled=false;
 if(saved){settings=saved;syncControls();initialise();}
 const button=$('cancelExperiment');if(button){button.textContent='Close results';button.onclick=()=>{$('experimentResults').hidden=true;};}
 document.querySelector('.network-panel').classList.add('relieved');setTimeout(()=>document.querySelector('.network-panel').classList.remove('relieved'),1800);
}
function cancelExperiment(keepVisible=false){
 if(!experiment)return;experimentToken++;experiment=null;document.body.classList.remove('experiment-running');$('limitButton').disabled=false;$('whyButton').disabled=false;initialise();
 if(keepVisible){$('experimentStatus').textContent='Experiment stopped because the controls changed. Run it again to measure the new settings.';const b=$('cancelExperiment');if(b){b.textContent='Close results';b.onclick=()=>{$('experimentResults').hidden=true;};}}
 else $('experimentResults').hidden=true;
}
$('limitButton').onclick=async()=>{
 const token=beginExperiment('limit'),params=cloneSettings(settings),results={};
 for(const [i,kind]of ['old','new'].entries()){
  results[kind]=await findCapacity(kind,params,null,token,r=>{$('experimentStatus').textContent=`${kind==='old'?'Old network':'CRL'} · ${r.demand.toFixed(1)}× demand · ${fmt(r.metrics.queue)} waiting · ${r.overloaded?'sustained overload detected':'checking the next demand level'}`;$('experimentProgress').style.width=(i*50+r.demand/6*50)+'%';});
  if(token!==experimentToken||!results[kind])return;
  const r=results[kind];$('resultBody').innerHTML+=`<div class="capacity-result"><span class="eyebrow">${kind==='old'?'OLD NETWORK':'CITY RAIL LINK'} · ${r.unbounded?'AT LEAST':'LAST SUSTAINABLE TRIAL'}</span><strong>${fmt(r.sustainable)} <small>people / hour</small></strong><p>${explanation(r,kind)}</p></div>`;
 }
 $('resultBody').className='result-columns';$('experimentProgress').style.width='100%';$('experimentStatus').textContent=`Old overloaded at ${results.old.unbounded?'>':' '}${results.old.limit.toFixed(1)}×; CRL at ${results.new.unbounded?'>':' '}${results.new.limit.toFixed(1)}×. Coarse 0.5× steps, 60 simulated minutes each. Baseline controls restored; results remain below.`;finishExperiment();toast('Experiment complete. Follow where the bottleneck moved.');
};
$('whyButton').onclick=async()=>{
 const token=beginExperiment('why'),params=cloneSettings(settings),results=[];$('resultBody').className='';
 for(let i=0;i<STAGES.length;i++){
  const stage=STAGES[i];$('experimentStatus').textContent=`Step ${i+1} of 7 · ${stage.label}. ${stage.explain}`;
  const result=await findCapacity('new',params,stage,token,r=>{$('experimentProgress').style.width=((i+r.demand/6)/7*100)+'%';});
  if(token!==experimentToken||!result)return;results.push(result);
  const max=Math.max(...results.map(r=>r.sustainable),1);$('resultBody').innerHTML=results.map((r,j)=>`<div class="step-row" title="${STAGES[j].explain}"><span>0${j+1}</span><span>${STAGES[j].label}</span><div class="step-bar"><i style="width:${r.sustainable/max*100}%"></i></div><strong>${r.unbounded?'≥ ':''}${fmt(r.sustainable)} /h</strong></div>`).join('');
 }
 $('experimentProgress').style.width='100%';$('experimentStatus').textContent='Completed journeys/hour at each stage’s last sustainable demand step. The through-only stage is counterfactual; longer trains are a future scenario. A step can plateau or fall: extra stations add dwell, and other constraints can take over. Your baseline controls are restored.';finishExperiment();toast('A connection changes the network. Extra stations are only part of the story.');
};
function frame(now){
 if(!lastFrame)lastFrame=now;const delta=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;
 if(playing){frameTime+=delta;if(!experiment){accumulator+=delta*speed;while(accumulator>=1){simulations.old.tick();simulations.new.tick();accumulator--;}}}
 for(const [kind,r]of Object.entries(renderers))r.render(simulations[kind],frameTime);
 if(now-lastUi>300){updateUI();lastUi=now;}
 requestAnimationFrame(frame);
}
syncControls();initialise();requestAnimationFrame(frame);
} // browser UI
