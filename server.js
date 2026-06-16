// ── Mahjong Night — server.js ──
// Node.js WebSocket server. Run: node server.js
// Deploy free to Railway, Render, or Fly.io

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ── Static file server ──
const MIME = {
  '.html': 'text/html', '.css': 'text/css',
  '.js':   'text/javascript', '.ico': 'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  // prevent directory traversal
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

// ── Tile engine ──
const SUITS   = ['bam','crack','dot'];
const WINDS   = ['East','South','West','North'];
const DRAGONS = ['Red','Green','Soap'];
const FLOWERS = ['🌸','🌺','🌻','🍀','🪷','🌹','💐','🌷'];

function buildWall() {
  const tiles = []; let id = 0;
  for (const s of SUITS)   for (let n=1;n<=9;n++) for (let c=0;c<4;c++) tiles.push({id:id++,type:'suit',suit:s,num:n});
  for (const w of WINDS)   for (let c=0;c<4;c++) tiles.push({id:id++,type:'wind',suit:w,num:null});
  for (const d of DRAGONS) for (let c=0;c<4;c++) tiles.push({id:id++,type:'dragon',suit:d,num:null});
  for (let j=0;j<8;j++) tiles.push({id:id++,type:'joker',suit:'joker',num:j});
  for (let f=0;f<8;f++) tiles.push({id:id++,type:'flower',suit:FLOWERS[f],num:f});
  for (let i=tiles.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  return tiles;
}

function tileKey(t) {
  if (t.type==='joker')  return 'J';
  if (t.type==='flower') return 'F'+t.num;
  if (t.type==='wind')   return 'W_'+t.suit;
  if (t.type==='dragon') return 'D_'+t.suit;
  return t.suit[0].toUpperCase()+t.num;
}

function sortTile(a,b){
  const o={flower:0,joker:1,wind:2,dragon:3,suit:4};
  if(o[a.type]!==o[b.type]) return o[a.type]-o[b.type];
  if(a.suit!==b.suit) return a.suit<b.suit?-1:1;
  return (a.num||0)-(b.num||0);
}

// All winning hands — checked server-side to prevent cheating
const HANDS = [
  { name:'Consecutive run',     pts:25,  check(r){ for(const s of SUITS){const ns=r.filter(t=>t.type==='suit'&&t.suit===s).map(t=>t.num);for(let st=1;st<=5;st++){if([0,1,2,3,4].every(i=>ns.includes(st+i)))return true;}}return false;}},
  { name:'All pairs',           pts:25,  check(r){ if(r.length<14)return false;const k=r.map(tileKey).sort();for(let i=0;i<14;i+=2)if(k[i]!==k[i+1])return false;return true;}},
  { name:'Three-suit triplets', pts:30,  check(r){ for(let n=1;n<=9;n++){if(SUITS.every(s=>r.filter(t=>t.type==='suit'&&t.suit===s&&t.num===n).length>=3))return true;}return false;}},
  { name:'Winds & dragons',     pts:30,  check(r){ return r.filter(t=>t.type==='wind'||t.type==='dragon').length>=10;}},
  { name:'Three kongs',         pts:35,  check(r){ const c={};for(const t of r){const k=tileKey(t);c[k]=(c[k]||0)+1;}return Object.values(c).filter(v=>v>=4).length>=3;}},
  { name:'Flowers & jokers',    pts:35,  check(r){ return r.filter(t=>t.type==='flower').length>=4&&r.filter(t=>t.type==='joker').length>=4;}},
  { name:'All one suit',        pts:40,  check(r){ const st=r.filter(t=>t.type==='suit');return st.length>=14&&new Set(st.map(t=>t.suit)).size===1;}},
  { name:'Dragon pungs',        pts:40,  check(r){ return DRAGONS.every(d=>r.filter(t=>t.type==='dragon'&&t.suit===d).length>=3);}},
  { name:'Wind sequence',       pts:45,  check(r){ return WINDS.every(w=>r.filter(t=>t.type==='wind'&&t.suit===w).length>=3);}},
  { name:'Quints',              pts:50,  check(r){ const c={};for(const t of r){const k=tileKey(t);c[k]=(c[k]||0)+1;}return Object.values(c).filter(v=>v>=5).length>=2;}},
  { name:'Lucky thirteen',      pts:50,  check(r){ return new Set(r.map(tileKey)).size>=13&&r.length>=14;}},
  { name:'Symmetrical hand',    pts:45,  check(r){ const bam=r.filter(t=>t.type==='suit'&&t.suit==='bam').map(t=>t.num).sort((a,b)=>a-b);const dot=r.filter(t=>t.type==='suit'&&t.suit==='dot').map(t=>t.num).sort((a,b)=>a-b);return bam.length>=5&&JSON.stringify(bam)===JSON.stringify(dot);}},
];

function bestHand(rack){ for(const h of HANDS) if(h.check(rack)) return h; return null; }

function aiDiscard(hand){
  const c={};for(const t of hand){const k=tileKey(t);c[k]=(c[k]||0)+1;}
  const singles=hand.filter(t=>c[tileKey(t)]===1&&t.type!=='joker'&&t.type!=='flower');
  return singles.length?singles[Math.floor(Math.random()*singles.length)]:hand[Math.floor(Math.random()*hand.length)];
}

// ── Room management ──
// rooms: Map<code, Room>
// Room: { code, players:[{id,name,ws,hand,exposed,score,ready}], wall, discards,
//          currentPlayer, phase, charlestonStep, lastDiscard, lastDiscardPlayer,
//          gameScores:{[id]:total}, log }
const rooms = new Map();

function makeCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

function createRoom(hostWs, hostName){
  let code;
  do { code = makeCode(); } while(rooms.has(code));
  const host = { id:uuid(), name:hostName, ws:hostWs, hand:[], exposed:[], score:0, ready:false };
  const room = {
    code, players:[host], wall:[], discards:[],
    currentPlayer:0, phase:'lobby',
    charlestonStep:0, lastDiscard:null, lastDiscardPlayer:-1,
    gameScores:{}, log:[], aiPlayers:[]
  };
  rooms.set(code, room);
  return { room, player:host };
}

function joinRoom(code, ws, name){
  const room = rooms.get(code);
  if (!room) return { error:'Room not found' };
  if (room.phase !== 'lobby') return { error:'Game already in progress' };
  if (room.players.length >= 4) return { error:'Room is full (max 4)' };
  const player = { id:uuid(), name, ws, hand:[], exposed:[], score:0, ready:false };
  room.players.push(player);
  return { room, player };
}

function broadcast(room, msg, excludeId=null){
  const payload = JSON.stringify(msg);
  for (const p of room.players){
    if (p.id !== excludeId && p.ws && p.ws.readyState === 1) p.ws.send(payload);
  }
}

function sendTo(player, msg){
  if (player.ws && player.ws.readyState===1) player.ws.send(JSON.stringify(msg));
}

function roomState(room, forPlayerId){
  // Build state — hide other players' hands
  return {
    type: 'state',
    phase: room.phase,
    code: room.code,
    charlestonStep: room.charlestonStep,
    currentPlayer: room.currentPlayer,
    lastDiscardKey: room.lastDiscard ? tileKey(room.lastDiscard) : null,
    lastDiscardPlayer: room.lastDiscardPlayer,
    wallCount: room.wall.length,
    discards: room.discards,
    log: room.log.slice(0,10),
    players: room.players.map((p,i) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      ready: p.ready,
      isAI: p.isAI || false,
      handCount: p.hand.length,
      exposed: p.exposed,
      hand: p.id === forPlayerId ? p.hand : [],
    })),
    gameScores: room.gameScores,
  };
}

