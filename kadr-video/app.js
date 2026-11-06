(function(){
  'use strict';
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function(s,c){return (c||document).querySelector(s)};
  var $$ = function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};

  /* ---------- reveal, staggered inside each section ---------- */
  var groups = new Map();
  $$('.r').forEach(function(el){
    var parent = el.closest('section,article') || document.body;
    var n = groups.get(parent) || 0;
    el.style.setProperty('--d', Math.min(n,5) * 75 + 'ms');
    groups.set(parent, n + 1);
  });
  if (reduced || !('IntersectionObserver' in window)) {
    $$('.r').forEach(function(el){el.classList.add('in')});
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    },{rootMargin:'0px 0px -6% 0px'});
    $$('.r').forEach(function(el){io.observe(el)});
  }

  /* ---------- detector overlays, drawn in code so they stay sharp at any size ---------- */
  var DETS={
    fall:{vb:[2000,1116],items:[{r:[640,385,1235,630],t:'Падение человека',c:'a'}]},
    rig:{vb:[2000,1116],items:[{p:'950,600 1215,590 1265,765 900,775',t:'Опасная зона',c:'a'},{r:[555,370,150,255],t:'Каска',c:'g'},{r:[1265,410,165,275],t:'Каска',c:'g'},{r:[1545,450,165,385],t:'Каска',c:'g'}]},
    rotor:{vb:[620,440],items:[{p:'120,80 390,70 440,245 70,255',t:'Опасная зона',c:'a'}]},
    crew:{vb:[770,600],items:[{r:[135,110,165,275],t:'Каска',c:'g'},{r:[415,150,165,385],t:'Каска',c:'g'}]},
    worker:{vb:[580,440],items:[{r:[125,90,150,255],t:'Каска',c:'g'}]}
  };
  function detSvg(key){
    var d=DETS[key], NS='http://www.w3.org/2000/svg', s=document.createElementNS(NS,'svg');
    s.setAttribute('class','det'); s.setAttribute('aria-hidden','true');
    s.setAttribute('viewBox','0 0 '+d.vb[0]+' '+d.vb[1]); s.setAttribute('preserveAspectRatio','xMidYMid slice');
    var fs=d.vb[0]*.021;
    d.items.forEach(function(it){
      var g=document.createElementNS(NS,'g'), x, y, shape;
      g.setAttribute('class','d-'+it.c);
      if(it.r){
        shape=document.createElementNS(NS,'rect');
        shape.setAttribute('x',it.r[0]); shape.setAttribute('y',it.r[1]); shape.setAttribute('width',it.r[2]); shape.setAttribute('height',it.r[3]);
        x=it.r[0]; y=it.r[1];
      } else {
        shape=document.createElementNS(NS,'polygon'); shape.setAttribute('points',it.p);
        var first=it.p.split(' ')[0].split(','); x=+first[0]; y=+first[1];
      }
      g.appendChild(shape);
      var w=it.t.length*fs*.6+fs*.8, h=fs*1.5;
      var bg=document.createElementNS(NS,'rect'); bg.setAttribute('class','d-tag');
      bg.setAttribute('x',x); bg.setAttribute('y',Math.max(0,y-h)); bg.setAttribute('width',w); bg.setAttribute('height',h);
      var t=document.createElementNS(NS,'text'); t.textContent=it.t;
      t.setAttribute('x',x+fs*.4); t.setAttribute('y',Math.max(0,y-h)+fs*1.08); t.setAttribute('font-size',fs);
      g.appendChild(bg); g.appendChild(t); s.appendChild(g);
    });
    return s;
  }
  $$('[data-det]').forEach(function(f){ f.appendChild(detSvg(f.getAttribute('data-det'))) });

  /* ---------- console: the live thing ---------- */
  var SCENES = [
    {img:'machine',w:598,h:399,cam:'Цех · станок',alt:'Кадр с камеры: оператор у станка, система выделила человека, каску и рабочую зону',
      ev:[['Оператор на месте','Время операции замеряется'],['Простой станка','Отмечен для отчёта план-факт']]},
    {img:'rig-floor',det:'rig',w:1600,h:893,cam:'Буровая · площадка',alt:'Кадр с буровой: система отмечает средства защиты сотрудников',
      ev:[['Нет средства защиты','Событие о нарушении'],['Каска на месте','Качество распознавания 93%']]},
    {img:'zone-out',w:444,h:360,cam:'Буровая · ротор',alt:'Кадр у ротора: контур опасной зоны и сотрудник рядом с ней',
      ev:[['Человек в опасной зоне','Сотрудник внутри контура'],['Перемещение по объекту','Положение людей обновлено']]},
    {img:'fall-clean',det:'fall',w:1600,h:893,cam:'Буровая · настил',alt:'Детектор выделил упавшего сотрудника красной рамкой и скелетной моделью',
      ev:[['Падение человека','Событие о нештатной ситуации'],['Оповещение','Передано по громкой связи']]},
    {img:'flame',w:640,h:360,cam:'Территория · склад',alt:'Система выделила пламя и дым на территории объекта',
      ev:[['Пламя и дым','Раньше традиционных датчиков'],['Оповещение сотрудников','Событие передано в систему здания']]},
    {img:'conveyor-b',w:704,h:486,cam:'Склад · конвейер',alt:'Коробки на конвейере проходят через контрольные зоны',
      ev:[['Сверка отгрузки','Сравнение с накладной и заказом'],['Контроль упаковки','Коробка прошла контрольную зону']]},
    {img:'car-zone',w:640,h:360,cam:'Периметр · въезд',alt:'Автомобиль в контролируемой зоне, система считает машины',
      ev:[['Транспорт вне зоны','Нарушение на территории'],['Въезд автомобиля','Номер проверяется по списку доступа']]}
  ];
  var frame=$('#c-frame'), img=$('#c-img'), cam=$('#c-cam'), feed=$('#c-feed'), clock=$('#c-clock');
  var tabs=$$('#c-tabs button'), cur=0, auto=null, step=0;
  function pad(n){return (n<10?'0':'')+n}
  function now(){var d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())}
  function tick(){clock.textContent=now()}
  tick(); setInterval(tick,1000);
  /* seed rows get believable times counted back from the visitor's own clock */
  $$('li',feed).forEach(function(li,i){
    var d=new Date(Date.now()-(i+1)*(7+i*4)*60000), t=document.createElement('time');
    t.textContent=pad(d.getHours())+':'+pad(d.getMinutes());
    li.insertBefore(t,li.firstChild);
  });

  function logEvent(s, k){
    var e=SCENES[s].ev[k%SCENES[s].ev.length];
    var li=document.createElement('li');
    li.className='new';
    li.innerHTML='<time>'+now().slice(0,5)+'</time><b></b><span></span>';
    li.querySelector('b').textContent=e[0];
    li.querySelector('span').textContent=e[1];
    $$('li.new',feed).forEach(function(x){x.classList.remove('new')});
    feed.insertBefore(li,feed.firstChild);
    while(feed.children.length>6) feed.removeChild(feed.lastChild);
  }
  function show(s){
    cur=s;
    var d=SCENES[s];
    img.src='assets/img/'+d.img+'.jpg'; img.width=d.w; img.height=d.h; img.alt=d.alt;
    var oldSvg=$('svg',frame); if(oldSvg) frame.removeChild(oldSvg);
    if(d.det) frame.appendChild(detSvg(d.det));
    cam.textContent=d.cam;
    frame.classList.remove('swap'); void frame.offsetWidth; frame.classList.add('swap');
    tabs.forEach(function(b,i){b.setAttribute('aria-pressed',i===s?'true':'false')});
    logEvent(s,0);
    step=0;
  }
  SCENES.forEach(function(d){var p=new Image();p.src='assets/img/'+d.img+'.jpg'});
  tabs.forEach(function(b,i){
    b.addEventListener('click',function(){
      if(auto){clearInterval(auto);auto=null}
      show(i);
      /* a second event follows, the way a real feed keeps moving */
      clearTimeout(b._t);
      var scene=i;
      b._t=setTimeout(function(){ if(cur===scene) logEvent(scene,1) },1800);
    });
  });
  if(!reduced){
    logEvent(0,1);
    auto=setInterval(function(){
      if(document.hidden) return;
      var r=$('#console').getBoundingClientRect();
      if(r.bottom<0||r.top>innerHeight) return;
      show((cur+1)%SCENES.length);
    },4200);
  }

  /* ---------- wall: the alarm moves between screens ---------- */
  if(!reduced){
    var wallTiles=$$('.wall .t');
    setInterval(function(){
      if(document.hidden) return;
      var vis=wallTiles.filter(function(t){return t.offsetParent!==null});
      var old=$('.wall .t.alarm');
      var next=vis[Math.floor(Math.random()*vis.length)];
      if(next===old) return;
      if(old) old.classList.remove('alarm');
      next.classList.add('alarm');
    },3400);
  }

  /* ---------- synopsis: pinned story ---------- */
  var syn=$('#synopsis'), steps=$$('.syn-steps p'), tl=$('#syn-time'), fill=$('#syn-fill'), track=$('#syn-track'), state=$('#syn-state');
  var MARKS=[6,11,14,22,27,33,38,44,47,53,58,63,66,72,79,84,88,93];
  var ticks=MARKS.map(function(p){var u=document.createElement('u');u.style.left='0';u.dataset.p=p;track.appendChild(u);return u});
  var LABELS=['Исходная запись','Найдены события','Сжатый отчёт'];
  function hms(min){var m=Math.round(min);return pad(Math.floor(m/60))+':'+pad(m%60)+':00'}
  function paintSyn(p){
    var a=Math.max(0,Math.min(1,(p-.3)/.2));   /* events light up */
    var b=Math.max(0,Math.min(1,(p-.58)/.32)); /* time collapses */
    b=b*b*(3-2*b);
    var w=track.clientWidth, target=w/60;      /* 24 min is 1/60 of the day */
    fill.style.transform='scaleX(1)';
    fill.style.opacity=String(1-a*.8);
    ticks.forEach(function(u,i){
      var from=+u.dataset.p/100*w, to=i/ticks.length*Math.max(target-2,4);
      u.style.transform='translateX('+(from+(to-from)*b)+'px) scaleX('+(1-b*.65)+')';
      u.style.opacity=String(a);
    });
    tl.textContent=hms(1440-(1440-24)*b);
    var i=p<.3?0:p<.58?1:2;
    steps.forEach(function(s,k){s.classList.toggle('on',k===i)});
    state.textContent=LABELS[i];
  }
  if(reduced){
    paintSyn(1);
  } else {
    document.documentElement.classList.add('pin-on');
    var ticking=false;
    var onScroll=function(){
      if(ticking) return; ticking=true;
      requestAnimationFrame(function(){
        ticking=false;
        var r=syn.getBoundingClientRect(), span=r.height-innerHeight;
        var p=span>0?Math.max(0,Math.min(1,-r.top/span)):1;
        paintSyn(p);
      });
    };
    addEventListener('scroll',onScroll,{passive:true});
    addEventListener('resize',onScroll);
    onScroll();
  }

  /* ---------- pricing buttons preselect the task ---------- */
  $$('[data-task]').forEach(function(a){
    a.addEventListener('click',function(){ $('#f-task').value=a.dataset.task });
  });

  /* ---------- form: a prepared email (no backend yet). Put the studio address here. ---------- */
  var LEAD_EMAIL='remindme-davydov-2027@mail.ru';
  $('#lead').addEventListener('submit',function(e){
    e.preventDefault();
    var name=$('#f-name').value.trim(), contact=$('#f-contact').value.trim(), task=$('#f-task').value;
    var body='Здравствуйте!\n\nХочу обсудить видеоаналитику.\nЗадача: '+task+'\nИмя: '+name+'\nКонтакт: '+contact+'\n';
    location.href='mailto:'+LEAD_EMAIL+'?subject='+encodeURIComponent('Заявка с сайта: '+task)+'&body='+encodeURIComponent(body);
    $('#form-note').textContent='Письмо подготовлено в вашей почте.';
  });
})();
