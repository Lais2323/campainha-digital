const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'doorbells.json');

// Carregar dados salvos das campainhas
let doorbells = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    doorbells = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Erro ao ler doorbells.json:', err);
    doorbells = {};
  }
}

function saveDoorbells() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(doorbells, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar doorbells.json:', err);
  }
}

// Retorna ou cria a campainha padrao se nao existir
function getOrCreateDoorbell(id) {
  if (!doorbells[id]) {
    doorbells[id] = {
      id: id,
      ownerName: 'Família & Moradores',
      address: 'Minha Residência',
      welcomeMessage: 'Aguarde um momento, os moradores já foram avisados!',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [] // Lista de contas Google / celulares autorizados (ex: você e namorada)
    };
    saveDoorbells();
  }
  return doorbells[id];
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rota para obter os IPs da rede local
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  res.json({ ips: addresses, port: PORT });
});

// Rota da API para buscar detalhes da campainha
app.get('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'padrao';
  const data = getOrCreateDoorbell(id);
  res.json(data);
});

// Rota da API para atualizar detalhes (Nome, Endereço, etc)
app.post('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'padrao';
  const current = getOrCreateDoorbell(id);
  
  if (req.body.ownerName !== undefined) current.ownerName = req.body.ownerName;
  if (req.body.address !== undefined) current.address = req.body.address;
  if (req.body.welcomeMessage !== undefined) current.welcomeMessage = req.body.welcomeMessage;
  
  // Adiciona novo membro se fornecido (ex: conta Google da namorada)
  if (req.body.addMember) {
    if (!current.members) current.members = [];
    const exists = current.members.some(m => m.email === req.body.addMember.email);
    if (!exists) {
      current.members.push({
        ...req.body.addMember,
        addedAt: new Date().toISOString()
      });
    }
  }

  current.updatedAt = new Date().toISOString();
  saveDoorbells();
  
  // Notifica todos na sala
  io.to(`doorbell:${id}`).emit('config-updated', current);
  
  res.json({ success: true, data: current });
});

// Gerar QR Code para o visitante (placa do portão)
app.get('/api/qr/:id', async (req, res) => {
  try {
    const id = req.params.id || 'padrao';
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const url = `${protocol}://${host}/campainha/${id}`;
    
    const qrBuffer = await QRCode.toBuffer(url, {
      width: 600,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    
    res.type('png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send('Erro ao gerar QR Code');
  }
});

// Rota de Download do APK Android atualizado direto pelo celular
app.get('/download', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'CampainhaDigital.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'CampainhaDigital.apk');
  } else {
    res.status(404).send('APK ainda não disponível para download.');
  }
});

// Verificação de versão atualizada pelo aplicativo
app.get('/api/version', (req, res) => {
  res.json({
    versionName: '1.2.0',
    versionCode: 2,
    downloadUrl: '/download',
    changelog: 'Adicionado viva-voz automático e correções de conexão'
  });
});

// Rota para o entregador acessar: /campainha/:id
app.get('/campainha/:id', (req, res, next) => {
  // Ignora se for arquivo estático com extensão (.css, .js, .png, etc)
  if (req.params.id && req.params.id.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'visitor.html'));
});

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mapeamento de salas e múltiplos moradores conectados
// doorbellId -> { ownerSockets: Set<socketId>, visitorSockets: Set<socketId>, activeCall: null | { visitorId, activeOwnerId } }
const rooms = {};

function getRoom(doorbellId) {
  if (!rooms[doorbellId]) {
    rooms[doorbellId] = {
      ownerSockets: new Set(),
      visitorSockets: new Set(),
      activeCall: null
    };
  }
  return rooms[doorbellId];
}