function addLog(room, msg){ room.log.unshift(msg); if(room.log.length>40) room.log.pop(); }

function startGame(room){
  room.wall = buildWall();
  room.discards = [];
  room.currentPlayer = 0;
  room.lastDiscard = null;
  room.lastDiscardPlayer = -1;
  room.charlestonStep = 0;
  room.phase = 'charleston';

  // Fill with AI if < 4 human players
  const humanCount = room.players.filter(p=>!p.isAI).length;
  const aiNames = ['East AI','South AI','West AI'];
  let aiIdx = 0;
  while(room.players.length < 4){
    room.players.push({
      id:'ai_'+aiIdx, name:aiNames[aiIdx]||'AI', ws:null, hand:[], exposed:[], score:0, ready:true, isAI:true
    });
    aiIdx++;
  }

  // Deal 13 to each, 14 to first
  for(let i=0;i<room.players.length;i++){
    const n = i===0?14:13;
    room.players[i].hand = room.wall.splice(0,n).sort(sortTile);
    room.players[i].exposed = [];
  }

  addLog(room,'Game started! Complete the Charleston.');
  broadcastStates(room);
}

function broadcastStates(room){
  for(const p of room.players){
    if(!p.isAI) sendTo(p, roomState(room, p.id));
  }
}

function nextTurn(room){
  room.currentPlayer = (room.currentPlayer+1) % room.players.length;
  broadcastStates(room);
  const cp = room.players[room.currentPlayer];
  if(cp.isAI) setTimeout(()=>doAITurn(room), 600+Math.random()*500);
}

