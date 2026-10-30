/* Rendering only. Simulation, hit boxes, input, and networking live in index.html. */
const PaperPunch = (() => {
  const PAPER = '#f3e5c9', INK = '#142638';
  const backdrop = new Image();
  const arenaCache = new Map();
  backdrop.onload = () => arenaCache.clear();
  backdrop.src = 'assets/paper-arena.png';

  // One repeatable paper texture, shared by the arena and all moving cutouts.
  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  const gc = grain.getContext('2d');
  let seed = 7823;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 5500; i++) {
    gc.fillStyle = i % 2 ? 'rgba(255,248,221,.14)' : 'rgba(42,28,15,.09)';
    gc.fillRect(random()*128, random()*128, .4+random(), .4+random());
  }
  const patterns = new WeakMap();
  function texture(c) {
    if (!patterns.has(c)) patterns.set(c, c.createPattern(grain, 'repeat'));
    return patterns.get(c);
  }
  function polygon(points) {
    const p = new Path2D();
    points.forEach(([x,y],i) => i ? p.lineTo(x,y) : p.moveTo(x,y));
    p.closePath();
    return p;
  }
  function ellipse(x,y,rx,ry) {
    const p = new Path2D(); p.ellipse(x,y,rx,ry,0,0,Math.PI*2); return p;
  }
  function paper(c,p,color,edge=4) {
    c.save(); c.lineJoin='round'; c.lineWidth=edge*2; c.strokeStyle=PAPER;
    if (edge) {
      c.shadowColor='#07131f55'; c.shadowOffsetX=2; c.shadowOffsetY=3;
      c.stroke(p); c.shadowColor='transparent';
    }
    c.fillStyle=color; c.fill(p); c.fillStyle=texture(c); c.fill(p); c.restore();
  }
  function line(c,points,color,width=2) {
    c.save(); c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
    c.lineCap='round'; c.lineJoin='round'; c.strokeStyle=color; c.lineWidth=width; c.stroke(); c.restore();
  }
  function limb(c,points,color,width) {
    line(c,points,'#14263844',width+10);
    line(c,points,PAPER,width+7);
    line(c,points,color,width);
    line(c,points,texture(c),width);
  }
  function starPath(x,y,r,points=5) {
    const a=[];
    for(let i=0;i<points*2;i++) { const t=-Math.PI/2+i*Math.PI/points; const s=i%2?r*.43:r; a.push([x+Math.cos(t)*s,y+Math.sin(t)*s]); }
    return polygon(a);
  }
  function mix(rgb,other,t) { return rgb.map((v,i)=>Math.round(v*(1-t)+other[i]*t)); }
  const skinCache=new WeakMap();
  function skinFor(image,crop) {
    const fallback={base:'#cf9b74',light:'#e3b68e',dark:'#ae7654'};
    if(!image || !image.complete || !image.naturalWidth) return fallback;
    const key=crop ? [crop.sx,crop.sy,crop.sw,crop.sh].join(',') : 'full';
    const cached=skinCache.get(image); if(cached && cached.key===key) return cached.colors;
    let colors=fallback;
    try {
      const s=document.createElement('canvas'); s.width=s.height=24;
      const c=s.getContext('2d',{willReadFrequently:true});
      const x=crop?.sx||0,y=crop?.sy||0,w=crop?.sw||image.naturalWidth,h=crop?.sh||image.naturalHeight;
      c.drawImage(image,x+w*.22,y+h*.25,w*.56,h*.48,0,0,24,24);
      const pixels=c.getImageData(0,0,24,24).data, candidates=[];
      for(let i=0;i<pixels.length;i+=4) {
        const [r,g,b,a]=pixels.slice(i,i+4);
        if(a>200 && r>45 && r>g*1.04 && r>b*1.12 && r-g<95 && g>b*.85 && r<248) candidates.push([r,g,b]);
      }
      if(candidates.length>15) {
        candidates.sort((a,b)=>a[0]+a[1]-b[0]-b[1]);
        const rgb=mix(candidates[Math.floor(candidates.length*.55)],[216,178,134],.12);
        colors={base:`rgb(${rgb.join(',')})`,light:`rgb(${mix(rgb,[249,225,185],.24).join(',')})`,dark:`rgb(${mix(rgb,[76,43,28],.22).join(',')})`};
      }
    } catch(_) { /* Cross-origin portraits still render with a neutral paper skin tone. */ }
    skinCache.set(image,{key,colors}); return colors;
  }

  function headPath(hw,hh,extra=0) {
    const pts=[];
    // Stable scissor-cut edge: no frame-to-frame jitter or changing crop data.
    for(let i=0;i<48;i++) {
      const t=i/48*Math.PI*2;
      const nick=1 + Math.sin(i*2.7)*.016 + Math.cos(i*1.4)*.011;
      pts.push([Math.cos(t)*(hw+extra)*nick,Math.sin(t)*(hh+extra)*nick]);
    }
    return polygon(pts);
  }
  function drawHead(c,b,image,crop,x,y,skin) {
    const ratio=crop?.ovalRatio||63/78, hw=63, hh=Math.round(hw/ratio);
    c.save(); c.translate(x,y-hh+10); c.rotate(b.headRot*Math.PI/180);
    const custom=FaceCrop.isOutline(crop);
    const cut=custom ? FaceCrop.path(crop,-hw,-hh,hw*2,hh*2) : headPath(hw,hh);
    paper(c,cut,PAPER,5);
    c.save(); c.clip(cut);
    if(image?.complete && image.naturalWidth) {
      const dw=hw*(custom?2:2.15),dh=hh*(custom?2:2.15);
      if(crop?.sw>0 && crop?.sh>0) c.drawImage(image,crop.sx,crop.sy,crop.sw,crop.sh,-dw/2,-dh/2,dw,dh);
      else c.drawImage(image,-dw/2,-dh/2,dw,dh);
      // Very light warm stock tint unifies photos without hiding their expression.
      c.fillStyle='rgba(241,216,170,.07)'; c.fillRect(-hw-2,-hh-2,hw*2+4,hh*2+4);
    } else {
      c.fillStyle=skin.light; c.fillRect(-hw,-hh,hw*2,hh*2);
      paper(c,polygon([[-65,-48],[-45,-hh],[25,-hh],[65,-40],[32,-58],[5,-45],[-22,-56]]),INK,0);
      paper(c,ellipse(-20,-8,5,7),INK,0); paper(c,ellipse(20,-8,5,7),INK,0);
      line(c,[[-28,-25],[-15,-27]],INK,4); line(c,[[13,-27],[27,-23]],INK,4);
      const smile=new Path2D(); smile.moveTo(-22,22); smile.quadraticCurveTo(0,42,24,19); smile.quadraticCurveTo(0,28,-22,22);
      paper(c,smile,PAPER,0);
      paper(c,ellipse(-37,15,10,5),'#bb665c66',0); paper(c,ellipse(37,15,10,5),'#bb665c66',0);
    }
    if(b.state==='hit' && b.stateTimer<6) { c.fillStyle=`rgba(255,239,199,${.5-b.stateTimer*.08})`; c.fill(cut); }
    c.restore();
    if(b.state==='ko') for(let i=0;i<3;i++) {
      const a=b.bobTimer*.08+i*Math.PI*2/3;
      paper(c,starPath(Math.cos(a)*57,Math.sin(a)*18-hh-13,9),'#e7ad4d',1.5);
    }
    c.restore();
  }
  function boot(c,x,y,f,color) {
    c.save(); c.translate(x,y); c.scale(f,1);
    paper(c,polygon([[-10,-19],[7,-21],[9,-5],[23,1],[25,9],[-13,9],[-14,1]]),color,3);
    paper(c,polygon([[-13,5],[24,5],[25,10],[-13,10]]),PAPER,0);
    line(c,[[-7,-16],[5,-13],[-6,-9],[7,-6]],PAPER,2);
    c.restore();
  }
  function drawArm(c,b,bx,by,which,skin) {
    const f=b.facing, lead=which==='lead';
    const victory=b.celebration, pose=victory?.[which];
    const baseX=bx+f*(lead?25:victory?.rearShoulder??10),baseY=by+(lead?-58:-48);
    const extend=(lead?b.leadArmExtend:b.rearArmExtend)||0;
    const gx=pose?bx+f*pose.x:bx+f*(lead?50:35)+f*extend*(lead?70:65)+(lead?b.leadWindupX||0:0);
    const gy=pose?by+pose.y:by+(lead?-78:-35)+(b.state==='blocking'?(lead?-20:-45):0)+(lead?b.leadWindupY||0:b.uppercutArmY||0);
    const ex=pose?bx+f*pose.elbowX:baseX+(gx-baseX)*.4,ey=pose?by+pose.elbowY:baseY+(gy-baseY)*.5+8;
    limb(c,[[baseX,baseY],[ex,ey],[gx,gy]],skin.base,lead?17:16);
    line(c,[[baseX-2,baseY],[ex-2,ey-1]],skin.light,4);
    const charged=!lead && b.state==='winding' && b.stateTimer>=30;
    const size=(lead?18:19)+extend*(lead?6:7);
    if(charged) {
      c.save(); c.translate(gx,gy); c.rotate(b.stateTimer*.025);
      paper(c,starPath(0,0,size+13,9),'#e7ad4d',2); c.restore();
    }
    c.save(); c.translate(gx,gy); c.scale(f,1);
    paper(c,polygon([[-size*.65,size*.25],[-size*.7,size*.85],[size*.3,size*.9],[size*.4,size*.25]]),PAPER,1);
    const glove=new Path2D();
    glove.moveTo(-size*.7,size*.45); glove.bezierCurveTo(-size*1.2,0,-size*.9,-size*.95,-size*.1,-size);
    glove.bezierCurveTo(size*.85,-size*1.12,size*1.15,-size*.2,size*.82,size*.52);
    glove.quadraticCurveTo(size*.5,size*.95,-size*.2,size*.72);
    glove.quadraticCurveTo(-size*.88,size*.98,-size*.7,size*.45); glove.closePath();
    paper(c,glove,charged?'#e7ad4d':b.color.glove,3);
    const shade=new Path2D(); shade.moveTo(size*.65,-size*.55); shade.quadraticCurveTo(size*.8,size*.4,0,size*.57); shade.quadraticCurveTo(size*.98,size*.8,size*.65,-size*.55);
    paper(c,shade,charged?'#b97d33':b.color.gloveDark,0);
    line(c,[[-size*.45,-size*.55],[-size*.12,-size*.7],[size*.2,-size*.66]],'#f4d8ac99',2.4);
    line(c,[[-size*.7,size*.25],[-size*.3,size*.33],[-size*.2,size*.65]],b.color.dark,1.4);
    c.restore();
  }
  function drawTorso(c,b,skin,bodyStyle) {
    const torso=polygon([[-20,-37],[-31,-30],[-35,-12],[-27,16],[-24,33],[25,33],[29,12],[34,-17],[26,-32],[15,-38]]);
    if(bodyStyle==='shirt') {
      paper(c,torso,b.color.main,4);
      paper(c,polygon([[10,-33],[26,-29],[30,-15],[23,27],[13,32],[17,2]]),b.color.dark,0);
      paper(c,polygon([[-24,-26],[-29,-15],[-21,26],[-13,28],[-17,-8]]),b.color.light,0);
      const neck=new Path2D(); neck.moveTo(-14,-39); neck.lineTo(14,-39);
      neck.quadraticCurveTo(12,-22,0,-22); neck.quadraticCurveTo(-12,-23,-14,-39);
      paper(c,neck,skin.base,0);
      line(c,[[-14,-36],[-10,-27],[0,-23],[10,-27],[14,-36]],PAPER,3);
      line(c,[[-28,-28],[-30,-18],[-26,-9]],PAPER,3);
      line(c,[[27,-28],[29,-18],[26,-9]],PAPER,3);
      paper(c,starPath(0,6,11),PAPER,0);
      line(c,[[-23,28],[23,28]],PAPER,2);
    } else {
      paper(c,torso,skin.base,4);
      paper(c,polygon([[-19,-30],[-27,-17],[-24,-7],[-2,-5],[-1,-26]]),skin.light,0);
      paper(c,polygon([[3,-27],[22,-28],[28,-14],[23,-5],[3,-7]]),skin.light,0);
      line(c,[[-2,-2],[-2,19]],skin.dark,1.4);
      line(c,[[-19,8],[-7,10]],skin.dark,1.3); line(c,[[7,10],[19,8]],skin.dark,1.3);
    }
  }
  function drawBodyPreview(c,bodyStyle) {
    c.clearRect(0,0,c.canvas.width,c.canvas.height);
    c.save(); c.translate(c.canvas.width/2,c.canvas.height/2);
    c.scale(c.canvas.width/90,c.canvas.height/90);
    drawTorso(c,{color:{main:'#31658e',light:'#5e87a2',dark:'#24455f'}},skinFor(null),bodyStyle);
    c.restore();
  }
  function drawStanding(c,b,image,crop,bx,by,bodyStyle) {
    const f=b.facing,skin=skinFor(image,crop);
    const walk=b.celebration?.step??(Math.abs(b.vx)>0?Math.sin(b.bobTimer*.5)*10:0);
    [-1,1].forEach(side=>{
      const x=bx+side*19, y=by+51+walk*side;
      limb(c,[[bx+side*17,by+16],[x+side*5,by+37],[x+side*8,y]],skin.base,17);
      line(c,[[x+side*7,y-8],[x+side*8,y+3]],PAPER,19);
      line(c,[[x+side*7,y-6],[x+side*8,y-3]],b.color.main,2);
      boot(c,x+side*8,y+5,f,b.color.main);
    });
    c.save(); c.translate(bx,by); c.rotate(f*-(b.leanAmount||0)*.45); c.translate(-bx,-by);
    c.save(); c.translate(bx,by-33); c.scale(1/b.bodySquash,b.bodySquash);
    drawTorso(c,b,skin,bodyStyle);
    c.restore();
    paper(c,polygon([[bx-27,by-6],[bx+27,by-6],[bx+33,by+25],[bx+5,by+28],[bx,by+17],[bx-6,by+28],[bx-34,by+24]]),b.color.shorts,4);
    paper(c,polygon([[bx-28,by-7],[bx+28,by-7],[bx+29,by+1],[bx-29,by+1]]),PAPER,0);
    line(c,[[bx-26,by+5],[bx-29,by+21]],PAPER,4); line(c,[[bx+26,by+5],[bx+29,by+22]],PAPER,4);
    line(c,[[bx,by+3],[bx-3,by+10],[bx+1,by+8],[bx+4,by+12]],PAPER,1.5);
    drawHead(c,b,image,crop,bx,by-78+b.headY,skin);
    drawArm(c,b,bx,by,'rear',skin); drawArm(c,b,bx,by,'lead',skin);
    c.restore();
  }
  function drawBoxer(c,b,image,crop,bodyStyle='classic') {
    const bx=b.bodyX,by=b.bodyY;
    const victory=b.celebration;
    c.save(); c.fillStyle='#19283733'; c.fill(ellipse(bx,victory?.groundY??by+66,48-(victory?.jump||0)*.35,9));
    if(victory?.tilt) {
      c.translate(bx,victory.groundY); c.rotate(victory.tilt); c.translate(-bx,-victory.groundY);
    }
    if(b.state==='ko' && b.koY>80) {
      const reach = (68 + 126 / (crop?.ovalRatio || 63/78)) * .73 + 10;
      const fallenX = b.facing > 0 ? Math.max(bx, reach) : Math.min(bx, 900 - reach);
      c.translate(fallenX,by+46); c.rotate(b.facing*-Math.PI*.46); c.scale(.73,.73);
      drawStanding(c,{...b,headY:0,headRot:0,leanAmount:0},image,crop,0,0,bodyStyle);
    } else drawStanding(c,b,image,crop,bx,by,bodyStyle);
    c.restore();
  }

  function buildArena(w,h) {
    const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
    const c=canvas.getContext('2d'); c.scale(w/900,h/600);
    c.fillStyle=INK; c.fillRect(0,0,900,600);
    if(backdrop.complete && backdrop.naturalWidth) c.drawImage(backdrop,0,0,900,570);
    else {
      for(let row=0;row<3;row++) for(let i=0;i<21;i++) {
        const x=i*46+(row%2)*23,y=310+row*44;
        paper(c,ellipse(x,y,15,17),row%2?'#294252':'#22394b',0);
        paper(c,polygon([[x-21,y+15],[x+18,y+13],[x+25,y+62],[x-26,y+62]]),row%2?'#294252':'#22394b',0);
      }
    }
    // The whole ring is drawn separately so geometry agrees with the fighters' feet.
    paper(c,polygon([[48,439],[851,438],[900,560],[0,560]]),'#c4a780',2);
    paper(c,polygon([[57,445],[844,445],[888,556],[12,556]]),'#e7d3af',1);
    paper(c,polygon([[57,445],[844,445],[859,470],[43,471]]),'#d9c19c',0);
    c.save(); c.translate(450,506); c.scale(1,.31);
    paper(c,starPath(0,0,92),'#65778235',0);
    c.strokeStyle='#8f785d4d'; c.lineWidth=3; c.beginPath(); c.ellipse(0,0,146,96,0,0,Math.PI*2); c.stroke(); c.restore();
    line(c,[[57,448],[844,448]],'#9d805e55',2);
    // Three cloth-paper ropes sit behind the active fighters.
    ['#b9463c',PAPER,'#35648a'].forEach((color,i)=>{
      const y=324+i*48;
      line(c,[[48,y+3],[200,y+6],[450,y+8],[700,y+5],[852,y+3]],'#0a17276b',9);
      line(c,[[48,y],[200,y+3],[450,y+5],[700,y+2],[852,y]],color,7);
      line(c,[[48,y-2],[450,y+3],[852,y-2]],'#f6e3bf50',1);
    });
    [48,852].forEach((x,i)=>{
      const color=i?'#35648a':'#b9463c';
      paper(c,polygon([[x-10,302],[x+9,299],[x+13,540],[x-13,542]]),color,3);
      paper(c,polygon([[x-10,304],[x-3,303],[x-1,534],[x-12,537]]),i?'#4b7a9c':'#ce5d49',0);
      [324,372,420].forEach(y=>paper(c,polygon([[x-13,y-12],[x+15,y-10],[x+14,y+11],[x-14,y+12]]),color,2));
    });
    return canvas;
  }
  function drawArena(c,w,h) {
    const key=w+'x'+h; if(!arenaCache.has(key)) arenaCache.set(key,buildArena(w,h));
    c.drawImage(arenaCache.get(key),0,0);
  }
  function drawConfetti(c,p) {
    c.save(); c.translate(p.x,p.y); c.rotate(p.life*7+p.vx);
    c.globalAlpha=Math.max(0,p.life);
    const colors=['#e7ad4d','#f3e5c9','#bf443a','#477694'];
    c.fillStyle=colors[Math.abs(Math.round(p.vx*10))%colors.length];
    c.fillRect(-p.size/2,-p.size/3,p.size,p.size*.65); c.restore();
  }
  function drawAnnouncement(c,text,scale,alpha,w,h,{y=h/2-28,height=72,fontSize=46}={}) {
    c.save(); c.translate(w/2,y); c.rotate(-.045); c.scale(scale,scale); c.globalAlpha=Math.min(1,alpha);
    c.font=`bold ${fontSize}px Impact, Arial Black, sans-serif`; c.textAlign='center'; c.textBaseline='middle';
    const width=Math.min(w/scale-32,c.measureText(text).width+46);
    paper(c,polygon([[-width/2,-height/2],[-width*.1,-height/2+2],[width/2,-height/2-2],[width/2-3,height/2],[0,height/2-1],[-width/2+2,height/2+2]]),PAPER,1);
    c.fillStyle=text.includes('K.O')?'#bb3d36':INK; c.fillText(text,0,2,width-28); c.restore();
  }
  return {drawBoxer,drawBodyPreview,drawArena,drawConfetti,drawAnnouncement};
})();