io.on('connection', (socket) => {
  console.log(`[Socket Conectado] ${socket.id}`);

  // Registro do Morador (App Android - Você ou Namorada)
  socket.on('register-owner', ({ doorbellId, user, ownerName, address }) => {
    socket.doorbellId = doorbellId;
    socket.role = 'owner';
    socket.user = user || { name: 'Morador' };
    socket.join(`doorbell:${doorbellId}`);
    
    const room = getRoom(doorbellId);
    room.ownerSockets.add(socket.id);

    const config = getOrCreateDoorbell(doorbellId);
    
    // Atualiza nome e endereco se fornecidos
    if (ownerName && (!config.ownerName || config.ownerName === 'Família & Moradores')) {
      config.ownerName = ownerName;
    }
    if (address && (!config.address || config.address === 'Minha Residência')) {
      config.address = address;
    }

    // Registra membro da família autenticado via Google
    if (user && user.email) {
      if (!config.members) config.members = [];
      const idx = config.members.findIndex(m => m.email === user.email);
      if (idx === -1) {
        config.members.push({
          email: user.email,
          name: user.name,
          picture: user.picture,
          lastSeen: new Date().toISOString()
        });
      } else {
        config.members[idx].lastSeen = new Date().toISOString();
        if (user.picture) config.members[idx].picture = user.picture;
      }
      saveDoorbells();
    }

    socket.emit('registered', { 
      role: 'owner', 
      config, 
      activeDevicesCount: room.ownerSockets.size 
    });

    // Notifica os moradores conectados sobre a contagem de aparelhos ativos
    io.to(`doorbell:${doorbellId}`).emit('devices-count-updated', {
      count: room.ownerSockets.size
    });

    console.log(`[Morador Conectado] Campainha: ${doorbellId} | Usuário: ${user ? user.name : 'Anônimo'} | Aparelhos Ativos: ${room.ownerSockets.size}`);
  });

  // Registro do Visitante (Navegador Web)
  socket.on('register-visitor', ({ doorbellId }) => {
    socket.doorbellId = doorbellId;
    socket.role = 'visitor';
    socket.join(`doorbell:${doorbellId}`);
    
    const room = getRoom(doorbellId);
    room.visitorSockets.add(socket.id);
    const config = getOrCreateDoorbell(doorbellId);
    
    const isOwnerOnline = room.ownerSockets.size > 0;
    
    socket.emit('registered', { 
      role: 'visitor', 
      config,
      isOwnerOnline,
      activeOwnersCount: room.ownerSockets.size
    });
    console.log(`[Visitante Conectado] Campainha: ${doorbellId} | Moradores Online: ${room.ownerSockets.size}`);
  });

  // Entregador toca a campainha -> TOCA EM TODOS OS CELULARES CADASTRADOS (VOCÊ E NAMORADA)
  socket.on('ring-doorbell', ({ doorbellId, visitorInfo }) => {
    const room = getRoom(doorbellId);
    room.activeCall = {
      visitorId: socket.id,
      activeOwnerId: null,
      startTime: Date.now()
    };

    console.log(`[🔔 CAMPAINHA TOCANDO!] Tocando em ${room.ownerSockets.size} celular(es) de ${doorbellId}`);

    // Avisa TODOS os moradores cadastrados no mesmo momento
    for (const ownerSocketId of room.ownerSockets) {
      io.to(ownerSocketId).emit('incoming-call', {
        from: socket.id,
        doorbellId: doorbellId,
        timestamp: Date.now(),
        visitorInfo: visitorInfo || {}
      });
    }

    // Confirma pro visitante que está chamando
    socket.emit('ringing-started', { timestamp: Date.now() });
  });

  // Um dos moradores atende a chamada
  socket.on('answer-call', ({ doorbellId, targetVisitorId }) => {
    const room = getRoom(doorbellId);
    const visitorId = targetVisitorId || (room.activeCall ? room.activeCall.visitorId : null);
    
    if (room.activeCall) {
      room.activeCall.activeOwnerId = socket.id;
    }

    console.log(`[📞 CHAMADA ATENDIDA] Morador ${socket.id} atendeu!`);
    
    // Conecta o visitante com esse morador
    if (visitorId) {
      io.to(visitorId).emit('call-answered', { 
        by: socket.id,
        ownerUser: socket.user || { name: 'Morador' }
      });
    }

    // Avisa os outros celulares dos moradores para pararem de tocar
    for (const ownerSocketId of room.ownerSockets) {
      if (ownerSocketId !== socket.id) {
        io.to(ownerSocketId).emit('call-answered-by-peer', {
          byName: socket.user ? socket.user.name : 'Outro morador'
        });
      }
    }
  });

  // Morador ou Visitante recusa
  socket.on('reject-call', ({ doorbellId }) => {
    const room = getRoom(doorbellId);
    room.activeCall = null;
    console.log(`[❌ CHAMADA RECUSADA] Campainha: ${doorbellId}`);
    
    // Notifica todos na sala
    socket.to(`doorbell:${doorbellId}`).emit('call-rejected', { by: socket.id });
  });

  // Encerrar chamada
  socket.on('end-call', ({ doorbellId }) => {
    const room = getRoom(doorbellId);
    room.activeCall = null;
    console.log(`[📴 CHAMADA ENCERRADA] ${doorbellId}`);
    socket.to(`doorbell:${doorbellId}`).emit('call-ended', { by: socket.id });
  });

  // Sinalização WebRTC: Oferta SDP
  socket.on('webrtc-offer', ({ doorbellId, offer, to }) => {
    if (to) {
      io.to(to).emit('webrtc-offer', { offer, from: socket.id });
    } else {
      socket.to(`doorbell:${doorbellId}`).emit('webrtc-offer', { offer, from: socket.id });
    }
  });

  // Sinalização WebRTC: Resposta SDP
  socket.on('webrtc-answer', ({ doorbellId, answer, to }) => {
    if (to) {
      io.to(to).emit('webrtc-answer', { answer, from: socket.id });
    } else {
      socket.to(`doorbell:${doorbellId}`).emit('webrtc-answer', { answer, from: socket.id });
    }
  });

  // Sinalização WebRTC: Candidato ICE
  socket.on('webrtc-ice-candidate', ({ doorbellId, candidate, to }) => {
    if (to) {
      io.to(to).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    } else {
      socket.to(`doorbell:${doorbellId}`).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    }
  });

  // Notificação de alternância de vídeo (liga/desliga câmera)
  socket.on('video-state-changed', ({ doorbellId, isVideoActive, to }) => {
    if (to) {
      io.to(to).emit('remote-video-state-changed', {
        from: socket.id,
        isVideoActive
      });
    } else {
      socket.to(`doorbell:${doorbellId}`).emit('remote-video-state-changed', {
        from: socket.id,
        isVideoActive
      });
    }
  });

  // Desconexão
  socket.on('disconnect', () => {
    if (socket.doorbellId) {
      const room = getRoom(socket.doorbellId);
      if (socket.role === 'owner') {
        room.ownerSockets.delete(socket.id);
        io.to(`doorbell:${socket.doorbellId}`).emit('devices-count-updated', {
          count: room.ownerSockets.size
        });
      }
      if (socket.role === 'visitor') {
        room.visitorSockets.delete(socket.id);
        if (room.activeCall && room.activeCall.visitorId === socket.id) {
          room.activeCall = null;
          socket.to(`doorbell:${socket.doorbellId}`).emit('call-ended', { reason: 'visitor-disconnected' });
        }
      }
    }
    console.log(`[Socket Desconectado] ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log(`🔔 Servidor Campainha Digital rodando na porta ${PORT}`);
  console.log(`Acesse localmente: http://localhost:${PORT}`);
  
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`Acesse na sua rede Wi-Fi: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('========================================================');
});