function doAITurn(room){
  if(room.phase!=='play') return;
  const cp = room.players[room.currentPlayer];
  if(!cp.isAI) return;

  // Maybe claim discard
  if(room.lastDiscard && room.lastDiscardPlayer!==room.currentPlayer && Math.random()<0.15){
    cp.hand.push(room.lastDiscard);
    room.discards.pop();
    addLog(room, `${cp.name} claimed the discard`);
    room.lastDiscard=null;
  } else {
    if(room.wall.length===0){ endRound(room,null,'Wall empty — draw game!'); return; }
    cp.hand.push(room.wall.shift());
  }

  const won=bestHand(cp.hand);
  if(won){ endRound(room,cp,won.name,won.pts); return; }

  const disc=aiDiscard(cp.hand);
  cp.hand=cp.hand.filter(t=>t.id!==disc.id);
  room.discards.push(disc);
  room.lastDiscard=disc;
  room.lastDiscardPlayer=room.currentPlayer;
  addLog(room,`${cp.name} discarded ${tileKey(disc)}`);
  nextTurn(room);
}

function endRound(room, winner, handName, pts=0){
  room.phase='roundover';
  if(winner){
    winner.score = (winner.score||0)+pts;
    room.gameScores[winner.id]=(room.gameScores[winner.id]||0)+pts;
    addLog(room,`🏆 ${winner.name} wins with ${handName}! +${pts} pts`);
  } else {
    addLog(room, handName||'Round over');
  }
  broadcastStates(room);
  broadcast(room,{
    type:'roundover',
    winnerId: winner?winner.id:null,
    winnerName: winner?winner.name:null,
    handName, pts,
    gameScores: room.gameScores,
  });
}

// ── WebSocket server ──
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  let myRoom = null;
  let myPlayer = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch(msg.type){

      case 'reconnect': {
        // Player is returning from lobby→game page redirect; re-attach their ws
        const code = msg.code?.toUpperCase();
        const room = rooms.get(code);
        if (!room) { sendTo({ws}, {type:'error', message:'Room not found'}); return; }
        const player = room.players.find(p => p.id === msg.playerId);
        if (!player) {
          // Player not found — try joining as new (handles edge cases)
          const result = joinRoom(code, ws, msg.name||'Player');
          if (result.error) { sendTo({ws},{type:'error',message:result.error}); return; }
          myRoom=result.room; myPlayer=result.player;
          sendTo(result.player,{type:'joined',code:result.room.code,playerId:result.player.id});
        } else {
          player.ws = ws;
          myRoom = room; myPlayer = player;
          sendTo(player,{type:'joined',code:room.code,playerId:player.id});
        }
        broadcastStates(myRoom);
        break;
      }

      case 'create': {
        const { room, player } = createRoom(ws, msg.name||'Host');
        myRoom=room; myPlayer=player;
        sendTo(player,{ type:'created', code:room.code, playerId:player.id });
        sendTo(player, roomState(room, player.id));
        break;
      }

      case 'join': {
        const result = joinRoom(msg.code?.toUpperCase(), ws, msg.name||'Player');
        if(result.error){ sendTo({ws},{ type:'error', message:result.error }); return; }
        myRoom=result.room; myPlayer=result.player;
        sendTo(result.player,{ type:'joined', code:result.room.code, playerId:result.player.id });
        broadcastStates(result.room);
        broadcast(result.room,{ type:'playerjoined', name:result.player.name }, result.player.id);
        break;
      }

      case 'ready': {
        if(!myPlayer||!myRoom) return;
        myPlayer.ready=true;
        broadcastStates(myRoom);
        const allReady = myRoom.players.length>=2 && myRoom.players.every(p=>p.ready);
        if(allReady || msg.force) startGame(myRoom);
        break;
      }

      case 'start': {
        if(!myRoom||!myPlayer) return;
        // Any human player in the room can trigger start (host check was too strict)
        if(myRoom.players.some(p=>p.id===myPlayer.id&&!p.isAI)) startGame(myRoom);
        break;
      }

      case 'charleston_pass': {
        if(!myRoom||!myPlayer||myRoom.phase!=='charleston') return;
        const picks = msg.tileIds.map(id=>myPlayer.hand.find(t=>t.id===id)).filter(Boolean);
        if(picks.length!==3) { sendTo(myPlayer,{type:'error',message:'Select exactly 3 tiles'}); return; }

        // Mark player's pass
        myPlayer._charlestonPicks = picks;
        myPlayer.hand = myPlayer.hand.filter(t=>!picks.some(p=>p.id===t.id));

        // AI players auto-pass 3 tiles
        for(const p of myRoom.players){
          if(p.isAI && !p._charlestonPicks){
            p._charlestonPicks = p.hand.splice(0,3);
          }
        }

        // Check if all humans have passed
        const allPassed = myRoom.players.every(p=>p.isAI||p._charlestonPicks);
        if(!allPassed){
          addLog(myRoom, `${myPlayer.name} passed tiles. Waiting for others…`);
          broadcastStates(myRoom); return;
        }

        // Rotate tiles
        const passes = myRoom.players.map(p=>p._charlestonPicks||[]);
        const step = myRoom.charlestonStep;
        for(let i=0;i<myRoom.players.length;i++){
          let from;
          if(step===0) from=(i+3)%4; // pass right: receive from left
          else if(step===1) from=(i+2)%4; // across
          else from=(i+1)%4; // pass left
          myRoom.players[i].hand.push(...passes[from]);
          myRoom.players[i].hand.sort(sortTile);
          myRoom.players[i]._charlestonPicks=null;
        }

        myRoom.charlestonStep++;
        addLog(myRoom,`Charleston pass ${myRoom.charlestonStep} complete!`);
        if(myRoom.charlestonStep>=3){
          myRoom.phase='play';
          addLog(myRoom,'Charleston done! Play begins — Player 1 draws first.');
        }
        broadcastStates(myRoom);
        if(myRoom.phase==='play'&&myRoom.players[myRoom.currentPlayer].isAI) setTimeout(()=>doAITurn(myRoom),800);
        break;
      }

      case 'draw': {
        if(!myRoom||!myPlayer||myRoom.phase!=='play') return;
        if(myRoom.players[myRoom.currentPlayer].id!==myPlayer.id){ sendTo(myPlayer,{type:'error',message:"Not your turn"}); return; }
        if(myRoom.wall.length===0){ endRound(myRoom,null,'Wall empty — draw!'); return; }
        const tile=myRoom.wall.shift();
        myPlayer.hand.push(tile);
        addLog(myRoom,`${myPlayer.name} drew a tile`);
        broadcastStates(myRoom);
        break;
      }

      case 'claim': {
        if(!myRoom||!myPlayer||myRoom.phase!=='play') return;
        if(myRoom.players[myRoom.currentPlayer].id!==myPlayer.id) return;
        if(!myRoom.lastDiscard||myRoom.lastDiscardPlayer===myRoom.players.indexOf(myPlayer)) return;
        myPlayer.hand.push(myRoom.lastDiscard);
        myRoom.discards.pop();
        addLog(myRoom,`${myPlayer.name} claimed ${tileKey(myRoom.lastDiscard)}`);
        myRoom.lastDiscard=null;
        broadcastStates(myRoom);
        break;
      }

      case 'discard': {
        if(!myRoom||!myPlayer||myRoom.phase!=='play') return;
        const pidx=myRoom.players.indexOf(myPlayer);
        if(myRoom.currentPlayer!==pidx){ sendTo(myPlayer,{type:'error',message:"Not your turn"}); return; }
        const tile=myPlayer.hand.find(t=>t.id===msg.tileId);
        if(!tile){ sendTo(myPlayer,{type:'error',message:"Tile not in hand"}); return; }
        myPlayer.hand=myPlayer.hand.filter(t=>t.id!==msg.tileId);
        myRoom.discards.push(tile);
        myRoom.lastDiscard=tile;
        myRoom.lastDiscardPlayer=pidx;
        addLog(myRoom,`${myPlayer.name} discarded ${tileKey(tile)}`);
        nextTurn(myRoom);
        break;
      }

      case 'mahjong': {
        if(!myRoom||!myPlayer||myRoom.phase!=='play') return;
        const won=bestHand(myPlayer.hand);
        if(!won){ sendTo(myPlayer,{type:'error',message:'No winning hand detected'}); return; }
        endRound(myRoom,myPlayer,won.name,won.pts);
        break;
      }

      case 'next_round': {
        if(!myRoom||myRoom.players[0]?.id!==myPlayer?.id) return;
        startGame(myRoom);
        break;
      }

      case 'ai_hint': {
        if(!myRoom||!myPlayer) return;
        const hand=myPlayer.hand;
        const won=bestHand(hand);
        const hints=[];
        if(won) hints.push(`You have a winning hand: ${won.name}! Declare Mahjong!`);
        else {
          const counts={};
          for(const t of hand){const k=tileKey(t);counts[k]=(counts[k]||0)+1;}
          const singles=hand.filter(t=>counts[tileKey(t)]===1&&t.type!=='joker'&&t.type!=='flower');
          if(singles.length) hints.push(`Consider discarding a single tile: ${tileKey(singles[0])}`);
          if(hand.filter(t=>t.type==='joker').length>=2) hints.push('You have multiple jokers — great flexibility!');
          if(hand.filter(t=>t.type==='flower').length>=3) hints.push('Holding many flowers — Flowers & Jokers hand may be in reach.');
          const pairsOrMore=Object.entries(counts).filter(([,v])=>v>=2);
          if(pairsOrMore.length>=5) hints.push('Many pairs — consider building toward the All Pairs hand.');
          HANDS.forEach(h=>{
            try{ if(h.check([...hand,...hand.slice(0,1)])) hints.push(`Close to: ${h.name} (${h.pts} pts)`); }catch(e){}
          });
          if(!hints.length) hints.push('Keep collecting pairs and sets. Watch the discard pile for tiles you need.');
        }
        sendTo(myPlayer,{type:'hint', hints: hints.slice(0,3)});
        break;
      }
    }
  });

  ws.on('close', ()=>{
    if(myRoom&&myPlayer){
      addLog(myRoom,`${myPlayer.name} disconnected`);
      if(!myPlayer.isAI) myPlayer.ws=null;
      // If all humans gone, clean up room after delay
      const humansWith = myRoom.players.filter(p=>!p.isAI&&p.ws&&p.ws.readyState===1);
      if(humansWith.length===0) setTimeout(()=>{ if(rooms.get(myRoom.code)===myRoom) rooms.delete(myRoom.code); },60000);
      else broadcastStates(myRoom);
    }
  });
});

httpServer.listen(PORT, ()=>console.log(`🀄 Mahjong Night running on http://localhost:${PORT}`));
